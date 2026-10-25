import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import type { GameEvent } from "./events";
import type { GameOutcome, GameState } from "./types";

/** The one GAME_OVER emitter: parks the phase, clears whatever tail was
    still pending (a finished game resumes nothing) and hands consumers
    their own copy of the outcome — an event must never alias the state's
    objects (events.ts). */
export function finishGame(
  state: GameState,
  outcome: GameOutcome,
  events: GameEvent[],
): ApplyResult {
  events.push({ type: "GAME_OVER", outcome: copyOutcome(outcome) });
  return ok({ ...state, pending: [], phase: { kind: "gameOver", outcome } }, events);
}

function copyOutcome(outcome: GameOutcome): GameOutcome {
  return outcome.result === "win"
    ? { ...outcome }
    : { result: "tie", reasons: { ...outcome.reasons } };
}
