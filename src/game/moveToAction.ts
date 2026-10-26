// Translates a drag on the table into an engine action, or null when the move means nothing in the
// current phase (the drag springs back). It only routes; costs and legality are left to the engine,
// which rejects invalid actions.

import type { GameAction } from "@colorless/engine";
import type { RedactedGame } from "@colorless/schema";

type PlayerId = "you" | "opponent";

/** A table slot. `index` is absent on a whole-zone drop (the bench frame), which appends. */
export type CardPlacement =
  | { owner: PlayerId; zone: "hand" | "bench"; index?: number }
  | { owner: PlayerId; zone: "active" }
  /** Drop-only surface: Trainers resolve through the engine, never live here. */
  | { owner: PlayerId; zone: "playmat" }
  /** The one Stadium slot both players share. */
  | { owner: "global"; zone: "stadium" };

export interface CardMoveRequest {
  /** The dragged card's uid; own-hand and in-play ids on the redacted board are engine uids. */
  cardId: string;
  from: CardPlacement;
  to: CardPlacement;
}

export function moveToAction(request: CardMoveRequest, view: RedactedGame): GameAction | null {
  const { from, to, cardId } = request;
  const phase = view.phase.kind;
  const seat = view.seat;
  const isViewerTurn = phase === "turn:action" && view.activePlayer === "you";
  const you = view.board.you;
  if (from.owner === "you" && from.zone === "bench" && to.owner === "you" && to.zone === "bench") {
    if (phase !== "setup:place" && !isViewerTurn) return null;
    const fromIndex = you.bench.findIndex((card) => card.id === cardId);
    const index = to.index ?? you.bench.length - 1;
    if (
      fromIndex < 0 ||
      from.index !== fromIndex ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= you.bench.length
    )
      return null;
    return { type: "reorderBench", seat, uid: cardId, index };
  }
  // The remaining translatable moves start in the viewer's own hand: setup places,
  // attachments, bench plays and Trainer plays all come from hand. Bench-to-Active swaps
  // are handled separately: the simulator's retreat command picks the Bench Pokémon and
  // the Energy to pay before dispatching the swap.
  if (from.owner !== "you" || from.zone !== "hand") return null;
  // The one non-own drop target: the SHARED stadium slot (owner "global" —
  // §7.3, one zone for both players). Everything else must land on the
  // viewer's own board.
  if (to.owner !== "you" && !(to.zone === "stadium" && to.owner === "global")) return null;
  // A card the hand does not hold is a stale drag — never dispatch a guessed uid.
  const card = you.hand.find((c) => c.id === cardId);
  if (card === undefined) return null;

  switch (phase) {
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
      if (!isViewerTurn) return null;
      if (card.category === "Trainer") {
        if (card.trainerType === "Stadium") {
          // A Stadium dropped on the shared slot is a play (§7.3) — the one
          // gesture that lands OUTSIDE the viewer's own board. Same-name /
          // once-per-turn legality stays the engine's (the pill).
          return to.zone === "stadium" ? { type: "playTrainer", seat, uid: cardId } : null;
        }
        if (card.trainerType === "Tool") {
          // A Tool attaches like an energy: onto the Active, or onto an occupied
          // indexed bench slot (§7.4). One-Tool-per-Pokémon stays the engine's.
          if (to.zone === "active")
            return { type: "attachTool", seat, uid: cardId, target: { spot: "active" } };
          if (to.zone === "bench" && to.index !== undefined)
            return {
              type: "attachTool",
              seat,
              uid: cardId,
              target: { spot: "bench", index: to.index },
            };
          return null;
        }
        return to.zone === "playmat" ? { type: "playTrainer", seat, uid: cardId } : null;
      }
      if (card.category === "Energy") {
        if (to.zone === "active")
          return { type: "attachEnergy", seat, uid: cardId, target: { spot: "active" } };
        // The drop layer only fires energy→bench on an occupied indexed slot
        // (gamePlacementPredicate needs a host), so a missing index is a
        // non-drop.
        if (to.zone === "bench" && to.index !== undefined)
          return {
            type: "attachEnergy",
            seat,
            uid: cardId,
            target: { spot: "bench", index: to.index },
          };
        return null;
      }
      if (card.category === "Pokemon") {
        // Basics open a new Bench slot even over an existing occupant.
        // Other Pokémon aimed at an occupied slot attempt evolution; the
        // engine checks the evolution match and timing. The Active always
        // aims at its occupant. New Bench plays append, so their index is cosmetic.
        if (to.zone === "active")
          return { type: "evolve", seat, uid: cardId, target: { spot: "active" } };
        if (to.zone === "bench") {
          if (
            card.stage !== "Basic" &&
            to.index !== undefined &&
            you.bench[to.index]?.category === "Pokemon"
          )
            return {
              type: "evolve",
              seat,
              uid: cardId,
              target: { spot: "bench", index: to.index },
            };
          return { type: "playBasicToBench", seat, uid: cardId };
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
