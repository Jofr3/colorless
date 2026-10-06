import { applyAction, cardOfUid, type GameState, type Seat } from "@luminous/engine";
import type { RedactedGame } from "@luminous/schema";

/** Check actual engine acceptance without dispatching or changing the live game. */
export function usableTrainerIdsForGame(game: GameState, seat: Seat): ReadonlySet<string> {
  const usable = new Set<string>();
  if (game.phase.kind !== "turn:action" || game.phase.seat !== seat) return usable;
  for (const uid of game.players[seat].hand) {
    const card = cardOfUid(game, uid);
    if (card?.category !== "Trainer" || !["Item", "Supporter"].includes(card.trainerType ?? "")) {
      continue;
    }
    if (applyAction(game, { type: "playTrainer", seat, uid }).ok) usable.add(uid);
  }
  return usable;
}

/** Server offers are deduplicated by card, so every matching copy can be used. */
export function usableTrainerIdsFromRedacted(game: RedactedGame): ReadonlySet<string> {
  const usable = new Set<string>();
  if (game.phase.kind !== "turn:action") return usable;
  const hand = game.board.you.hand;
  const usableCards = new Set(
    game.phase.trainers
      .filter((trainer) => !trainer.disabled && !trainer.rareCandy)
      .map((trainer) => hand.find((card) => card.id === trainer.uid)?.cardId),
  );
  for (const card of hand) {
    if (
      card.category === "Trainer" &&
      ["Item", "Supporter"].includes(card.trainerType ?? "") &&
      usableCards.has(card.cardId)
    ) {
      usable.add(card.id);
    }
  }
  return usable;
}
