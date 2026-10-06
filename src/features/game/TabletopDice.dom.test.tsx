// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "@luminous/engine";
import { flipCoin } from "../../../packages/engine/src/rng";
import {
  attachFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handUid,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { TabletopDice } from "./TabletopDice";
import { LocalMatch } from "./LocalMatch";
import { coinFlipsFromEvents } from "./coinFlips";
import type { LocalGameSetup } from "./useLocalGame";

vi.mock("../playmat/components/AnimatedCardsLayer", () => ({ AnimatedCardsLayer: () => null }));
beforeAll(installDomShims);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function hammerSetup(face: "heads" | "tails"): LocalGameSetup {
  const deck = deckOf({
    "fix-basic-1": 30,
    "fix-fire-energy": 10,
    "fix-water-energy": 10,
    "sv01-168": 10,
  });
  let state = driveSetup(7, { p1: deck, p2: deck }, { first: "p1" });
  state = handFromDeck(state, "p1", "sv01-168", 2);
  // Distinct choices prevent the engine auto-selecting interchangeable Energy.
  state = attachFromDeck(state, "p2", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p2", "fix-water-energy", 1);
  const hammer = state.cardPool["sv01-168"];
  if (!hammer) throw new Error("missing Hammer fixture");
  let rngState = 1;
  while (flipCoin(rngState)[0] !== face) rngState += 1;
  state = {
    ...state,
    rngState,
    cardPool: {
      ...state.cardPool,
      "sv01-168": { ...hammer, name: "Crushing Hammer" },
    },
  };
  return { state, events: [], names: { p1: "Player 1", p2: "Player 2" }, startedAt: 0 };
}

describe("simulator tabletop dice", () => {
  it.each(["heads", "tails"] as const)(
    "shows Crushing Hammer's actual %s before continuing",
    (face) => {
      const setup = hammerSetup(face);
      const expected = applyAction(setup.state, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(setup.state, "p1", "sv01-168"),
      });
      expect(expected.ok).toBe(true);
      if (!expected.ok) throw new Error(expected.error.message);
      expect(coinFlipsFromEvents(expected.events, setup.names)[0]?.result).toBe(face);
      let saved: LocalGameSetup | undefined;
      const view = render(
        <StrictMode>
          <MemoryRouter>
            <LocalMatch
              setup={setup}
              onPlayAgain={() => {}}
              onSave={(value) => {
                saved = value;
              }}
            />
          </MemoryRouter>
        </StrictMode>,
      );
      const hammerButton = screen.getAllByRole("button", { name: "Crushing Hammer" })[0];
      if (!hammerButton) throw new Error("missing Hammer button");
      fireEvent.click(hammerButton);
      expect(document.querySelector(".tabletop-dice")?.textContent).toBe("");
      expect(document.querySelector("[inert]")).not.toBeNull();
      const dice = document.querySelector(".tabletop-dice");
      expect(dice?.closest('[aria-label="Trading card game playmat"]')).not.toBeNull();
      expect(dice?.closest("[inert]")).toBeNull();
      const die = document.querySelector<HTMLElement>(".tabletop-die");
      const value = Number(die?.dataset.value);
      expect(value >= 1 && value <= 6).toBe(true);
      expect(die?.dataset.seat).toBe("p1");
      expect(value % 2).toBe(face === "heads" ? 0 : 1);
      expect(die?.querySelectorAll(".tabletop-die-face")).toHaveLength(6);
      expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
      expect(document.querySelector('[aria-label="Discard Energy"]')).toBeNull();
      expect(saved?.state).toEqual(expected.state);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByText(face === "heads" ? "Heads" : "Tails")).toBeTruthy();
      act(() => vi.advanceTimersByTime(1000));
      expect(document.querySelector(".tabletop-dice")).toBeNull();
      expect(document.querySelector("[inert]")).toBeNull();
      if (face === "heads") {
        expect(saved?.state.phase.kind).toBe("effect:choose");
        expect(document.querySelector('[aria-label="Discard Energy"]')).not.toBeNull();
      } else expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();

      // Autosaves keep the resolved game, but never replay transient animation.
      view.unmount();
      if (!saved) throw new Error("missing save");
      render(
        <MemoryRouter>
          <LocalMatch setup={saved} onPlayAgain={() => {}} />
        </MemoryRouter>,
      );
      expect(document.querySelector(".tabletop-dice")).toBeNull();
    },
  );

  it("announces all results of a multi-coin effect and cleans up its timers", () => {
    const done = vi.fn();
    const view = render(
      <TabletopDice
        batch={{
          id: 1,
          title: "Coin flip",
          flips: coinFlipsFromEvents(
            [
              { type: "ATTACK_EFFECT_COIN_FLIP", result: "heads", seat: "p1" },
              { type: "ATTACK_EFFECT_COIN_FLIP", result: "tails", seat: "p1" },
              { type: "ATTACK_EFFECT_COIN_FLIP", result: "heads", seat: "p2" },
            ],
            { p1: "Same deck", p2: "Same deck" },
          ),
        }}
        onComplete={done}
      />,
    );
    expect(document.querySelector(".tabletop-dice")?.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByText("Heads")).toHaveLength(2);
    expect(screen.getAllByText("Tails")).toHaveLength(1);
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(".tabletop-die"),
        (die) => die.dataset.seat,
      ),
    ).toEqual(["p1", "p1", "p2"]);
    view.unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(done).not.toHaveBeenCalled();
  });

  it("shows the result immediately with reduced motion and completes once under StrictMode", () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
    const done = vi.fn();
    render(
      <StrictMode>
        <TabletopDice
          batch={{
            id: 1,
            title: "Crushing Hammer",
            flips: [{ result: "tails", player: "Player 1", seat: "p1" }],
          }}
          onComplete={done}
        />
      </StrictMode>,
    );
    expect(screen.getByText("Tails")).toBeTruthy();
    expect(screen.queryByText("Rolling…")).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
