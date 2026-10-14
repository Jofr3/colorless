import type { ApplyResult, ReorderBenchAction } from "./actions";
import { err, ok } from "./actions";
import { topUid } from "./cards";
import type { GameState } from "./types";
import { withSide } from "./types";

/** Reordering moves the whole in-play body without using a turn allowance.
    Interrupts stay locked because their pending choices address bench indices. */
export function reorderBench(state: GameState, action: ReorderBenchAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind === "setup:place") {
    if (phase.ready[action.seat]) return err("ALREADY_READY", "setup placements are locked");
  } else if (phase.kind === "turn:action") {
    if (phase.seat !== action.seat) return err("WRONG_SEAT", `it is ${phase.seat}'s turn`);
  } else {
    return err("BAD_PHASE", `reorderBench is not legal during ${phase.kind}`);
  }

  const side = state.players[action.seat];
  if (!Number.isInteger(action.index) || action.index < 0 || action.index >= side.bench.length) {
    return err("BAD_BENCH_INDEX", "the destination must be an occupied bench position");
  }
  const fromIndex = side.bench.findIndex((pokemon) => topUid(pokemon) === action.uid);
  const pokemon = side.bench[fromIndex];
  if (pokemon === undefined)
    return err("NO_TARGET", "the dragged Pokémon is no longer on your bench");
  if (fromIndex === action.index) return ok(state, []);

  const bench = [...side.bench];
  bench.splice(fromIndex, 1);
  bench.splice(action.index, 0, pokemon);
  return ok(withSide(state, action.seat, { ...side, bench }), []);
}
