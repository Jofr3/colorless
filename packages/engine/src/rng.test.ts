import { describe, expect, it, vi } from "vitest";
import { createGame, type GameAction, type GameState } from "./index";
import {
  type CoinFace,
  type DrbgState,
  flipCoin,
  freshRngState,
  isRngState,
  nextU32,
  randomIndex,
  type RngState,
  shuffle,
} from "./rng";
import { MIXED_DECK, drbgSeed, mustApply, mustCreate, walkGame } from "./testFixtures";

// The match RNG (security audit MI1). Every real game draws from a ChaCha20 keystream under a fresh
// 256-bit key; states recorded on the old mulberry32 generator keep replaying on it.

/** The Web Crypto global; the engine compiles without DOM types. */
const webCrypto = (
  globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }
).crypto;

const ZERO_KEY: DrbgState = { alg: "chacha20", key: "0".repeat(64), counter: 0 };

function words(state: RngState, count: number): [values: number[], next: RngState] {
  const values: number[] = [];
  let s = state;
  for (let i = 0; i < count; i++) {
    const [value, next] = nextU32(s);
    values.push(value);
    s = next;
  }
  return [values, s];
}

describe("the ChaCha20 generator", () => {
  it("is the RFC 8439 keystream, read as little-endian words in order across blocks", () => {
    // RFC 8439 appendix A.1, test vectors #1 and #2: all-zero key and nonce, block counters 0 and
    // 1. A wrong byte order, nonce or block-to-counter mapping changes these.
    const [values] = words(ZERO_KEY, 18);
    expect(values.map((v) => v.toString(16).padStart(8, "0"))).toEqual([
      "ade0b876",
      "903df1a0",
      "e56a5d40",
      "28bd8653",
      "b819d2bd",
      "1aed8da0",
      "ccef36a8",
      "c70d778b",
      "7c5941da",
      "8d485751",
      "3fe02477",
      "374ad8b8",
      "f4b8436a",
      "1ca11815",
      "69b687c3",
      "8665eeb2",
      "bee7079f",
      "7a385155",
    ]);
  });

  it("advances the counter by one word per draw and keeps the key", () => {
    const [, after] = words(ZERO_KEY, 5);
    expect(after).toEqual({ ...ZERO_KEY, counter: 5 });
    // Resuming from a mid-block counter reads the same words as drawing through to it.
    const [all] = words(ZERO_KEY, 40);
    const [tail] = words({ ...ZERO_KEY, counter: 13 }, 27);
    expect(tail).toEqual(all.slice(13));
  });

  it("answers a key from its own keystream when draws from two games interleave", () => {
    const a = drbgSeed(1);
    const b = drbgSeed(2);
    const [aAlone] = words(a, 20);
    const [bAlone] = words(b, 20);
    const mixed: number[][] = [[], []];
    let sa: RngState = a;
    let sb: RngState = b;
    for (let i = 0; i < 20; i++) {
      const [va, na]: [number, RngState] = nextU32(sa);
      const [vb, nb]: [number, RngState] = nextU32(sb);
      mixed[0]?.push(va);
      mixed[1]?.push(vb);
      [sa, sb] = [na, nb];
    }
    expect(mixed).toEqual([aAlone, bAlone]);
    expect(aAlone).not.toEqual(bAlone);
  });

  it("every helper returns a ChaCha20 state from a ChaCha20 state", () => {
    const seed = drbgSeed(9);
    expect(flipCoin(seed)[1]).toEqual({ ...seed, counter: 1 });
    expect(randomIndex(6, seed)[1]).toEqual({ ...seed, counter: 1 });
    expect(randomIndex(0, seed)[1]).toBe(seed);
    const [deck, next] = shuffle([...Array(60).keys()], seed);
    expect(next).toEqual({ ...seed, counter: 59 });
    expect([...deck].sort((x, y) => x - y)).toEqual([...Array(60).keys()]);
  });

  it("flips both faces about equally", () => {
    let heads = 0;
    let s: RngState = drbgSeed(3);
    for (let i = 0; i < 10_000; i++) {
      const [face, next]: [CoinFace, RngState] = flipCoin(s);
      if (face === "heads") heads++;
      s = next;
    }
    expect(heads).toBeGreaterThan(4_800);
    expect(heads).toBeLessThan(5_200);
  });
});

describe("freshRngState", () => {
  it("keys every new state with 32 bytes from the platform CSPRNG", () => {
    const spy = vi.spyOn(webCrypto, "getRandomValues");
    const a = freshRngState();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as Uint8Array).length).toBe(32);
    spy.mockRestore();
    const b = freshRngState();
    for (const state of [a, b]) {
      expect(state).toMatchObject({ alg: "chacha20", counter: 0 });
      expect(state.key).toMatch(/^[0-9a-f]{64}$/);
      expect(isRngState(state)).toBe(true);
    }
    expect(a.key).not.toBe(b.key);
  });
});

describe("the legacy mulberry32 generator", () => {
  it("draws exactly what it drew before ChaCha20 was added, so old saves replay", () => {
    // Pinned from the generator as shipped before MI1; a numeric state never touches ChaCha20.
    expect(words(1, 3)).toEqual([[2693262067, 11749833, 2265367787], 1199730144]);
    expect(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1)).toEqual([
      [7, 8, 3, 2, 1, 5, 9, 4, 0, 6],
      expect.any(Number),
    ]);
  });
});

describe("isRngState", () => {
  it("accepts an int32 and a well-formed ChaCha20 state", () => {
    for (const ok of [0, -1, 2 ** 31 - 1, -(2 ** 31), ZERO_KEY, { ...ZERO_KEY, counter: 2 ** 35 }])
      expect(isRngState(ok), JSON.stringify(ok)).toBe(true);
  });

  it("refuses anything a draw would misread", () => {
    for (const bad of [
      1.5,
      2 ** 31,
      Number.NaN,
      "1",
      null,
      undefined,
      {},
      { ...ZERO_KEY, alg: "mulberry32" },
      { ...ZERO_KEY, key: "0".repeat(63) },
      { ...ZERO_KEY, key: "G".repeat(64) },
      { ...ZERO_KEY, key: "A".repeat(64) },
      { ...ZERO_KEY, counter: -1 },
      { ...ZERO_KEY, counter: 0.5 },
      { ...ZERO_KEY, counter: 2 ** 36 },
      { alg: "chacha20", key: "0".repeat(64) },
    ])
      expect(isRngState(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("a ChaCha20 game", () => {
  it("starts on its seed and deals from it: two shuffles of 60 and the coin", () => {
    const { state } = mustCreate(drbgSeed(5));
    expect(state.rngState).toEqual({ ...drbgSeed(5), counter: 59 + 59 + 1 });
    expect(mustCreate(drbgSeed(5)).state).toEqual(state);
    expect(mustCreate(drbgSeed(6)).state.players.p1.deck).not.toEqual(state.players.p1.deck);
  });

  it("deals differently from the legacy game whose seed number it shares", () => {
    const legacy = mustCreate(5).state;
    expect(typeof legacy.rngState).toBe("number");
    expect(mustCreate(drbgSeed(5)).state.players.p1.deck).not.toEqual(legacy.players.p1.deck);
  });

  it("replays to the same states from the same start and actions, as a local save does", () => {
    const start = mustCreate(drbgSeed(11), { p1: MIXED_DECK, p2: MIXED_DECK }).state;
    const actions: GameAction[] = [];
    let end: GameState = start;
    walkGame(start, 11, () => {}, {
      maxSteps: 200,
      onStep: (_before, action, _events, after) => {
        actions.push(action);
        end = after;
      },
    });
    expect(actions.length).toBeGreaterThan(50);
    const replayed = actions.reduce(
      (state, action) => mustApply(state, action).state,
      JSON.parse(JSON.stringify(start)) as GameState,
    );
    expect(replayed).toEqual(end);
    expect(isRngState(end.rngState) && typeof end.rngState === "object").toBe(true);
  });

  it("createGame keeps a ChaCha20 seed as given", () => {
    const seed = drbgSeed(8);
    const created = createGame({
      seed,
      decks: { p1: MIXED_DECK, p2: MIXED_DECK },
      cardPool: mustCreate(1).state.cardPool,
    });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.state.rngState).toMatchObject({ alg: "chacha20", key: seed.key });
  });
});
