// The builder's in-memory card store: every card this session has seen, by
// id — grid pages, decklist imports and on-demand hydrations all land here.
// Deck entries are plain (cardId, quantity) pairs DECOUPLED from whatever
// page the grid happens to have loaded: ids the store doesn't know yet are
// hydrated in ONE batched GET /cards?id=…&id=… round per ≤100 ids (P2 — this
// replaces the per-id GET /cards/:id fan-out) and render as pending tiles
// meanwhile.

import { useCallback, useEffect, useState } from "react";
import { getCards } from "../../lib/api";
import type { BuilderCard } from "./cards";
import { toBuilderCard } from "./catalog";

// Session-lifetime caches (module state, shared across builder mounts): a
// hydrated card survives navigating away and back, so reopening a deck
// doesn't refetch every entry.
const sessionCards = new Map<string, BuilderCard>();
const inFlight = new Set<string>();
/** Ids the catalog doesn't know — a verdict, not a hiccup; never refetched
    this session. (The signal is an id MISSING from a successful batch
    response — the batch route omits unknown ids instead of 404ing.) */
const unknownIds = new Set<string>();
/** Transient-failure state per id: how many batches it has failed in (drives
    the retry backoff below) and the earliest epoch-ms it may be refetched.
    Cleared the moment the id registers via ANY path. Exported only for the
    leak-regression test — the clearing has no other observable surface. */
export const hydrationFailures = new Map<string, { count: number; retryAt: number }>();
/** The hydrate() of every mounted useCardHydration effect run. A failed
    batch notifies them ALL to re-arm their retry timers: the run that
    launched the batch may have been disposed while it was in flight
    (entries/store churn), and a timer armed on a disposed run would just be
    cleared — stranding the pending tiles until an unrelated change. */
const liveHydrators = new Set<() => void>();

/** Server cap on repeatable `id` values per GET /cards call (400 above it) —
    also sent as the pageSize, so one page holds every match and an id
    missing from the response really is unknown, not on page 2. */
const BATCH_SIZE = 100;

/** Retry backoff for transient hydration failures: 1s doubling to a 30s
    ceiling, then steady — bounded in rate, not in attempts, so an idle
    builder recovers on its own once the network/api comes back. */
export function retryDelayMs(failureCount: number): number {
  return Math.min(1_000 * 2 ** (failureCount - 1), 30_000);
}

/** One deck entry as the panel renders it: hydrated (`card`) or pending
    (`card: null` — unknown to the store, fetch in flight or failed). */
export interface DeckListItem {
  cardId: string;
  quantity: number;
  card: BuilderCard | null;
}

export interface CardStore {
  byId: ReadonlyMap<string, BuilderCard>;
  /** Ids the catalog disowned this session — the "no such card" verdict,
      published as state so a deck entry can render its unavailable tile. */
  unknown: ReadonlySet<string>;
  /** Merge cards into the store (first sighting of an id wins). */
  register: (cards: BuilderCard[]) => void;
  /** Record a no-such-card verdict for an id (useCardHydration's write path). */
  markUnknown: (id: string) => void;
}

export function useCardStore(): CardStore {
  const [byId, setById] = useState<ReadonlyMap<string, BuilderCard>>(() => new Map(sessionCards));
  const [unknown, setUnknown] = useState<ReadonlySet<string>>(() => new Set(unknownIds));

  const register = useCallback((cards: BuilderCard[]) => {
    // First sighting wins for the VALUE — an id already in the session cache
    // is never overwritten…
    for (const card of cards) {
      if (!sessionCards.has(card.cardId)) sessionCards.set(card.cardId, card);
      // Arrival by ANY road (a batch, a grid page) settles the id's
      // transient-failure history — a known card has nothing to back off.
      hydrationFailures.delete(card.cardId);
    }
    // …but "this mount's map lacks the id" still counts as a change: a fetch
    // started by a PREVIOUS mount can settle after this mount seeded its map,
    // leaving the session cache ahead of byId — without this re-publish the
    // entry strands as a pending tile (re-registering it would look like a
    // no-op against sessionCards).
    setById((prev) => {
      const missing = cards.some((card) => !prev.has(card.cardId));
      return missing ? new Map(sessionCards) : prev;
    });
  }, []);

  const markUnknown = useCallback((id: string) => {
    unknownIds.add(id);
    setUnknown((prev) => (prev.has(id) ? prev : new Set(unknownIds)));
  }, []);

  return { byId, unknown, register, markUnknown };
}

/** Hydrate deck-entry ids the store doesn't know: every currently-fetchable
    id goes out as ONE GET /cards?id=… batch (chunked at the server's
    100-value cap) whose briefs land in the store, re-rendering the pending
    tiles into cards. A requested id MISSING from a successful response is
    the catalog's "no such card" verdict → markUnknown, never refetched.
    In-flight ids and known-unknowns are skipped; a failed batch (network,
    5xx) self-retries per id on a capped exponential backoff while the
    builder is mounted, so an idle builder recovers without waiting for an
    unrelated change. */
export function useCardHydration(entries: ReadonlyMap<string, number>, store: CardStore): void {
  const { byId, register, markUnknown } = store;
  useEffect(() => {
    // Timers armed by THIS effect run; the re-run after any entries/store
    // change re-arms whatever is still due (backoff state lives in the
    // module map, so churn never resets or hurries a wait).
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let disposed = false;

    const schedule = (delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        // hydrate() re-checks eligibility at fire time — entries may have
        // hydrated (another mount, a grid page) or been removed meanwhile.
        hydrate();
      }, delay);
      timers.add(timer);
    };

    const attempt = (batch: string[]) => {
      for (const id of batch) inFlight.add(id);
      getCards({ id: batch, pageSize: BATCH_SIZE })
        .then(({ items }) => {
          for (const id of batch) {
            inFlight.delete(id);
            hydrationFailures.delete(id);
          }
          register(items.map(toBuilderCard));
          // The response is a success, so absence is a verdict on the id —
          // the batch route silently omits ids the catalog doesn't know.
          const found = new Set(items.map((item) => item.id));
          for (const id of batch) {
            if (!found.has(id)) markUnknown(id);
          }
        })
        .catch(() => {
          // Transport/server failure: the WHOLE batch retries on the backoff
          // (counted per id, so ids joining a later batch keep their history).
          for (const id of batch) {
            inFlight.delete(id);
            const count = (hydrationFailures.get(id)?.count ?? 0) + 1;
            hydrationFailures.set(id, { count, retryAt: Date.now() + retryDelayMs(count) });
          }
          // Ask every LIVE effect run to re-arm — THIS run may have been
          // disposed while the batch was in flight, and only a live run's
          // timer survives. Each hydrate re-reads the backoff state, so the
          // not-yet-due ids land in its schedule(nextWait) branch. No run
          // live (builder unmounted) is fine: the next mount's hydrate()
          // reads the same state.
          for (const h of liveHydrators) h();
        });
    };

    const hydrate = () => {
      if (disposed) return;
      // Collect what's fetchable NOW and the soonest backoff still pending.
      const ready: string[] = [];
      let nextWait = Number.POSITIVE_INFINITY;
      const now = Date.now();
      for (const id of entries.keys()) {
        if (byId.has(id) || inFlight.has(id) || unknownIds.has(id)) continue;
        const wait = (hydrationFailures.get(id)?.retryAt ?? 0) - now;
        if (wait > 0) nextWait = Math.min(nextWait, wait);
        else ready.push(id);
      }
      if (nextWait < Number.POSITIVE_INFINITY) schedule(nextWait);
      for (let i = 0; i < ready.length; i += BATCH_SIZE) {
        attempt(ready.slice(i, i + BATCH_SIZE));
      }
    };

    liveHydrators.add(hydrate);
    hydrate();
    return () => {
      disposed = true;
      liveHydrators.delete(hydrate);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [entries, byId, register, markUnknown]);
}
