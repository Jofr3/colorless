import type { BoardState, PileState, PlayerId } from "../types";

export interface EnergyDiscardSnapshot {
  board: BoardState;
  piles?: Record<PlayerId, PileState>;
  turn: number;
  blueBackPlayer: PlayerId;
}

/** Only animate attached Energy newly entering the discard on this turn. */
export function energyDiscardsBetween(
  previous: EnergyDiscardSnapshot | null,
  next: EnergyDiscardSnapshot,
): { cardId: string; owner: PlayerId }[] {
  if (!previous?.piles || !next.piles || previous.turn !== next.turn) return [];
  const attached = new Set(
    [next.board.you, next.board.opponent].flatMap((side) =>
      [side.active, ...side.bench].flatMap(
        (card) => card?.attached?.energies.map((energy) => energy.id) ?? [],
      ),
    ),
  );
  return (["you", "opponent"] as const).flatMap((owner) => {
    const previousOwner =
      previous.blueBackPlayer === next.blueBackPlayer
        ? owner
        : owner === "you"
          ? "opponent"
          : "you";
    const discarded = new Set(previous.piles?.[previousOwner].discard.map((card) => card.id));
    const side = previous.board[previousOwner];
    const energies = new Set(
      [side.active, ...side.bench].flatMap(
        (card) => card?.attached?.energies.map((energy) => energy.id) ?? [],
      ),
    );
    return (
      next.piles?.[owner].discard
        .filter(
          (card) => energies.has(card.id) && !discarded.has(card.id) && !attached.has(card.id),
        )
        .map((card) => ({ cardId: card.id, owner })) ?? []
    );
  });
}
