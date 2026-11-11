// The match handoff's pre-shuffle of each deck list. The engine mints card
// uids `p1#i` in list order, and D1 returns a deck sorted by card id, so without it a uid the
// opponent sees would place that card in the sorted list and bound the rest of the decklist. The
// shuffle is independent of the match RNG, which the engine's own shuffle draws from.

const RANGE = 2 ** 32;

/** A uniform integer in [0, bound), by rejection sampling, so no value is favoured. */
function randomBelow(bound: number, words: () => number): number {
  const limit = RANGE - (RANGE % bound);
  for (;;) {
    const word = words();
    if (word < limit) return word % bound;
  }
}

/** A fresh CSPRNG word. */
function cryptoWord(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/** `items` in a uniformly random order (Fisher-Yates), drawing uint32 words from `words`. */
export function cryptoShuffle<T>(items: readonly T[], words: () => number = cryptoWord): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, words);
    [shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
  }
  return shuffled;
}
