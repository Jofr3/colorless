// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Serie } from "@luminous/schema";
import { json, stubFetch } from "../../test/fetchStub";
import { FACETS, SERIES, SETS } from "../../test/fixtures";
import { useCatalogOptions } from "./catalogOptions";

// NOTE: the options cache is session-level module state (that's the point —
// one fetch per resource per session), so these tests are ORDER-DEPENDENT
// within this file: the failure paths must run before the slots fill, and the
// cached-path test rides on the fill the first test ends with.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GET /series wire shape — series with their nested set briefs. */
const WIRE_SERIES: Serie[] = SERIES.map((serie) => ({
  ...serie,
  sets: SETS.filter((set) => set.serieId === serie.id),
}));

describe("useCatalogOptions", () => {
  it("loads each resource independently: a partial failure keeps the rest, and retry refetches only what's missing", async () => {
    // Round 1 everything fails, round 2 only /series does, round 3 nothing.
    let failing = new Set<string>(["/facets", "/sets", "/series"]);
    const answer = (path: string, body: unknown) => () =>
      failing.has(path) ? json({ error: "boom" }, 500) : json(body);
    const { calls } = stubFetch({
      "GET /facets": answer("/facets", FACETS),
      "GET /sets": answer("/sets", SETS),
      "GET /series": answer("/series", WIRE_SERIES),
    });

    const { result } = renderHook(() => useCatalogOptions());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.facets).toBeNull();
    expect(result.current.sets).toEqual([]);
    expect(result.current.series).toEqual([]);

    // THE POINT of the per-resource split: /series is still down, but the two
    // that came back populate their dimensions instead of being discarded
    // along with it (the old Promise.all bundle blanked all three).
    failing = new Set(["/series"]);
    calls.length = 0;
    act(() => result.current.retry());
    await waitFor(() => {
      // Still "error" overall — the rail keeps offering its one Retry — but
      // two of the three vocabularies are now live.
      expect(result.current.status).toBe("error");
      expect(result.current.facets).toEqual(FACETS);
    });
    expect(result.current.sets).toEqual(SETS);
    expect(result.current.series).toEqual([]);

    // Round 3: only the failed slot is re-fetched; the settled two are cached.
    failing = new Set<string>();
    calls.length = 0;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // Series come back as options — the nested set briefs are dropped.
    expect(result.current.series).toEqual(SERIES);
    expect(calls).toEqual(["GET /series"]);
  });

  it("serves later mounts from the session cache — no refetch", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const { result } = renderHook(() => useCatalogOptions());
    expect(result.current.status).toBe("ready");
    expect(result.current.facets).toEqual(FACETS);
    expect(result.current.sets).toEqual(SETS);
    expect(result.current.series).toEqual(SERIES);
    expect(mock).not.toHaveBeenCalled();
  });
});
