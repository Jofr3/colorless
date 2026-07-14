// The builder's in-memory card store: every card this session has seen, by
// id — grid pages, decklist imports and on-demand hydrations all land here.
// Deck entries are plain (cardId, quantity) pairs DECOUPLED from whatever
// page the grid happens to have loaded: an id the store doesn't know yet is
// fetched via GET /cards/:id and renders as a pending tile meanwhile. (M9 —
// this replaces the fixture-pool lookup that silently DROPPED deck entries
// missing from the pool.)

import { useCallback, useEffect, useState } from "react";
import { ApiError, getCard } from "../../lib/api";
import type { BuilderCard } from "./cards";
import { toBuilderCard } from "./catalog";

// Session-lifetime caches (module state, shared across builder mounts): a
// hydrated card survives navigating away and back, so reopening a deck
// doesn't refetch every entry.
const sessionCards = new Map<string, BuilderCard>();
const inFlight = new Set<string>();
/** Ids the api 404'd — a verdict, not a hiccup; never refetched this session. */
const unknownIds = new Set<string>();

/** One deck entry as the panel renders it: hydrated (`card`) or pending
    (`card: null` — unknown to the store, fetch in flight or failed). */
export interface DeckListItem {
  cardId: string;
  quantity: number;
  card: BuilderCard | null;
}

export interface CardStore {
  byId: ReadonlyMap<string, BuilderCard>;
  /** Merge cards into the store (first sighting of an id wins). */
  register: (cards: BuilderCard[]) => void;
}

export function useCardStore(): CardStore {
  const [byId, setById] = useState<ReadonlyMap<string, BuilderCard>>(() => new Map(sessionCards));

  const register = useCallback((cards: BuilderCard[]) => {
    // First sighting wins for the VALUE — an id already in the session cache
    // is never overwritten…
    for (const card of cards) {
      if (!sessionCards.has(card.cardId)) sessionCards.set(card.cardId, card);
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

  return { byId, register };
}

/** Hydrate deck-entry ids the store doesn't know: each becomes a
    GET /cards/:id (full Card → adapter) whose result lands in the store,
    re-rendering that entry's pending tile into a card. In-flight ids and
    known-unknowns are skipped; transient failures (network, 5xx) retry on
    the next entries/store change, 404s never do. */
export function useCardHydration(entries: ReadonlyMap<string, number>, store: CardStore): void {
  const { byId, register } = store;
  useEffect(() => {
    for (const id of entries.keys()) {
      if (byId.has(id) || inFlight.has(id) || unknownIds.has(id)) continue;
      inFlight.add(id);
      getCard(id)
        .then((card) => register([toBuilderCard(card)]))
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) unknownIds.add(id);
        })
        .finally(() => inFlight.delete(id));
    }
  }, [entries, byId, register]);
}
