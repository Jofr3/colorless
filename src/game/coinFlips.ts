import {
  cardOfUid,
  type GameAction,
  type GameEvent,
  type GameState,
  type Seat,
} from "@colorless/engine";

export interface CoinFlipBatch {
  id: number;
  title: string;
  flips: { result: "heads" | "tails"; player: string; seat: Seat }[];
}

/** Read resolved engine events; presentation never draws its own random result. */
export function coinFlipsFromEvents(
  events: readonly GameEvent[],
  names: Record<Seat, string>,
): CoinFlipBatch["flips"] {
  return events.flatMap((event) => {
    switch (event.type) {
      case "ATTACK_EFFECT_COIN_FLIP":
      case "ABILITY_COIN_FLIP":
      case "CHECKUP_COIN_FLIP":
      case "CONFUSION_CHECK":
      case "ATTACK_FLIP_LOCK_CHECK":
      // Quaking Fist's coin when a Trainer is played from hand.
      case "TRAINER_FLIP_LOCK_CHECK":
        return [{ result: event.result, player: names[event.seat], seat: event.seat }];
      default:
        // Setup has its own starting-player flow; don't replay its toss here.
        return [];
    }
  });
}

export function coinFlipTitle(state: GameState, action: GameAction): string {
  return action.type === "playTrainer"
    ? (cardOfUid(state, action.uid)?.name ?? "Coin flip")
    : "Coin flip";
}
