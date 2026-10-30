// Deck card ids to the engine's `cardPool`: full Cards fetched through GET /cards/full, one request
// per MAX_ID_VALUES ids not already cached. Results are cached module-wide, and shared with the
// builder's card details (`fetchCard`).

import { type Card, MAX_ID_VALUES } from "@colorless/schema";
import { getCard, getFullCards } from "../lib/api";

/** Cached verdict for an id the catalog does not hold. Absence is a stable
    catalog fact (it won't change match to match), so — unlike a transient
    failure — it stays cached like a hit. */
const MISSING = Symbol("card not in catalog");

/** Per-id results, shared by concurrent and successive fetchCardPool calls. A
    promise that REJECTS removes itself (a transient network/5xx failure must
    not poison an id forever — the next call retries it); resolved entries
    (Cards and MISSING markers) live for the session. */
const cache = new Map<string, Promise<Card | typeof MISSING>>();
/** The Cards among `cache`'s entries that have arrived, readable without waiting. */
const arrived = new Map<string, Card>();

/** TEST-ONLY: the module-level cache outlives a test's fetch stub, so suites
    reset it between cases. */
export function clearCardPoolCache(): void {
  cache.clear();
  arrived.clear();
}

/** `id`'s Card if an earlier fetch already brought it; never requests it. */
export function cachedCard(id: string): Card | undefined {
  return arrived.get(id);
}

/** Request the uncached ids in batches, caching one promise per id. Ids are
    sorted so the same set asks for the same urls, which the browser can cache. */
function requestMissing(ids: string[]): void {
  const wanted = ids.filter((id) => !cache.has(id)).sort();
  for (let start = 0; start < wanted.length; start += MAX_ID_VALUES) {
    const group = wanted.slice(start, start + MAX_ID_VALUES);
    const batch = getFullCards(group).then(
      (cards) => new Map(cards.map((card) => [card.id, card])),
    );
    for (const id of group) {
      const pending: Promise<Card | typeof MISSING> = batch.then(
        (found) => {
          const card = found.get(id);
          if (card === undefined) return MISSING;
          if (cache.get(id) === pending) arrived.set(id, card);
          return card;
        },
        (error: unknown) => {
          if (cache.get(id) === pending) cache.delete(id);
          throw error;
        },
      );
      cache.set(id, pending);
    }
  }
}

/** `id`'s full Card: from the cache, else one GET /cards/:id, cached like a batch's. Rejects for
    an id the catalog is known to lack, and on a failed request, which is not kept. */
export async function fetchCard(id: string): Promise<Card> {
  let entry = cache.get(id);
  if (entry === undefined) {
    const pending: Promise<Card | typeof MISSING> = getCard(id).then(
      (card) => {
        if (cache.get(id) === pending) arrived.set(id, card);
        return card;
      },
      (error: unknown) => {
        if (cache.get(id) === pending) cache.delete(id);
        throw error;
      },
    );
    cache.set(id, pending);
    entry = pending;
  }
  const card = await entry;
  if (card === MISSING) throw new Error(`Card ${id} is not in the catalog`);
  return card;
}

/** Fetch every unique id's full Card. An id the catalog lacks lands in
    `missing` (the deck references cards the catalog doesn't know — the
    caller's friendly-error branch); any request failure (network, 5xx)
    rejects with the first such error — never swallowed into `missing`. */
export async function fetchCardPool(
  ids: string[],
): Promise<{ pool: Record<string, Card>; missing: string[] }> {
  const unique = [...new Set(ids)];
  requestMissing(unique);
  const results = await Promise.all(
    unique.map((id) => cache.get(id) as Promise<Card | typeof MISSING>),
  );
  const pool: Record<string, Card> = {};
  const missing: string[] = [];
  unique.forEach((id, index) => {
    const card = results[index];
    if (card === MISSING || card === undefined) missing.push(id);
    else pool[id] = card;
  });
  return { pool, missing };
}
