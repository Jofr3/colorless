// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { RedactedGame, RedactedInPlay, SeatLogEntry } from "@luminous/schema";
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
  phase: {
    kind: "turn:action",
    attacks: [],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
  },
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
        log={[]}
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
      <OnlineMatch
        game={GAME}
        log={[]}
        youName="You"
        opponentName="Opp"
        actionError={null}
        onAction={vi.fn()}
      />,
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
          log={[]}
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

describe("OnlineMatch — the game log (2b-iii-d-ii)", () => {
  const LOG: SeatLogEntry[] = [
    { kind: "action", who: "p1", elapsed: "+00:01", segments: [{ text: "drew 7 cards" }] },
    { kind: "action", who: "p2", elapsed: "+00:02", segments: [{ text: "shuffled their deck" }] },
  ];

  it("renders the seat-keyed log relabeled for this viewer's seat", () => {
    // GAME.seat is p1, so its own p1 rows read YOU and the p2 rows read OPP — the
    // viewLogEntries relabel over the server's viewer-independent log.
    wrap(
      <OnlineMatch
        game={GAME}
        log={LOG}
        youName="You"
        opponentName="Opp"
        actionError={null}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show game log" }));
    expect(screen.getByText("drew 7 cards")).toBeTruthy();
    expect(screen.getByText("shuffled their deck")).toBeTruthy();
    expect(screen.getAllByText(/^(YOU|OPP)$/).map((b) => b.textContent)).toEqual(["YOU", "OPP"]);
  });
});

describe("OnlineMatch — concede (3c-iii)", () => {
  function renderMatch(overrides: Partial<RedactedGame> = {}, onAction = vi.fn()) {
    wrap(
      <OnlineMatch
        game={{ ...GAME, ...overrides }}
        log={[]}
        youName="You"
        opponentName="Opp"
        actionError={null}
        onAction={onAction}
      />,
    );
    return onAction;
  }

  it("confirms first, then dispatches a seat-bound concede", () => {
    const onAction = renderMatch();
    fireEvent.click(screen.getByRole("button", { name: "Concede" }));
    // The button alone must not end the match — an irreversible action gets a
    // confirmation, and cancelling it dispatches nothing.
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Concede" }));
    const confirm = screen
      .getAllByRole("button", { name: "Concede" })
      .find((b) => b.closest("dialog") !== null);
    if (confirm === undefined) throw new Error("expected a confirm button inside the dialog");
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({ type: "concede", seat: "p1" });
  });

  it("is offered on the OPPONENT's turn — the case it matters most for", () => {
    // Waiting out an opponent who has walked away is exactly when a player wants
    // out, and it is why the control sits in the HUD chrome rather than the turn
    // panel (which only renders on your own turn).
    const onAction = renderMatch({ activePlayer: "opponent", waitingOn: "opponent" });
    expect(screen.getByRole("button", { name: "Concede" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concede" }));
    const confirm = screen
      .getAllByRole("button", { name: "Concede" })
      .find((b) => b.closest("dialog") !== null);
    if (confirm === undefined) throw new Error("expected a confirm button inside the dialog");
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({ type: "concede", seat: "p1" });
  });

  it("warns that leaving forfeits, and stops warning once the game is over (3c-iv)", () => {
    // The Back control is a leave, and the DO now concedes for a player who walks
    // out of a running match — so the confirmation has to say so. (The dialog's
    // content is in the DOM whether or not it is open; this pins the copy, not
    // the native <dialog> plumbing.)
    renderMatch();
    expect(screen.getByText("Leaving forfeits the match — your opponent wins immediately."))
      .toBeTruthy();

    cleanup();
    renderMatch({ outcome: { result: "win", winner: "you", reason: "prizesTaken" } });
    expect(screen.getByText("The match is over. You'll return to the main menu.")).toBeTruthy();
  });

  it("disappears once the game is over (nothing left to concede)", () => {
    renderMatch({ outcome: { result: "win", winner: "opponent", reason: "conceded" } });
    expect(screen.queryByRole("button", { name: "Concede" })).toBeNull();
    // …and the overlay explains WHY, which is new in 3c-ii: a bare "Opp wins"
    // would leave a forfeit unexplained.
    // Neutral phrasing: the SAME line is shown to the winner and the loser, so it
    // must not claim "the opponent" did it (the conceding player is reading it).
    expect(screen.getByText("The match was forfeited.")).toBeTruthy();
  });
});
