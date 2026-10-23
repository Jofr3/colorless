import type { GameEvent, GameState } from "../index";
import { type CoinFace, flipCoin } from "../rng";

/** The first rng seed in `[from, from + limit)` whose next coins come up `faces`. */
export function seedForFlips(faces: readonly CoinFace[], from = 1, limit = 100_000): number {
  for (let seed = from; seed < from + limit; seed += 1) {
    let r = seed;
    let hit = true;
    for (const face of faces) {
      const [drawn, next] = flipCoin(r);
      if (drawn !== face) {
        hit = false;
        break;
      }
      r = next;
    }
    if (hit) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + limit}) flips ${faces.join(",")}`);
}

/** Rig the rng so the next coins come up `faces`. */
export function withFaces(state: GameState, faces: readonly CoinFace[]): GameState {
  return { ...state, rngState: seedForFlips(faces, state.rngState) };
}

/** How many attack-effect coin flips in `events` came up heads. */
export function headsIn(events: readonly GameEvent[]): number {
  return events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" && e.result === "heads").length;
}
