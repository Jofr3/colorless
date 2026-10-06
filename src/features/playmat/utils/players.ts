import type { CardBackTone, PlayerId } from "../types";

export function opponentOf(player: PlayerId): PlayerId {
  return player === "you" ? "opponent" : "you";
}

export function cardBackToneFor(player: PlayerId, blueBackPlayer: PlayerId = "you"): CardBackTone {
  return player === blueBackPlayer ? "blue" : "red";
}
