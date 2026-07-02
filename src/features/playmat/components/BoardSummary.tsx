import type { BoardState, PlayerId } from "../types";
import { describeBoard } from "../utils/boardSummary";

// An off-screen, screen-reader-only mirror of the board. The Pixi canvas that
// draws the cards is aria-hidden and the DOM card faces are visibility:hidden,
// so without this a screen-reader user perceives nothing about the game. It
// names every zone, card, and attachment from board state. Deliberately NOT a
// live region — announcing on every drag would be noise; the TurnBanner handles
// turn-change announcements, and this stays navigable on demand.
export function BoardSummary({
  board,
  perspectivePlayer,
}: {
  board: BoardState;
  perspectivePlayer: PlayerId;
}) {
  const summary = describeBoard(board, perspectivePlayer);

  return (
    <section className="sr-only" aria-label="Board state">
      <p>Stadium: {summary.stadium ?? "none in play"}.</p>
      {summary.players.map((side) => (
        <section key={side.player} aria-label={`${side.possessive} side`}>
          <p>
            {side.possessive} active Pokémon: {side.active ?? "none"}.
          </p>
          <p>
            {side.possessive} bench ({side.bench.length}):{" "}
            {side.bench.length > 0 ? side.bench.join("; ") : "empty"}.
          </p>
          {side.hand ? (
            <p>
              Your hand ({side.handCount}): {side.hand.length > 0 ? side.hand.join("; ") : "empty"}.
            </p>
          ) : (
            <p>Opponent's hand: {side.handCount} cards.</p>
          )}
          <p>
            {side.possessive} prizes remaining: {side.prizesRemaining}.
          </p>
        </section>
      ))}
    </section>
  );
}
