// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { PlaymatView } from "./PlaymatView";
import { initialBoard } from "./data/mockPlaymat";
import type { CardModel, LogEntry, PileState, PlayerId } from "./types";

vi.mock("./components/AnimatedCardsLayer", () => ({ AnimatedCardsLayer: () => null }));
beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (id: string, type: CardModel["type"] = "trainer"): CardModel => ({
  id,
  cardId: id,
  name: id,
  type,
});
const ball = card("ball");
const supporter = card("supporter");
const used = [ball, supporter, card("tool", "tool"), card("stadium", "stadium"), card("recovered")];
const log: LogEntry[] = [
  { kind: "turn", turn: 3 },
  ...[...used, ball].map(
    (entry): LogEntry => ({
      kind: "action",
      who: "you",
      elapsed: "",
      segments: [],
      playedTrainer: entry,
    }),
  ),
];
const piles: Record<PlayerId, PileState> = {
  you: { deckCount: 39, discard: [card("older"), ball, supporter] },
  opponent: { deckCount: 44, discard: [card("energy", "energy")] },
};
function scene(turn: number, nextPiles = piles) {
  return (
    <StrictMode>
      <MemoryRouter>
        <PlaymatView
          board={
            turn === 3
              ? initialBoard
              : { ...initialBoard, you: initialBoard.opponent, opponent: initialBoard.you }
          }
          turn={{ turn, activePlayer: "you", youName: "You", opponentName: "Opponent" }}
          perspective="you"
          glowPerspective={turn === 3 ? "you" : "opponent"}
          logEntries={turn === 3 ? log : [...log, { kind: "turn", turn }]}
          piles={turn === 3 ? nextPiles : { you: nextPiles.opponent, opponent: nextPiles.you }}
          onMoveCard={() => {}}
        >
          <div data-testid="phase-hud">Turn {turn} controls</div>
        </PlaymatView>
      </MemoryRouter>
    </StrictMode>
  );
}

it("excludes staged Trainers from discard faces, counts and popup while preserving real piles", () => {
  render(scene(3));
  expect(screen.getByText("Your discard pile: 1 cards.")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Discard pile, top card older" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View your discard pile" }));
  expect(within(screen.getByRole("dialog")).getAllByRole("img")).toHaveLength(1);
  expect(within(screen.getByRole("dialog")).getByRole("img", { name: "older" })).toBeTruthy();
  expect(piles.you.discard.map((entry) => entry.id)).toEqual(["older", "ball", "supporter"]);
});

it("shows used Trainers in discard immediately on passing, with no animation or input delay", () => {
  const view = render(scene(3));
  view.rerender(scene(4));
  expect(document.body.dataset.perspective).toBe("opponent");
  expect(document.querySelector("[data-used-trainer-id]")).toBeNull();
  expect(document.querySelector("[inert]")).toBeNull();
  expect(screen.getByTestId("phase-hud").textContent).toBe("Turn 4 controls");
  expect(screen.getByRole("img", { name: "Discard pile, top card supporter" })).toBeTruthy();
  expect(screen.getByText("Opponent's discard pile: 3 cards.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View opponent's discard pile" }));
  expect(
    within(screen.getByRole("dialog"))
      .getAllByRole("img")
      .map((image) => image.getAttribute("aria-label")),
  ).toEqual(["supporter", "ball", "older"]);
});
