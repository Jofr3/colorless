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
import { LocalMatch } from "./GamePage";

// Pixi can't initialise in jsdom (no WebGL); everything else is real.
vi.mock("../playmat/components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: () => null,
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
  it("keeps exactly one Turn actions panel as turns pass", () => {
    renderMatch();
    expect(document.querySelectorAll('[aria-label="Turn actions"]')).toHaveLength(1);

    // Each pass flips the hot-seat viewer and bumps game.turn — both parts
    // of seatKey — so every turn exercises the keyed remount.
    for (let turn = 1; turn <= 6; turn += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pass turn" }));
      expect(
        document.querySelectorAll('[aria-label="Turn actions"]'),
        `after ending turn ${turn}`,
      ).toHaveLength(1);
    }

    // The survivor is the CURRENT panel, not a leaked turn-1 instance (the
    // §4 note renders only while game.turn === 1).
    expect(document.body.textContent).not.toContain("No attacking on the first turn");
  });
});
