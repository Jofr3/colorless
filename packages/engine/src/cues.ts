// Table animation cues from the event stream. A cue carries only what the event's own log row
// already shows both players: the shuffling seat, the Knocked Out Pokémon's in-play uid, a coin's
// face.

import type { LogCue } from "@colorless/schema";
import type { GameEvent } from "./events";

export function cuesFromEvents(events: readonly GameEvent[]): LogCue[] {
  return events.flatMap((event): LogCue[] => {
    switch (event.type) {
      case "SHUFFLE":
        return [{ kind: "shuffle", seat: event.seat, zone: "deck" }];
      case "HAND_SHUFFLED_INTO_DECK":
        return [{ kind: "shuffle", seat: event.seat, zone: "hand" }];
      case "KNOCKED_OUT":
        return [{ kind: "knockOut", seat: event.seat, uid: event.uid }];
      case "ATTACK_EFFECT_COIN_FLIP":
      case "ABILITY_COIN_FLIP":
      case "CHECKUP_COIN_FLIP":
      case "CONFUSION_CHECK":
      case "ATTACK_FLIP_LOCK_CHECK":
      case "TRAINER_FLIP_LOCK_CHECK":
        return [{ kind: "coin", seat: event.seat, face: event.result }];
      default:
        // The setup toss has its own starting-player flow.
        return [];
    }
  });
}
