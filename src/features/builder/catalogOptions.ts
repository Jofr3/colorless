// Session-cached catalog vocabularies for the filter rail (P2 task 10): the
// facet lists (GET /facets) plus the set and serie catalogs (GET /sets,
// GET /series), fetched ONCE per session — module state, the same pattern as
// cardStore's session caches — and shared by every builder mount.
//
// Each resource loads INDEPENDENTLY (P2-M1 follow-up). The bundle used to be
// one Promise.all, which made it all-or-nothing: a single /series hiccup
// blanked the WHOLE rail vocabulary — rarity chips, regulation marks and the
// illustrator list included — even though those came back fine. Now a failed
// endpoint costs only its own dimensions, and the rail's per-section "hide
// when the list is empty" guards turn that into per-dimension degradation for
// free. `status` stays an AGGREGATE (loading if anything is still in flight,
// else error if anything failed) because the rail shows one spinner and one
// retry; `retry` re-attempts exactly the resources that failed, since a
// settled slot keeps its value.

import type { CatalogFacets, SerieBrief, SetBrief } from "@luminous/schema";
import { useCallback, useEffect, useState } from "react";
import { getFacets, getSeries, getSets } from "../../lib/api";

/** The three independently-loaded vocabularies. */
type Resource = "facets" | "sets" | "series";
type Status = "loading" | "ready" | "error";

/** What the rail renders from: the vocabularies plus a load status. A
    vocabulary that hasn't landed (still loading, or its fetch failed) is null
    /empty — the dimensions it feeds hide, everything else keeps working. */
export interface CatalogOptions {
  /** Aggregate over the three resources: "loading" while any is in flight,
      "error" when any settled failed, "ready" only when all three landed. */
  status: Status;
  facets: CatalogFacets | null;
  /** Every set brief, in the api's /sets order (release date). */
  sets: SetBrief[];
  /** Serie options (GET /series with the nested set briefs dropped). */
  series: SerieBrief[];
  /** Re-attempt the failed resources (settled ones are not refetched). */
  retry: () => void;
}

/** A session-lifetime slot: the loaded value plus the in-flight fetch, shared
    so StrictMode's double-mount — and the rail rendering twice — costs one
    round trip. A FAILURE is never cached (`pending` clears, `value` stays
    null), so the next mount or retry refetches just that slot. */
interface Slot<T> {
  value: T | null;
  pending: Promise<T> | null;
  readonly fetch: () => Promise<T>;
}

function slot<T>(fetch: () => Promise<T>): Slot<T> {
  return { value: null, pending: null, fetch };
}

/** GET /series carries each serie's nested set briefs; the rail only needs
    the serie itself (the sets arrive whole from /sets). */
function fetchSeries(): Promise<SerieBrief[]> {
  return getSeries().then((series) =>
    series.map(({ id, name, releaseDate }) => ({ id, name, releaseDate })),
  );
}

const facetsSlot = slot(getFacets);
const setsSlot = slot(() => getSets());
const seriesSlot = slot(fetchSeries);

function load<T>(target: Slot<T>): Promise<T> {
  if (target.value !== null) return Promise.resolve(target.value);
  target.pending ??= target.fetch().then(
    (value) => {
      target.value = value;
      target.pending = null;
      return value;
    },
    (error: unknown) => {
      target.pending = null;
      throw error;
    },
  );
  return target.pending;
}

/** The hook's state: the three values plus where each stands. */
interface State {
  facets: CatalogFacets | null;
  sets: SetBrief[];
  series: SerieBrief[];
  status: Record<Resource, Status>;
}

/** A mount starts from whatever the session already has — a fully cached
    bundle renders "ready" on the FIRST render, with no fetch at all. */
function snapshot(): State {
  return {
    facets: facetsSlot.value,
    sets: setsSlot.value ?? [],
    series: seriesSlot.value ?? [],
    status: {
      facets: facetsSlot.value === null ? "loading" : "ready",
      sets: setsSlot.value === null ? "loading" : "ready",
      series: seriesSlot.value === null ? "loading" : "ready",
    },
  };
}

function aggregate(status: Record<Resource, Status>): Status {
  const values = Object.values(status);
  if (values.includes("loading")) return "loading";
  return values.includes("error") ? "error" : "ready";
}

/** The session's catalog vocabularies, loading them on first use. */
export function useCatalogOptions(): CatalogOptions {
  const [state, setState] = useState<State>(snapshot);
  // Bumped by retry to re-run the load effect after a failure.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // nonce has no value of its own — reading it here is what lets retry
    // re-run this effect.
    void nonce;
    let disposed = false;
    // No-ops keep the previous state object — a remount whose slots are all
    // cached must not schedule a pointless re-render.
    const settle = (key: Resource, next: Status, value?: Partial<State>) => {
      if (disposed) return;
      setState((prev) =>
        value === undefined && prev.status[key] === next
          ? prev
          : { ...prev, ...value, status: { ...prev.status, [key]: next } },
      );
    };
    // One independent load per resource: each publishes its own value and its
    // own status, so a slow or failing endpoint never holds up (or blanks) the
    // other two. `load` short-circuits on an already-loaded slot, so a retry
    // after a partial failure only re-hits what's still missing.
    const start = <T>(target: Slot<T>, key: Resource, apply: (value: T) => Partial<State>) => {
      if (target.value !== null) {
        settle(key, "ready", apply(target.value));
        return;
      }
      settle(key, "loading");
      load(target).then(
        (value) => settle(key, "ready", apply(value)),
        () => settle(key, "error"),
      );
    };

    start(facetsSlot, "facets", (facets) => ({ facets }));
    start(setsSlot, "sets", (sets) => ({ sets }));
    start(seriesSlot, "series", (series) => ({ series }));

    return () => {
      disposed = true;
    };
  }, [nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return {
    status: aggregate(state.status),
    facets: state.facets,
    sets: state.sets,
    series: state.series,
    retry,
  };
}
