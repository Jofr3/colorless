import type { BoardState, PileState, PlayerId } from "../types";
import { describeBoard } from "../utils/boardSummary";

// An off-screen, screen-reader-only mirror of the board. The Pixi canvas that
// draws the cards is aria-hidden and the DOM card faces are visibility:hidden,
// so without this a screen-reader user perceives nothing about the game. It
// names every zone, card, and attachment from board state — plus deck/discard
// counts when the game page supplies piles (the visible pile chips are
// aria-hidden, so this is their only accessible surface). Deliberately NOT a
// live region — announcing on every drag would be noise; the TurnBanner handles
// turn-change announcements, and this stays navigable on demand.
export function BoardSummary({
  board,
  perspectivePlayer,
  piles,
}: {
  board: BoardState;
  perspectivePlayer: PlayerId;
  /** Deck counts + public discards (game page); absent on the mock, whose
      summary must render unchanged. */
  piles?: Record<PlayerId, PileState>;
}) {
  const summary = describeBoard(board, perspectivePlayer, piles);

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
          {side.piles && (
            <>
              <p>
                {side.possessive} deck: {side.piles.deckCount} cards.
              </p>
              <p>
                {side.possessive} discard pile: {side.piles.discardCount} cards.
              </p>
            </>
          )}
        </section>
      ))}
    </section>
  );
}
