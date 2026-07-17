import type { BoardState, CardModel, PileState, PlayerId } from "../types";
import { opponentOf } from "./players";

// Builds a plain, screen-reader-oriented description of the board from state.
// Kept pure (and separate from the BoardSummary component) so it is unit-testable
// without a DOM: the Pixi canvas is aria-hidden and the DOM card faces are
// visibility:hidden, so this is the only thing a screen-reader user perceives
// about the game.

export interface PlayerBoardSummary {
  player: PlayerId;
  /** Possessive label for headings, e.g. "Your" / "Opponent's". */
  possessive: string;
  /** Active Pokémon description (name + attachments), or null when empty. */
  active: string | null;
  /** Benched Pokémon, each with its attachment detail. */
  bench: string[];
  /** Hand card names — only revealed for the perspective player. */
  hand: string[] | null;
  /** Hand size, always known even when the cards themselves are hidden. */
  handCount: number;
  prizesRemaining: number;
  /** Deck/discard sizes (game page); null when pile data is absent (mock). */
  piles: { deckCount: number; discardCount: number } | null;
}

export interface BoardSummary {
  /** Stadium card name in play, or null. */
  stadium: string | null;
  /** Opponent first, then the perspective player (top-to-bottom reading order). */
  players: PlayerBoardSummary[];
}

function attachmentDetail(card: CardModel): string {
  const tools = card.attached?.tools.length ?? 0;
  const energies = card.attached?.energies.length ?? 0;
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (energies > 0) parts.push(`${energies} energy`);
  return parts.join(", ");
}

function describeCard(card: CardModel): string {
  const detail = attachmentDetail(card);
  return detail ? `${card.name} (${detail})` : card.name;
}

export function describeBoard(
  board: BoardState,
  perspectivePlayer: PlayerId,
  piles?: Record<PlayerId, PileState>,
): BoardSummary {
  const order: PlayerId[] = [opponentOf(perspectivePlayer), perspectivePlayer];
  return {
    stadium: board.stadium?.name ?? null,
    players: order.map((player) => {
      const side = board[player];
      const pile = piles?.[player];
      const isYou = player === perspectivePlayer;
      return {
        player,
        possessive: isYou ? "Your" : "Opponent's",
        active: side.active ? describeCard(side.active) : null,
        bench: side.bench.map(describeCard),
        hand: isYou ? side.hand.map((card) => card.name) : null,
        handCount: side.hand.length,
        prizesRemaining: side.prizesRemaining,
        piles: pile ? { deckCount: pile.deckCount, discardCount: pile.discard.length } : null,
      };
    }),
  };
}
