import { cardImageUrl } from "../../../lib/api";
import type { CardModel, LogEntry, PileState, PlayerId } from "../types";

export function pilesWithoutUsedTrainers(
  cards: readonly CardModel[],
  piles?: Record<PlayerId, PileState>,
): Record<PlayerId, PileState> | undefined {
  if (!piles) return undefined;
  const ids = new Set(cards.map((card) => card.id));
  const visible = (owner: PlayerId): PileState => ({
    ...piles[owner],
    discard: piles[owner].discard.filter((card) => !ids.has(card.id)),
  });
  return { you: visible("you"), opponent: visible("opponent") };
}

/** Read the selected turn's public plays, including cards recovered or still attached. */
export function usedTrainersForTurn(entries: readonly LogEntry[], turn: number): CardModel[] {
  if (turn < 1) return [];
  let currentTurn = 0;
  const cards: CardModel[] = [];
  for (const entry of entries) {
    if (entry.kind === "turn") {
      currentTurn = entry.turn;
    } else if (currentTurn === turn && entry.playedTrainer) {
      cards.push({
        ...entry.playedTrainer,
        type: "trainer",
        imageUrl: cardImageUrl(entry.playedTrainer.cardId, "high"),
      });
    }
  }
  return cards;
}
