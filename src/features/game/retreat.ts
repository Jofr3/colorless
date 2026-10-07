import {
  effectiveRetreatCost,
  isImmobilized,
  opposingRetreatBlocked,
  retreatLocked,
  type GameState,
  type Seat,
} from "@luminous/engine";
import type { BoardState, CardMoveRequest } from "../playmat/types";

export interface RetreatOption {
  cost: number;
  can: boolean;
}

export function retreatOptionForGame(game: GameState, seat: Seat): RetreatOption | null {
  const active = game.players[seat].active;
  if (game.phase.kind !== "turn:action" || game.phase.seat !== seat || active === null) {
    return null;
  }
  const cost = effectiveRetreatCost(game, active);
  return {
    cost,
    can:
      !isImmobilized(active.conditions) &&
      !retreatLocked(game, active) &&
      !opposingRetreatBlocked(game, active) &&
      !game.allowances.retreated &&
      game.allowances.attackAgainUid === null &&
      game.players[seat].bench.length > 0 &&
      active.energy.length >= cost,
  };
}

/** Resolve the dragged physical Pokémon against the current bench. */
export function retreatDragIndex(board: BoardState, request: CardMoveRequest): number | null {
  const { from, to, cardId } = request;
  if (
    from.owner !== "you" ||
    from.zone !== "bench" ||
    to.owner !== "you" ||
    to.zone !== "active" ||
    board.you.active?.type !== "pokemon"
  )
    return null;
  const index = board.you.bench.findIndex((card) => card.id === cardId && card.type === "pokemon");
  if (index < 0 || (from.index !== undefined && from.index !== index)) return null;
  return index;
}
