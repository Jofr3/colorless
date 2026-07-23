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
  /** The engine phase KIND the drag landed in. Kept transport-agnostic (a kind,
      not the full `Phase`) so BOTH local play — which has the real Phase — and
      online play — which has only a redacted phase kind — drive this one router. */
  phaseKind: Phase["kind"];
  /** True only when it is the viewer's OWN `turn:action` — the turn gate the
      old `phase.seat === viewerSeat` check enforced, hoisted to the caller
      (online has no absolute seat on the phase, only "is it my turn"). */
  isViewerTurn: boolean;
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
  // The one non-own drop target: the SHARED stadium slot (owner "global" —
  // §7.3, one zone for both players). Everything else must land on the
  // viewer's own board.
  if (to.owner !== "you" && !(to.zone === "stadium" && to.owner === "global")) return null;
  // Own-hand ids are engine uids by the projection contract; a card the
  // board does not know is a stale drag — never dispatch a guessed uid.
  const model = ctx.board.you.hand.find((card) => card.id === cardId);
  if (model === undefined) return null;

  const seat = ctx.viewerSeat;
  switch (ctx.phaseKind) {
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
      if (!ctx.isViewerTurn) return null;
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
      if (model.type === "pokemon") {
        // A Pokémon dropped ONTO an existing own Pokémon is an evolve attempt
        // (§10) — the engine decides whether the card actually evolves from
        // that target (EVOLVE_MISMATCH / NOT_AN_EVOLUTION / timing). A Pokémon
        // dropped on the Active always aims at the occupant; on the bench it
        // aims at an occupied indexed slot, and otherwise means "play a Basic
        // to a new bench slot" (the dense bench appends, so the index is
        // cosmetic there).
        if (to.zone === "active") {
          return { type: "evolve", seat, uid: cardId, target: { spot: "active" } };
        }
        if (to.zone === "bench") {
          if (to.index !== undefined && ctx.board.you.bench[to.index]?.type === "pokemon") {
            return { type: "evolve", seat, uid: cardId, target: { spot: "bench", index: to.index } };
          }
          return { type: "playBasicToBench", seat, uid: cardId };
        }
        return null;
      }
      if (model.type === "tool") {
        // A Tool attaches like an energy: onto the Active, or onto an occupied
        // indexed bench slot (§7.4). One-Tool-per-Pokémon stays the engine's.
        if (to.zone === "active") {
          return { type: "attachTool", seat, uid: cardId, target: { spot: "active" } };
        }
        if (to.zone === "bench" && to.index !== undefined) {
          return { type: "attachTool", seat, uid: cardId, target: { spot: "bench", index: to.index } };
        }
        return null;
      }
      if (model.type === "stadium") {
        // A Stadium dropped on the shared slot is a play (§7.3) — the one
        // gesture that lands OUTSIDE the viewer's own board. Same-name /
        // once-per-turn legality stays the engine's (the pill).
        if (to.zone === "stadium" && to.owner === "global") {
          return { type: "playTrainer", seat, uid: cardId };
        }
        return null;
      }
      return null;
    }
    // Interrupt and setup decisions are button/dialog flows, not drags.
    default:
      return null;
  }
}
