import type { CardModel, FaceUpPrize, PlayerId } from "../types";

export const PRIZE_COUNT = 6;
export const PRIZE_COLUMNS = 2;
export const PRIZE_ROWS = 3;

/** 🆕🆕🆕 D551 — what one prize grid slot shows: nothing (the prize was taken), a card
    back (a face-down prize), or a face-up card (a prize Crescent Purge turned — public to
    every viewer, D548). */
export type PrizeSlotFace = null | "back" | { card: CardModel };

// Front-to-back ordering of the 6 grid slots. For the bottom side (flipped=false)
// the remaining prizes occupy slots 0..remaining-1; on the top side (flipped=true)
// the remaining prizes occupy the higher slot indices so that "taken" reads
// from the same edge visually.
//
// 🆕🆕🆕 D551 — THE SINGLE MAPPING from an engine prize-row index to a grid slot. The engine's
// row compacts on every take (a `FaceUpPrize.index` is a position in the LIVE row), so with
// `taken = PRIZE_COUNT - remaining` (clamped): bottom side, row index i -> slot i; top side,
// row index i -> slot taken + i. PrizeGrid (DOM) and the Pixi prize descriptors both branch
// on THIS function only, and `prizeSlots` below is its presence projection — no file keeps
// an independent mapping. A face-up index outside the live row paints nothing (total).
export function prizeSlotFaces(
  remaining: number,
  faceUp: readonly FaceUpPrize[],
  flipped: boolean,
): PrizeSlotFace[] {
  const taken = Math.max(0, Math.min(PRIZE_COUNT, PRIZE_COUNT - remaining));
  const present = PRIZE_COUNT - taken;
  const offset = flipped ? taken : 0;
  const faces: PrizeSlotFace[] = Array.from({ length: PRIZE_COUNT }, (_, slot) =>
    slot >= offset && slot < offset + present ? "back" : null,
  );
  for (const { index, card } of faceUp) {
    if (index < 0 || index >= present) continue;
    faces[offset + index] = { card };
  }
  return faces;
}

/** Which grid slots still hold a prize — the presence projection of prizeSlotFaces. */
export function prizeSlots(remaining: number, flipped: boolean): boolean[] {
  return prizeSlotFaces(remaining, [], flipped).map((face) => face !== null);
}

export function deckBackId(owner: PlayerId): string {
  return `back-deck-${owner}`;
}

export function prizeBackId(owner: PlayerId, slotIndex: number): string {
  return `back-prize-${owner}-${slotIndex}`;
}
