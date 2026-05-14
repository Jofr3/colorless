import type { PlayerId } from "../types";

export const PRIZE_COUNT = 6;
export const PRIZE_COLUMNS = 2;
export const PRIZE_ROWS = 3;

// Front-to-back ordering of the 6 grid slots. For the bottom side (flipped=false)
// the remaining prizes occupy slots 0..remaining-1; on the top side (flipped=true)
// the remaining prizes occupy the higher slot indices so that "taken" reads
// from the same edge visually.
export function prizeSlots(remaining: number, flipped: boolean): boolean[] {
  const taken = Math.max(0, Math.min(PRIZE_COUNT, PRIZE_COUNT - remaining));
  return Array.from({ length: PRIZE_COUNT }, (_, index) =>
    flipped ? index >= taken : index < PRIZE_COUNT - taken,
  );
}

export function deckBackId(owner: PlayerId): string {
  return `back-deck-${owner}`;
}

export function prizeBackId(owner: PlayerId, slotIndex: number): string {
  return `back-prize-${owner}-${slotIndex}`;
}
