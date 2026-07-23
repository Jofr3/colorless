// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

// The online HUD is driven purely by the redacted wire snapshot (no full engine
// state), so these render it standalone against hand-built RedactedGame views
// and pin that each panel dispatches the right seat-bound action.

// The ko:* dialogs are native <dialog>s that call showModal on mount.
beforeAll(installDomShims);

afterEach(cleanup);

function inPlay(id: string, name: string, extra: Partial<RedactedInPlay> = {}): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
    ...extra,
  };
}

/** A minimal well-formed viewer-relative snapshot; callers override the phase,
    the boards and who is waited on. p1 is "you". */
function game(overrides: {
  phase: RedactedPhase;
  you?: Partial<RedactedGame["board"]["you"]>;
  waitingOn?: RedactedGame["waitingOn"];
  turn?: number;
}): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  return {
    seat: "p1",
    turn: overrides.turn ?? 3,
    phase: overrides.phase,
    board: {
      stadium: null,
      you: { ...emptySide, ...overrides.you },
      opponent: emptySide,
    },
    activePlayer: "you",
    waitingOn: overrides.waitingOn ?? "you",
    outcome: null,
  };
}

describe("OnlineHud — turn:action attack panel", () => {
  const ATTACKS: Extract<RedactedPhase, { kind: "turn:action" }>["attacks"] = [
    { index: 0, name: "Cut", cost: ["Water"], damage: "10", playable: true },
    { index: 1, name: "Big Swing", cost: ["Water", "Water"], damage: "80", playable: false },
  ];

  it("dispatches a seat-bound attack on a playable row and disables an unpayable one", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: { kind: "turn:action", attacks: ATTACKS, retreat: null },
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cut/ }));
    expect(onAction).toHaveBeenCalledWith({ type: "attack", seat: "p1", index: 0 });

    const unpayable = screen.getByRole<HTMLButtonElement>("button", { name: /Big Swing/ });
    expect(unpayable.disabled).toBe(true);
    onAction.mockClear();
    fireEvent.click(unpayable);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the §4 first-turn note only on turn 1", () => {
    const first = render(
      <OnlineHud
        game={game({
          turn: 1,
          phase: { kind: "turn:action", attacks: ATTACKS, retreat: null },
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/first turn/i)).toBeTruthy();
    first.unmount();

    render(
      <OnlineHud
        game={game({
          phase: { kind: "turn:action", attacks: ATTACKS, retreat: null },
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText(/first turn/i)).toBeNull();
  });

  it("renders no panel when it is the opponent's turn", () => {
    const { container } = render(
      <OnlineHud
        game={game({
          phase: { kind: "turn:action", attacks: [], retreat: null },
          you: { active: inPlay("sneasel", "Sneasel") },
          waitingOn: "opponent",
        })}
        waitingOn="opponent"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("OnlineHud — turn:action retreat", () => {
  const ENERGY = {
    id: "e1",
    cardId: "water",
    name: "Water Energy",
    category: "Energy" as const,
    trainerType: null,
    hasImage: false,
  };
  const activeWithEnergy = inPlay("sneasel", "Sneasel", {
    attached: { tools: [], energies: [ENERGY] },
  });

  it("opens the retreat dialog and dispatches the picked energy + bench index", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: { kind: "turn:action", attacks: [], retreat: { cost: 1, can: true } },
          you: { active: activeWithEnergy, bench: [inPlay("b", "Bench Sneasel")] },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    // The panel's Retreat control (labelled with the cost) opens the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Retreat \(1\)/ }));
    // Confirm stays disabled until an energy AND a bench Pokémon are picked.
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /^Retreat$/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Bench Sneasel/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({
      type: "retreat",
      seat: "p1",
      discardEnergy: ["e1"],
      promoteBenchIndex: 0,
    });
  });

  it("disables the retreat control when the server marks it unpayable", () => {
    render(
      <OnlineHud
        game={game({
          phase: { kind: "turn:action", attacks: [], retreat: { cost: 2, can: false } },
          you: { active: inPlay("sneasel", "Sneasel"), bench: [inPlay("b", "Beta")] },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole<HTMLButtonElement>("button", { name: /Retreat \(2\)/ });
    expect(btn.disabled).toBe(true);
  });
});

describe("OnlineHud — ko:takePrizes", () => {
  it("dispatches the picked prize indices once exactly `count` are chosen", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({ phase: { kind: "ko:takePrizes", count: 1 }, you: { prizesRemaining: 4 } })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    const take = screen.getByRole<HTMLButtonElement>("button", { name: /Take 0\/1/ });
    expect(take.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Prize 2" }));
    const armed = screen.getByRole<HTMLButtonElement>("button", { name: /Take 1\/1/ });
    expect(armed.disabled).toBe(false);
    fireEvent.click(armed);
    expect(onAction).toHaveBeenCalledWith({ type: "takePrizes", seat: "p1", prizeIndices: [1] });
  });
});

describe("OnlineHud — ko:promote", () => {
  it("dispatches the chosen bench index directly", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: { kind: "ko:promote" },
          you: { bench: [inPlay("a", "Alpha"), inPlay("b", "Beta")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onAction).toHaveBeenCalledWith({ type: "promote", seat: "p1", benchIndex: 1 });
  });
});
