import { otherSeat, type GameState, type Seat } from "./types";

/** Bonus cards this deck owner can draw because of the opponent's mulligans. */
export function pendingMulligansOf(state: GameState, seat: Seat): number {
  if (state.turn > 0 || state.phase.kind === "gameOver") return 0;
  const phase = state.phase;
  if (phase.kind === "setup:place" && phase.stage === "bonus") return 0;
  if (phase.kind === "setup:drawExtra") return phase.decided[seat] ? 0 : phase.owed[seat];
  return state.players[otherSeat(seat)].mulligans;
}
