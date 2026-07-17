// Drag → engine action translation for the /play game page. The playmat's
// drop layer reports a CardMoveRequest; this pure router turns the ones that
// mean something in the current phase into a GameAction and answers null for
// everything else (the drag springs back, nothing is dispatched). It only
// ROUTES — costs, allowances, card legality all stay the engine's problem
// (D14: applyAction rejects, never throws), so a translated action may still
// come back ok:false and surface as the page's error pill.

import type { GameAction, Phase, Seat } from "@luminous/engine";
import type { BoardState, CardMoveRequest } from "../playmat/types";

export interface MoveTranslationContext {
  /** The engine phase the drag landed in. */
  phase: Phase;
  /** The seat the projection was built for (its board's "you"). */
  viewerSeat: Seat;
  /** The projected board the drag happened on — used to type the dragged
      card (energy vs Pokémon). Its own-hand CardModel.ids ARE engine uids
      (D17); hidden cards carry positional ids and are never draggable. */
  board: BoardState;
}

export function moveToAction(
  request: CardMoveRequest,
  ctx: MoveTranslationContext,
): GameAction | null {
  const { from, to, cardId } = request;
  // Every translatable move starts in the viewer's own hand: setup places,
  // energy attaches and bench plays all come from hand. Board-to-board drags
  // (bench reorder, active swap) have no M2 action — retreat and promotion go
  // through their dialogs, where the cost/choice is explicit.
  if (from.owner !== "you" || from.zone !== "hand") return null;
  if (to.owner !== "you") return null;
  // Own-hand ids are engine uids by the projection contract; a card the
  // board does not know is a stale drag — never dispatch a guessed uid.
  const model = ctx.board.you.hand.find((card) => card.id === cardId);
  if (model === undefined) return null;

  const seat = ctx.viewerSeat;
  switch (ctx.phase.kind) {
    case "setup:place": {
      // Any hand card may be AIMED at a Pokémon slot; the engine answers
      // NOT_A_BASIC_POKEMON (etc.) for the illegal ones.
      if (to.zone === "active") return { type: "setupPlaceActive", seat, uid: cardId };
      if (to.zone === "bench") return { type: "setupPlaceBench", seat, uid: cardId };
      return null;
    }
    case "turn:action": {
      // Not this seat's turn (a parked interrupt belongs elsewhere anyway —
      // those phase kinds fall through to null below).
      if (ctx.phase.seat !== seat) return null;
      if (model.type === "energy") {
        if (to.zone === "active") {
          return { type: "attachEnergy", seat, uid: cardId, target: { spot: "active" } };
        }
        // The drop layer only fires energy→bench on an occupied indexed slot
        // (gamePlacementPredicate needs a host), so a missing index is a
        // non-drop.
        if (to.zone === "bench" && to.index !== undefined) {
          return {
            type: "attachEnergy",
            seat,
            uid: cardId,
            target: { spot: "bench", index: to.index },
          };
        }
        return null;
      }
      if (model.type === "pokemon" && to.zone === "bench") {
        // The engine appends to its dense bench; the drop index is cosmetic.
        return { type: "playBasicToBench", seat, uid: cardId };
      }
      return null;
    }
    // Interrupt and setup decisions are button/dialog flows, not drags.
    default:
      return null;
  }
}
