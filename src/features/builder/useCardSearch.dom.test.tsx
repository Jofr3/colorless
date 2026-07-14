// @vitest-environment jsdom
import type { CardBrief } from "@luminous/schema";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetchSequence } from "../../test/fetchStub";
import { cardBrief } from "../../test/fixtures";
import { DEFAULT_FORMAT } from "./cards";
import { DEFAULT_FILTERS, type Filters } from "./poolFilter";
import { type CardSearchOptions, useCardSearch } from "./useCardSearch";

afterEach(() => {
  vi.unstubAllGlobals();
});

const brief = (id: string, name: string): CardBrief =>
  cardBrief({ id, name, setId: "sv01", localId: id.split("-")[1] ?? "000", hp: 60 });

/** Stub fetch with one canned envelope per successive call. */
function stubPages(...pages: ({ items: CardBrief[]; total: number } | Error)[]) {
  return stubFetchSequence(
    ...pages.map((page) =>
      page instanceof Error
        ? page
        : json({ items: page.items, page: 1, pageSize: 2, total: page.total }),
    ),
  );
}

const options = { pageSize: 2, debounceMs: 0 };

function renderSearch(initialFilters: Filters = DEFAULT_FILTERS, extra: CardSearchOptions = {}) {
  return renderHook(
    ({ filters }) => useCardSearch(filters, DEFAULT_FORMAT, { ...options, ...extra }),
    { initialProps: { filters: initialFilters } },
  );
}

describe("useCardSearch", () => {
  it("loads the first page and reports the server total", async () => {
    const mock = stubPages({ items: [brief("sv01-001", "A"), brief("sv01-002", "B")], total: 5 });
    const { result } = renderSearch();

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.cards.map((c) => c.cardId)).toEqual(["sv01-001", "sv01-002"]);
    expect(result.current.total).toBe(5);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
    // The wire query carries the Filters translation + pagination.
    expect(mock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8787/cards?legal=standard&sort=name&page=1&pageSize=2",
    );
  });

  it("appends later pages, deduping repeated ids", async () => {
    stubPages(
      { items: [brief("sv01-001", "A"), brief("sv01-002", "B")], total: 3 },
      // Page 2 re-serves sv01-002 (boundary shifted server-side) + one new.
      { items: [brief("sv01-002", "B"), brief("sv01-003", "C")], total: 3 },
    );
    const { result } = renderSearch();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(result.current.cards.map((c) => c.cardId)).toEqual(["sv01-001", "sv01-002", "sv01-003"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("drops hasMore after a short page, even while the stale total says otherwise", async () => {
    stubPages(
      { items: [brief("sv01-001", "A"), brief("sv01-002", "B")], total: 5 },
      // The catalog shrank between requests: page 2 comes back short of the
      // pageSize (2). Without the clamp, cards.length < total stays true and
      // "load more" fetches empty pages forever.
      { items: [brief("sv01-003", "C")], total: 5 },
    );
    const { result } = renderSearch();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(result.current.cards).toHaveLength(3);
    expect(result.current.total).toBe(5); // the display value is left alone
    expect(result.current.hasMore).toBe(false);
  });

  it("resets to page 1 when the filters change, ignoring the superseded response", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const mock = vi
      .fn()
      .mockReturnValueOnce(firstResponse) // slow initial search
      .mockResolvedValueOnce(
        json({ items: [brief("sv01-009", "Joltik")], page: 1, pageSize: 2, total: 1 }),
      );
    vi.stubGlobal("fetch", mock);

    const { result, rerender } = renderSearch();
    rerender({ filters: { ...DEFAULT_FILTERS, types: ["Lightning"] } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The slow first response lands AFTER — it must not clobber the new search.
    resolveFirst(json({ items: [brief("sv01-001", "A")], page: 1, pageSize: 2, total: 9 }));
    await act(() => Promise.resolve());

    expect(result.current.cards.map((c) => c.cardId)).toEqual(["sv01-009"]);
    expect(result.current.total).toBe(1);
    expect(mock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8787/cards?type=Lightning&legal=standard&sort=name&page=1&pageSize=2",
    );
  });

  it("debounces the text query — one request for a burst of keystrokes", async () => {
    const mock = stubPages(
      { items: [], total: 0 },
      { items: [brief("sv01-004", "Joltik")], total: 1 },
    );
    const { result, rerender } = renderSearch(DEFAULT_FILTERS, { debounceMs: 30 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    for (const q of ["j", "jo", "jol", "joltik"]) {
      rerender({ filters: { ...DEFAULT_FILTERS, query: q } });
    }
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8787/cards?name=joltik&legal=standard&sort=name&page=1&pageSize=2",
    );
  });

  it("debounces the other free-typed fields in the same window — text + HP land together", async () => {
    const mock = stubPages(
      { items: [], total: 0 },
      { items: [brief("sv01-005", "Discarder")], total: 1 },
    );
    const { result, rerender } = renderSearch(DEFAULT_FILTERS, { debounceMs: 30 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A burst across DIFFERENT free-text fields — one request at the end.
    rerender({ filters: { ...DEFAULT_FILTERS, text: "discard" } });
    rerender({ filters: { ...DEFAULT_FILTERS, text: "discard", hpMin: "1" } });
    rerender({ filters: { ...DEFAULT_FILTERS, text: "discard", hpMin: "120" } });
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8787/cards?text=discard&hpMin=120&legal=standard&sort=name&page=1&pageSize=2",
    );
  });

  it("hands each fetched page to onCards", async () => {
    stubPages({ items: [brief("sv01-001", "A")], total: 1 });
    const onCards = vi.fn();
    renderSearch(DEFAULT_FILTERS, { onCards });
    await waitFor(() => expect(onCards).toHaveBeenCalledTimes(1));
    expect(onCards.mock.calls[0]?.[0].map((c: { cardId: string }) => c.cardId)).toEqual([
      "sv01-001",
    ]);
  });

  it("surfaces an initial failure as error: 'initial' and retries on demand", async () => {
    stubPages(new Error("offline"), {
      items: [brief("sv01-001", "A")],
      total: 1,
    });
    const { result } = renderSearch();
    await waitFor(() => expect(result.current.error).toBe("initial"));
    expect(result.current.cards).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.cards).toHaveLength(1);
  });

  it("keeps the loaded pages when a load-more fails (error: 'more')", async () => {
    stubPages(
      { items: [brief("sv01-001", "A"), brief("sv01-002", "B")], total: 4 },
      new Error("offline"),
      { items: [brief("sv01-003", "C"), brief("sv01-004", "D")], total: 4 },
    );
    const { result } = renderSearch();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("more"));
    expect(result.current.cards).toHaveLength(2);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.cards).toHaveLength(4);
  });
});
