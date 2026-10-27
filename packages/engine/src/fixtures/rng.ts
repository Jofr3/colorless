import type { GameEvent, GameState } from "../index";
import { type CoinFace, type DrbgState, type RngState, flipCoin } from "../rng";

/** Whether the next coins from `state` come up `faces`. */
function flipsAre(state: RngState, faces: readonly CoinFace[]): boolean {
  let r = state;
  for (const face of faces) {
    const [drawn, next] = flipCoin(r);
    if (drawn !== face) return false;
    r = next;
  }
  return true;
}

/** The first rng seed in `[from, from + limit)` whose next coins come up `faces`. */
export function seedForFlips(faces: readonly CoinFace[], from = 1, limit = 100_000): number {
  for (let seed = from; seed < from + limit; seed += 1) {
    if (flipsAre(seed, faces)) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + limit}) flips ${faces.join(",")}`);
}

/** The first ChaCha20 state on `state`'s key, at or after its counter, whose next coins come up
    `faces`: the key is kept and only words are skipped. */
function drbgForFlips(state: DrbgState, faces: readonly CoinFace[], limit = 100_000): DrbgState {
  for (let skip = 0; skip < limit; skip += 1) {
    const at = { ...state, counter: state.counter + skip };
    if (flipsAre(at, faces)) return at;
  }
  throw new Error(`no counter within ${limit} words flips ${faces.join(",")}`);
}

/** Rig the rng so the next coins come up `faces`, keeping its generator. */
export function withFaces(state: GameState, faces: readonly CoinFace[]): GameState {
  const rng = state.rngState;
  return {
    ...state,
    rngState: typeof rng === "number" ? seedForFlips(faces, rng) : drbgForFlips(rng, faces),
  };
}

/** A fixed ChaCha20 state for `n`, so a test runs a seeded game on the generator real games use.
    Distinct `n` give distinct keys. Never a production key: those come from `freshRngState`. */
export function drbgSeed(n: number): DrbgState {
  return { alg: "chacha20", key: (n >>> 0).toString(16).padStart(64, "0"), counter: 0 };
}

/** A numeric-seed game's mulberry32 state, for a test that does arithmetic on it; throws on a
    ChaCha20 state, whose words cannot be stepped that way. */
export function legacyRngOf(state: GameState): number {
  if (typeof state.rngState !== "number") throw new Error("expected a numeric-seed game");
  return state.rngState;
}

/** How many attack-effect coin flips in `events` came up heads. */
export function headsIn(events: readonly GameEvent[]): number {
  return events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" && e.result === "heads").length;
}
