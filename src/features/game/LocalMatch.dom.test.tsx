// @vitest-environment jsdom
// Regression: one "Turn actions" panel leaked per turn. TurnPanel and
// PrizeDialog sat in GameHud's fragment as siblings sharing key={seatKey};
// React's keyed reconciliation maps the leftover old children BY KEY, so the
// duplicate collapsed to one map entry and the shadowed TurnPanel fiber was
// never deleted when seatKey changed — an orphaned-but-mounted tree with
// stale props and live buttons. The real PlaymatView shell stays in the
// tree (the leak's DOM parent); only the Pixi canvas layer is stubbed.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { driveSetup } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { LocalMatch } from "./LocalMatch";

// Pixi can't initialise in jsdom (no WebGL); everything else is real.
vi.mock("../playmat/components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: ({ blueBackPlayer }: { blueBackPlayer: string }) => (
    <div data-testid="animated-card-layer" data-blue-back-player={blueBackPlayer} />
  ),
}));

beforeAll(installDomShims);
afterEach(cleanup);

function renderMatch() {
  render(
    // StrictMode to match src/main.tsx — the leak must stay fixed under it.
    <StrictMode>
      <MemoryRouter>
        <LocalMatch
          setup={{
            state: driveSetup(7),
            events: [],
            names: { p1: "Player 1", p2: "Player 2" },
            startedAt: 0,
          }}
          onPlayAgain={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("LocalMatch HUD across turns", () => {
  it("swaps deck and prize back colors with each hot-seat handoff", () => {
    renderMatch();
    const initialPerspective = document.body.dataset.perspective;
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-card-back-tone]"));
    expect(anchors).toHaveLength(14);
    const initialColors = anchors.map((anchor) => anchor.dataset.cardBackTone);

    for (let pass = 1; pass <= 4; pass += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      const swapped = pass % 2 === 1;
      expect(document.body.dataset.perspective === initialPerspective).toBe(!swapped);
      const current = Array.from(document.querySelectorAll<HTMLElement>("[data-card-back-tone]"));
      expect(current.map((anchor) => anchor.dataset.cardId)).toEqual(
        anchors.map((anchor) => anchor.dataset.cardId),
      );
      expect(current.map((anchor) => anchor.dataset.cardBackTone)).toEqual(
        initialColors.map((tone) => (swapped ? (tone === "blue" ? "red" : "blue") : tone)),
      );
      // The canvas must receive the same mapping as its deck/prize DOM anchors.
      const blueBackPlayer = screen.getByTestId("animated-card-layer").dataset.blueBackPlayer;
      expect(blueBackPlayer).toBe(document.body.dataset.perspective);
    }
  });

  it("keeps exactly one Turn actions panel as turns pass", () => {
    renderMatch();
    expect(document.querySelectorAll('[aria-label="Turn actions"]')).toHaveLength(1);

    // Each pass flips the hot-seat viewer and bumps game.turn — both parts
    // of seatKey — so every turn exercises the keyed remount. Driven from the
    // panel's own `Pass`, which since P5-4 is the only pass control this surface
    // has: the playmat's ⟶ was enabled exactly when the panel covered it, so it
    // was never clickable here, and it is no longer rendered.
    for (let turn = 1; turn <= 6; turn += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      expect(
        document.querySelectorAll('[aria-label="Turn actions"]'),
        `after ending turn ${turn}`,
      ).toHaveLength(1);
    }

    // The survivor is the CURRENT panel, not a leaked turn-1 instance (the
    // §4 note renders only while game.turn === 1).
    expect(document.body.textContent).not.toContain("No attacking on the first turn");
  });

  it("passes the turn from the IN-PANEL Pass button — the only one here", () => {
    // History: the playmat's ⟶ control (aria-label "Pass turn") was COVERED by
    // this panel at every ordinary viewport height — z-[75] bottom-right vs the
    // control's z-20 right-edge-centred box — so a real click there landed on an
    // attack row. The panel took over passing, and P5-4 removed the ⟶ from this
    // surface entirely rather than leave a control that could never be clicked.
    renderMatch();
    // Turn 1 is the going-first player's, so the §4 note is up — the probe the
    // leak test above uses for "this panel belongs to the current turn".
    expect(document.body.textContent).toContain("No attacking on the first turn");
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    // The turn advanced: the note is gone and exactly one panel survives.
    expect(document.body.textContent).not.toContain("No attacking on the first turn");
    expect(document.querySelectorAll('[aria-label="Turn actions"]')).toHaveLength(1);
  });
});
