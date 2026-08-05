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

/** The runaway guard on `flipUntilTails` (D129), and the ONE thing that makes an
    unbounded fold safe to run inside the resolution loop.

    THIS IS NOT A RULE ABOUT THE POOL, unlike `MAX_PRINTED_FLIPS` in effects.ts.
    That ceiling refuses a MALFORMED ROW at derivation, loudly, before anything
    runs; there is no malformed row to refuse here — "Flip a coin until you get
    tails." is a legal, fully-specified sentence whose length is a fact about the
    RNG, not about the text or the board. So this constant cannot be a refusal.
    It is a bound on THIS MODULE'S OWN OUTPUT: a promise that the flip sequence
    terminates even if `flipCoin` is one day replaced by something degenerate.

    WHY 64 AND WHY IT CANNOT FIRE TODAY. mulberry32's pre-states advance by a
    FIXED ODD STRIDE (`state + 0x6d2b79f5`), so successive flips walk `n · K mod
    2³²` and, over 2³² steps, visit every int32 exactly once. The face sequence is
    therefore ONE fixed cycle, and its worst case is a measurable number rather
    than a probability. Measured over the whole cycle (all 4 294 967 296 steps,
    plus the wrap: the cycle ends "…HH" and begins "H…", so no run straddles the
    seam): the LONGEST RUN OF CONSECUTIVE HEADS IS 31. 64 is twice that, so with
    the current `flipCoin` this cap is unreachable from any seed — the guard is
    dead code by construction, which is exactly what a guard of this kind should
    be. To re-derive after changing `nextU32`, scan `n · K` for n in [0, 2³²) and
    take the longest heads run; a run of 40s of arithmetic answers it exactly.

    IF IT EVER DID FIRE it would TRUNCATE — the returned faces are all heads and
    the caller sees a sequence that does not end in tails. That is a lie about the
    game, which is why the bound is set where no fair sequence can reach it rather
    than at a "surely enough" number like 10. `flipUntilTails` returns the faces
    (not a count) precisely so a caller can detect the truncation if it wants to. */
export const MAX_UNTIL_TAILS_FLIPS = 64;

/** Flip until the first tails, or until `cap` faces have been taken (D129) —
    the sequence "Flip a coin until you get tails." calls for, as a value.

    Returns every face IN ORDER, so the caller announces the same rows it would
    for a counted fold and never has to re-derive the sequence from the returned
    state. The last face is "tails" unless the cap truncated it, in which case all
    `cap` faces are heads — the one shape a caller can test for.

    `cap` is a PARAMETER rather than a read of `MAX_UNTIL_TAILS_FLIPS` so the
    truncation branch is reachable in a test at any cap: the constant is set above
    what the real RNG can produce (see above), so a test that could only drive the
    engine's own value could never observe what the bound does. `cap <= 0` takes
    no flips at all and advances nothing. */
export function flipUntilTails(state: number, cap: number): [faces: CoinFace[], nextState: number] {
  const faces: CoinFace[] = [];
  let s = state;
  while (faces.length < cap) {
    const [face, next] = flipCoin(s);
    s = next;
    faces.push(face);
    if (face === "tails") break;
  }
  return [faces, s];
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
