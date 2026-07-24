// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { RedactedGame, RedactedInPlay } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineMatch } from "./OnlineMatch";

// PlaymatView's BackToMenu calls useNavigate — render under a router.
const wrap = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

// OnlineMatch renders the redacted board through PlaymatView; these pin the P4
// rejection pill (2b-iii-d) it layers on top — the transient "that move isn't
// allowed" surfaced from the DO's `reject-action`, mirroring the local GamePage.

beforeAll(installDomShims);
afterEach(cleanup);

function active(name: string): RedactedInPlay {
  return {
    id: name,
    cardId: name,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
  };
}

/** A minimal well-formed turn:action snapshot — enough for PlaymatView to render. */
const GAME: RedactedGame = {
  seat: "p1",
  turn: 3,
  phase: { kind: "turn:action", attacks: [], retreat: null },
  board: {
    stadium: null,
    you: {
      hand: [],
      active: active("Sneasel"),
      bench: [],
      prizesRemaining: 6,
      deckCount: 53,
      discard: [],
    },
    opponent: {
      hand: [],
      active: active("Mareep"),
      bench: [],
      prizesRemaining: 6,
      deckCount: 53,
      discard: [],
    },
  },
  activePlayer: "you",
  waitingOn: "you",
  outcome: null,
};

describe("OnlineMatch — the rejection pill (2b-iii-d)", () => {
  it("shows the server's rejection reason and dismisses on the button", () => {
    wrap(
      <OnlineMatch
        game={GAME}
        youName="You"
        opponentName="Opp"
        actionError={{ reason: "That move isn't available here.", nonce: 1 }}
        onAction={vi.fn()}
      />,
    );
    const pill = screen.getByRole("alert");
    expect(pill.textContent).toContain("That move isn't available here.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no pill when there is no rejection", () => {
    wrap(
      <OnlineMatch game={GAME} youName="You" opponentName="Opp" actionError={null} onAction={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("re-shows a repeat rejection whose nonce restarts after an accepted action", () => {
    // useLobby resets actionError to null on an accepted `match` frame, so its
    // per-error nonce restarts at 1 — the pill must not collide with a stale
    // dismissedNonce and silently swallow the next rejection.
    const match = (actionError: { reason: string; nonce: number } | null) => (
      <MemoryRouter>
        <OnlineMatch
          game={GAME}
          youName="You"
          opponentName="Opp"
          actionError={actionError}
          onAction={vi.fn()}
        />
      </MemoryRouter>
    );
    const { rerender } = render(match({ reason: "Illegal move.", nonce: 1 }));
    // Dismiss the first pill (button — the TTL path lands on the same nonce).
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    // An accepted action clears actionError…
    rerender(match(null));
    // …then a NEW rejection reuses nonce 1 (useLobby's counter restarted): it must
    // re-show, not stay hidden behind the dismissed nonce.
    rerender(match({ reason: "Illegal again.", nonce: 1 }));
    expect(screen.getByRole("alert").textContent).toContain("Illegal again.");
  });
});
