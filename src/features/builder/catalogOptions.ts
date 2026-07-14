// Session-cached catalog vocabularies for the filter rail (P2 task 10): the
// facet lists (GET /facets) plus the set and serie catalogs (GET /sets,
// GET /series), fetched ONCE per session — module state, the same pattern as
// cardStore's session caches — and shared by every builder mount. The bundle
// is all-or-nothing on purpose: one failed endpoint marks the whole thing
// "error" (the rail keeps its vocabulary-free dimensions working and offers
// a retry) instead of a half-populated rail that looks authoritative.

import type { CatalogFacets, SerieBrief, SetBrief } from "@luminous/schema";
import { useCallback, useEffect, useState } from "react";
import { getFacets, getSeries, getSets } from "../../lib/api";

interface CatalogData {
  facets: CatalogFacets;
  /** Every set brief, in the api's /sets order (release date). */
  sets: SetBrief[];
  /** Serie options (GET /series with the nested set briefs dropped). */
  series: SerieBrief[];
}

/** What the rail renders from: the vocabularies plus a load status. While
    "loading"/"error" the lists are empty and `facets` null — the option-fed
    dimensions hide or show a hint, everything else keeps working. */
export interface CatalogOptions extends Omit<CatalogData, "facets"> {
  status: "loading" | "ready" | "error";
  facets: CatalogFacets | null;
  /** Re-attempt after "error" (no-op while loading or ready). */
  retry: () => void;
}

// Session-lifetime cache + the in-flight fetch (shared so StrictMode's
// double-mount — and the rail rendering twice — costs one round trip).
let cache: CatalogData | null = null;
let pending: Promise<CatalogData> | null = null;

function load(): Promise<CatalogData> {
  pending ??= Promise.all([getFacets(), getSets(), getSeries()]).then(
    ([facets, sets, series]) => {
      cache = {
        facets,
        sets,
        series: series.map(({ id, name, releaseDate }) => ({ id, name, releaseDate })),
      };
      pending = null;
      return cache;
    },
    (error: unknown) => {
      // Failure is not cached — the next mount (or retry) refetches.
      pending = null;
      throw error;
    },
  );
  return pending;
}

const EMPTY: Pick<CatalogOptions, "facets" | "sets" | "series"> = {
  facets: null,
  sets: [],
  series: [],
};

/** The session's catalog vocabularies, loading them on first use. */
export function useCatalogOptions(): CatalogOptions {
  const [state, setState] = useState<Omit<CatalogOptions, "retry">>(() =>
    cache ? { status: "ready", ...cache } : { status: "loading", ...EMPTY },
  );
  // Bumped by retry to re-run the load effect after a failure.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // nonce has no value of its own — reading it here is what lets retry
    // re-run this effect.
    void nonce;
    if (cache) {
      const data = cache;
      setState((prev) => (prev.status === "ready" ? prev : { status: "ready", ...data }));
      return undefined;
    }
    let disposed = false;
    setState((prev) => (prev.status === "loading" ? prev : { status: "loading", ...EMPTY }));
    load().then(
      (data) => {
        if (!disposed) setState({ status: "ready", ...data });
      },
      () => {
        if (!disposed) setState({ status: "error", ...EMPTY });
      },
    );
    return () => {
      disposed = true;
    };
  }, [nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}
