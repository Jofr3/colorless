import type { SeatLogEntry } from "@colorless/schema";

/** The uids of the Trainers played during `turn`, wherever those cards are now. */
export function usedTrainersForTurn(entries: readonly SeatLogEntry[], turn: number): string[] {
  if (turn < 1) return [];
  let currentTurn = 0;
  const uids: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "turn") currentTurn = entry.turn;
    else if (currentTurn === turn && entry.playedTrainer) uids.push(entry.playedTrainer.id);
  }
  return uids;
}
