// Deck card ids → the engine's `cardPool` (Record<id, Card>): full canonical
// Cards fetched one by one through GET /cards/:id — the client's only
// full-Card route (GET /cards deliberately serves blob-free briefs). Pure
// orchestration, no React; the game page awaits this before createGame.
//
// Per-id results are cached module-wide, so "Play again" (and any deck
// sharing ids with a previous match) costs zero requests for ids already
// seen. Catalog Cards are immutable for a session — the cached Card object
// itself is shared across matches, which is safe because every consumer
// (the engine included) treats pool cards as read-only.

import type { Card } from "@luminous/schema";
import { ApiError, getCard } from "../../lib/api";

/** Requests in flight at once — enough to hide per-request latency across a
    deck's ~dozens of unique ids without stampeding the api. */
const CONCURRENCY = 8;

/** Cached verdict for an id the catalog answered 404 for. Absence is a
    stable catalog fact (it won't change match to match), so — unlike a
    transient failure — it stays cached like a hit. */
const MISSING = Symbol("card not in catalog");

/** Per-id fetch results, shared by concurrent workers within one call AND by
    successive fetchCardPool calls. Eviction policy: a promise that REJECTS
    removes itself (a transient network/5xx failure must not poison an id
    forever — the next call retries it); resolved entries (Cards and MISSING
    markers) live for the session. */
const cache = new Map<string, Promise<Card | typeof MISSING>>();

/** TEST-ONLY: the module-level cache outlives a test's fetch stub, so suites
    reset it between cases. */
export function clearCardPoolCache(): void {
  cache.clear();
}

/** One id's Card, MISSING on 404 — cached; see `cache` for the policy. */
function fetchCard(id: string): Promise<Card | typeof MISSING> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const pending: Promise<Card | typeof MISSING> = getCard(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return MISSING;
    cache.delete(id); // transient failure: evict so the next call retries
    throw error;
  });
  cache.set(id, pending);
  return pending;
}

/** Fetch every unique id's full Card. A 404 lands that id in `missing`
    (the deck references cards the catalog doesn't know — the caller's
    friendly-error branch); any OTHER failure (network, 5xx) rejects with the
    first such error — never swallowed into `missing`. */
export async function fetchCardPool(
  ids: string[],
): Promise<{ pool: Record<string, Card>; missing: string[] }> {
  const unique = [...new Set(ids)];
  // Workers drain one shared iterator, so at most CONCURRENCY ids are ever
  // claimed-but-unresolved at a time (a cache hit resolves without a
  // request — it just passes through a worker's slot).
  const queue = unique.values();
  const pool: Record<string, Card> = {};
  const absent = new Set<string>();
  let failed = false;

  async function worker(): Promise<void> {
    for (const id of queue) {
      if (failed) return;
      try {
        const card = await fetchCard(id);
        if (card === MISSING) absent.add(id);
        else pool[id] = card;
      } catch (error) {
        failed = true; // sibling workers stop pulling new ids; Promise.all rejects with this
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  // Filtering `unique` keeps `missing` in input order despite racing workers.
  return { pool, missing: unique.filter((id) => absent.has(id)) };
}
