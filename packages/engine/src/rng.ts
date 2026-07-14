// Seeded PRNG (mulberry32) threaded through GameState as a single 32-bit
// integer. Every shuffle and coin flip is a pure function of that stored
// state, so the same seed + the same actions replays to identical states and
// events (docs/workstreams/simulator.md, "Deterministic core").

export type CoinFace = "heads" | "tails";

/** One mulberry32 step: a uniform u32 plus the advanced state. The state is
    kept a signed int32 (`| 0`) so it JSON round-trips exactly. */
export function nextU32(state: number): [value: number, nextState: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** A coin flip is one bit of the next output. */
export function flipCoin(state: number): [face: CoinFace, nextState: number] {
  const [value, next] = nextU32(state);
  return [(value & 1) === 0 ? "heads" : "tails", next];
}

/** Fisher–Yates over a copy; the input array is never touched. Both indices
    are in range by construction, so the swap is unconditional — an earlier
    `!== undefined` guard silently skipped swaps (biasing the permutation
    while still consuming RNG output) for any T that admits undefined. The
    casts only satisfy noUncheckedIndexedAccess. */
export function shuffle<T>(items: readonly T[], state: number): [shuffled: T[], nextState: number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [value, next] = nextU32(s);
    s = next;
    const j = Math.floor((value / 4294967296) * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return [out, s];
}
