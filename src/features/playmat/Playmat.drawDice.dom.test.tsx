// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { PlaymatView, type PlaymatViewProps } from "./PlaymatView";

const cardsLayer = vi.fn();
vi.mock("./components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: (props: unknown) => {
    cardsLayer(props);
    return null;
  },
}));

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  cardsLayer.mockClear();
});

const player = { hand: [], active: null, bench: [], prizesRemaining: 6, faceUpPrizes: [] };
const props: PlaymatViewProps = {
  board: { you: player, opponent: player, stadium: null },
  turn: { turn: 0, activePlayer: "you", youName: "Player 1", opponentName: "Player 2" },
  perspective: "you",
  glowPerspective: "you",
  piles: {
    you: { deckCount: 46, discard: [], mulliganCount: 0 },
    opponent: { deckCount: 47, discard: [], mulliganCount: 0 },
  },
  logEntries: [],
  onMoveCard: () => {},
};

it("keeps queued dice on the recipients' decks across hot-seat swaps and removes them on draw start", () => {
  const page = render(
    <MemoryRouter>
      <PlaymatView {...props} />
    </MemoryRouter>,
  );
  // The engine has already drawn the bonus, while its animation waits behind Prizes.
  act(() => cardsLayer.mock.calls.at(-1)?.[0].onPendingMulliganDrawsChange({ blue: 2, red: 1 }));
  expect(screen.getByRole("img", { name: "Your mulligan bonus cards: 2" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Opponent's mulligan bonus cards: 1" })).toBeTruthy();
  page.rerender(
    <MemoryRouter>
      <PlaymatView {...props} glowPerspective="opponent" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("img", { name: "Your mulligan bonus cards: 1" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Opponent's mulligan bonus cards: 2" })).toBeTruthy();
  act(() => cardsLayer.mock.calls.at(-1)?.[0].onPendingMulliganDrawsChange({ blue: 0, red: 1 }));
  expect(screen.queryByRole("img", { name: "Opponent's mulligan bonus cards: 2" })).toBeNull();
  expect(screen.getByRole("img", { name: "Your mulligan bonus cards: 1" })).toBeTruthy();
  act(() => cardsLayer.mock.calls.at(-1)?.[0].onPendingMulliganDrawsChange({ blue: 0, red: 0 }));
  expect(screen.queryByRole("img", { name: /mulligan bonus cards/ })).toBeNull();
});
