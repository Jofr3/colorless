// The builder's server-side card search: Filters (+ the active format) in,
// paginated BuilderCards out. Owns the text-query debounce, the page
// accumulation behind "load more", staleness (a filter change supersedes
// in-flight responses) and the loading/error surface the grid renders.
// Results keep showing while a narrowed search is in flight — standard
// search UX, no blank flash between keystrokes.

import { useCallback, useEffect, useRef, useState } from "react";
import { type CardsQuery, getCards } from "../../lib/api";
import type { BuilderCard, Format } from "./cards";
import { filtersToCardsQuery, toBuilderCard } from "./catalog";
import type { Filters } from "./poolFilter";

/** 60 keeps "load more" chunky and divides evenly into the grid's 2/3/5
    column layouts (server max is 100). */
const PAGE_SIZE = 60;
const DEBOUNCE_MS = 250;

export interface CardSearch {
  /** Every loaded page, deduped by id, in server order. */
  cards: BuilderCard[];
  /** Server-side match count (before the client-side kind filter), or null
      until the first page lands. */
  total: number | null;
  /** The first page (of the current filters) is in flight. */
  loading: boolean;
  /** A later page is in flight. */
  loadingMore: boolean;
  /** "initial" = nothing usable to show; "more" = a load-more failed but the
      loaded pages still stand. */
  error: "initial" | "more" | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-attempt whatever failed (the first page or the failed later page). */
  retry: () => void;
}

export interface CardSearchOptions {
  /** Called with each fetched page's cards — the builder registers them in
      its card store so deck entries can resolve without refetching. */
  onCards?: (cards: BuilderCard[]) => void;
  /** Test seams. */
  pageSize?: number;
  debounceMs?: number;
}

/** What a fetch request looks like: which query (serialized — it doubles as
    the identity key), which page, and a nonce so `retry` can re-issue an
    identical request. */
interface Request {
  key: string;
  page: number;
  nonce: number;
}

/** The accumulated result, tagged with the query key it belongs to. */
interface Data {
  key: string;
  cards: BuilderCard[];
  total: number | null;
  /** Last successfully loaded page (0 = none yet). */
  page: number;
  /** The last page came back short of pageSize — the server has no more
      rows, whatever the `cards.length < total` arithmetic says (id-dedup or
      a shrinking catalog can keep it true forever). */
  exhausted: boolean;
  error: "initial" | "more" | null;
}

export function useCardSearch(
  filters: Filters,
  format: Format,
  options: CardSearchOptions = {},
): CardSearch {
  const { pageSize = PAGE_SIZE, debounceMs = DEBOUNCE_MS } = options;
  // The registration callback is read through a ref so an inline `onCards`
  // doesn't churn the fetch effect.
  const onCardsRef = useRef(options.onCards);
  onCardsRef.current = options.onCards;

  // Debounce ONLY the text query — chip toggles apply instantly.
  const [debouncedQuery, setDebouncedQuery] = useState(filters.query);
  useEffect(() => {
    if (filters.query === debouncedQuery) return undefined;
    const id = window.setTimeout(() => setDebouncedQuery(filters.query), debounceMs);
    return () => window.clearTimeout(id);
  }, [filters.query, debouncedQuery, debounceMs]);

  // The serialized query IS the identity of a search — the fetch effect keys
  // on it and the response handler parses it back (self-contained deps).
  const queryKey = JSON.stringify(filtersToCardsQuery({ ...filters, query: debouncedQuery }, format));

  const [request, setRequest] = useState<Request>({ key: queryKey, page: 1, nonce: 0 });
  const [data, setData] = useState<Data>({
    key: queryKey,
    cards: [],
    total: null,
    page: 0,
    exhausted: false,
    error: null,
  });
  const [pending, setPending] = useState(true);

  // Filters changed: reset to page 1 of the new query during render (the
  // React "adjust state when props change" pattern) so the fetch effect
  // never sees a page number left over from the previous search.
  if (request.key !== queryKey) {
    setRequest({ key: queryKey, page: 1, nonce: 0 });
  }

  useEffect(() => {
    // A render-time reset is about to replace this request — don't fetch.
    if (request.key !== queryKey) return undefined;
    let stale = false;
    setPending(true);
    getCards({ ...(JSON.parse(request.key) as CardsQuery), page: request.page, pageSize })
      .then((result) => {
        if (stale) return;
        const mapped = result.items.map(toBuilderCard);
        onCardsRef.current?.(mapped);
        setData((prev) => {
          // Append onto pages of the SAME query; anything else starts fresh.
          // Dedup by id: page boundaries can shift if the catalog changes
          // between requests, and a duplicate key would break the grid.
          const base = request.page > 1 && prev.key === request.key ? prev.cards : [];
          const seen = new Set(base.map((card) => card.cardId));
          return {
            key: request.key,
            cards: [...base, ...mapped.filter((card) => !seen.has(card.cardId))],
            total: result.total,
            page: request.page,
            // A short (or empty) page IS the last page — clamp hasMore even
            // when the total arithmetic disagrees. (The displayed total is
            // left alone.)
            exhausted: result.items.length < pageSize,
            error: null,
          };
        });
        setPending(false);
      })
      .catch(() => {
        if (stale) return;
        setData((prev) =>
          request.page > 1 && prev.key === request.key
            ? // Keep the loaded pages; only the "more" affordance failed.
              { ...prev, error: "more" }
            : {
                key: request.key,
                cards: [],
                total: null,
                page: 0,
                exhausted: false,
                error: "initial",
              },
        );
        setPending(false);
      });
    return () => {
      stale = true;
    };
  }, [request, queryKey, pageSize]);

  const loadMore = useCallback(() => {
    if (pending || data.error !== null || data.key !== queryKey) return;
    if (data.total === null || data.exhausted || data.cards.length >= data.total) return;
    setRequest({ key: queryKey, page: data.page + 1, nonce: 0 });
  }, [pending, data, queryKey]);

  const retry = useCallback(() => {
    setRequest((prev) => ({ ...prev, nonce: prev.nonce + 1 }));
  }, []);

  return {
    cards: data.cards,
    total: data.total,
    loading: pending && request.page === 1,
    loadingMore: pending && request.page > 1,
    error: data.error,
    hasMore:
      data.error === null &&
      data.total !== null &&
      !data.exhausted &&
      data.cards.length < data.total,
    loadMore,
    retry,
  };
}
