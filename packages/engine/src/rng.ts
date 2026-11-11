// The game's random number generator, threaded through GameState as `rngState`. Every shuffle and
// coin flip is a pure function of that stored state, so the same starting state + the same actions
// replays to identical states and events (docs/workstreams/simulator.md, "Deterministic core").
//
// Two generators share one interface:
//
// - A ChaCha20 keystream (`DrbgState`): a 256-bit secret key and a word counter. Every real game
//   starts from `freshRngState()`, the lobby's online matches and the local simulator's new games
//   alike. Seeing any number of its outputs says nothing usable about the key or the next output.
// - mulberry32 (a bare number), the generator every game used before. Its whole state is 32 bits,
//   so a player's opening hand pins it by brute force, which is why no new game uses it. It stays
//   for the states that already carry it, since a local save replays only under the generator it
//   was recorded with, and for the numeric seeds of tests, fixtures and the benchmark.
//
// A state keeps its generator for the whole game: each draw returns a state of the form it took.

import { chacha20 } from "@noble/ciphers/chacha.js";

/** The Web Crypto CSPRNG, global in Workers, browsers, Bun and Node. The engine compiles without
    DOM types, so the one member it uses is declared here. */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export type CoinFace = "heads" | "tails";

/**
 * The ChaCha20 generator's state. Plain JSON, so it persists and replays like the rest of the game
 * state. The key is secret: whoever holds it can predict every later shuffle and flip, so it never
 * leaves the host that runs the game (`redactGame` sends no part of `rngState`).
 */
export interface DrbgState {
  /** Names the generator, so a later one can be told apart from this one. */
  readonly alg: "chacha20";
  /** The 256-bit key as 64 lowercase hex digits. */
  readonly key: string;
  /** How many u32 words have been drawn; the next draw is keystream word `counter`. */
  readonly counter: number;
}

/** A ChaCha20 state, or a legacy mulberry32 state (a signed int32). */
export type RngState = number | DrbgState;

/** The number of distinct `nextU32` values. */
const U32_RANGE = 2 ** 32;

/** u32 words per 64-byte ChaCha20 block. */
const WORDS_PER_BLOCK = 16;

/** One past the last word ChaCha20's 32-bit block counter reaches (noble does not let it wrap). */
const MAX_DRBG_WORDS = 2 ** 32 * WORDS_PER_BLOCK;

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** A fresh ChaCha20 state with a key from the platform CSPRNG (Workers, browsers, Bun and Node
    all provide `crypto.getRandomValues`). The one place a game's randomness comes from. */
export function freshRngState(): DrbgState {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return { alg: "chacha20", key: toHex(key), counter: 0 };
}

/** Whether `value` is a state `nextU32` can draw from: an int32, or a well-formed ChaCha20 state. */
export function isRngState(value: unknown): value is RngState {
  if (typeof value === "number") return Number.isInteger(value) && (value | 0) === value;
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state.alg === "chacha20" &&
    typeof state.key === "string" &&
    KEY_PATTERN.test(state.key) &&
    Number.isSafeInteger(state.counter) &&
    (state.counter as number) >= 0 &&
    (state.counter as number) < MAX_DRBG_WORDS
  );
}

/** One draw: a uniform u32 plus the advanced state, of the same generator. */
export function nextU32(state: number): [value: number, nextState: number];
export function nextU32(state: RngState): [value: number, nextState: RngState];
export function nextU32(state: RngState): [value: number, nextState: RngState] {
  return typeof state === "number" ? nextMulberry32(state) : nextDrbg(state);
}

/** One mulberry32 step. The state is kept a signed int32 (`| 0`) so it JSON round-trips exactly. */
function nextMulberry32(state: number): [value: number, nextState: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** Keystream word `counter` of the state's key, and the state one word on. */
function nextDrbg(state: DrbgState): [value: number, nextState: DrbgState] {
  const { counter } = state;
  const words = keystreamBlock(state.key, Math.floor(counter / WORDS_PER_BLOCK));
  const value = words[counter % WORDS_PER_BLOCK] as number;
  return [value, { alg: state.alg, key: state.key, counter: counter + 1 }];
}

const ZERO_NONCE = new Uint8Array(12);
const ZERO_BLOCK = new Uint8Array(64);

/** The last block computed. Draws walk a block's 16 words in order, so one entry serves 15 of
    every 16; it is keyed by value, so it never answers for another key or block. */
let lastBlock: { key: string; block: number; words: Uint32Array } | null = null;

/** ChaCha20 block `block` of `key` (RFC 8439, an all-zero nonce: each key is used for one game)
    as 16 little-endian u32 words. */
function keystreamBlock(key: string, block: number): Uint32Array {
  if (lastBlock !== null && lastBlock.key === key && lastBlock.block === block) {
    return lastBlock.words;
  }
  const bytes = chacha20(fromHex(key), ZERO_NONCE, ZERO_BLOCK, new Uint8Array(64), block);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint32Array(WORDS_PER_BLOCK);
  for (let i = 0; i < WORDS_PER_BLOCK; i++) words[i] = view.getUint32(i * 4, true);
  lastBlock = { key, block, words };
  return words;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A coin flip is one bit of the next output. */
export function flipCoin(state: number): [face: CoinFace, nextState: number];
export function flipCoin(state: RngState): [face: CoinFace, nextState: RngState];
export function flipCoin(state: RngState): [face: CoinFace, nextState: RngState] {
  const [value, next] = nextU32(state);
  return [(value & 1) === 0 ? "heads" : "tails", next];
}

/**
 * Runaway guard on `flipUntilTails`. With mulberry32 the longest heads run over the whole cycle is
 * 31, and with ChaCha20 a run of 64 has probability 2⁻⁶⁴, so 64 is unreachable in practice; if it
 * ever fired, the returned faces would be all heads (truncated).
 */
export const MAX_UNTIL_TAILS_FLIPS = 64;

/**
 * Flip until the first tails, or until `cap` faces have been taken. Returns every face in order;
 * the last face is tails unless the cap truncated the run. `cap` is a parameter so truncation is
 * testable, and `cap <= 0` takes no flips.
 */
export function flipUntilTails(state: number, cap: number): [faces: CoinFace[], nextState: number];
export function flipUntilTails(
  state: RngState,
  cap: number,
): [faces: CoinFace[], nextState: RngState];
export function flipUntilTails(
  state: RngState,
  cap: number,
): [faces: CoinFace[], nextState: RngState] {
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

/**
 * A uniform index in `[0, count)` plus the advanced state, shared with `shuffle` so both use the
 * same scaling. `count <= 0` returns `[0, state]` without advancing, so a pick from an empty hand
 * does not desync replays. Scales by `value / 2³²` rather than `value % count` to avoid modulo
 * bias.
 */
export function randomIndex(count: number, state: number): [index: number, nextState: number];
export function randomIndex(count: number, state: RngState): [index: number, nextState: RngState];
export function randomIndex(count: number, state: RngState): [index: number, nextState: RngState] {
  if (count <= 0) return [0, state];
  const [value, next] = nextU32(state);
  return [Math.floor((value / U32_RANGE) * count), next];
}

/** Fisher–Yates over a copy; the input array is never touched. Both indices
    are in range by construction, so the swap is unconditional — an earlier
    `!== undefined` guard silently skipped swaps (biasing the permutation
    while still consuming RNG output) for any T that admits undefined. The
    casts only satisfy noUncheckedIndexedAccess. */
export function shuffle<T>(items: readonly T[], state: number): [shuffled: T[], nextState: number];
export function shuffle<T>(
  items: readonly T[],
  state: RngState,
): [shuffled: T[], nextState: RngState];
export function shuffle<T>(
  items: readonly T[],
  state: RngState,
): [shuffled: T[], nextState: RngState] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = randomIndex(i + 1, s);
    s = next;
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return [out, s];
}
