import { cardImageUrl } from "../lib/api";
import type { CardModel, LogEntry } from "./board";

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
