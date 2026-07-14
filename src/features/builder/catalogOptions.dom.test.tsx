// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Serie } from "@luminous/schema";
import { json, stubFetch } from "../../test/fetchStub";
import { FACETS, SERIES, SETS } from "../../test/fixtures";
import { useCatalogOptions } from "./catalogOptions";

// NOTE: the options cache is session-level module state (that's the point —
// one fetch bundle per session), so these tests are ORDER-DEPENDENT within
// this file: the failure path must run before the cache fills, and the
// cached-path tests ride on the fill the first test ends with.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GET /series wire shape — series with their nested set briefs. */
const WIRE_SERIES: Serie[] = SERIES.map((serie) => ({
  ...serie,
  sets: SETS.filter((set) => set.serieId === serie.id),
}));

describe("useCatalogOptions", () => {
  it("reports error on a failed load, then retry refetches into ready", async () => {
    let fail = true;
    stubFetch({
      "GET /facets": () => (fail ? json({ error: "boom" }, 500) : json(FACETS)),
      "GET /sets": () => json(SETS),
      "GET /series": () => json(WIRE_SERIES),
    });

    const { result } = renderHook(() => useCatalogOptions());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.facets).toBeNull();

    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.facets).toEqual(FACETS);
    expect(result.current.sets).toEqual(SETS);
    // Series come back as options — the nested set briefs are dropped.
    expect(result.current.series).toEqual(SERIES);
  });

  it("serves later mounts from the session cache — no refetch", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const { result } = renderHook(() => useCatalogOptions());
    expect(result.current.status).toBe("ready");
    expect(result.current.facets).toEqual(FACETS);
    expect(mock).not.toHaveBeenCalled();
  });
});
