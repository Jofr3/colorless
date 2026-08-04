// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetchResponse, stubFetchSequence } from "../../test/fetchStub";
import { builderCard, cardBrief, cardsPage } from "../../test/fixtures";
import { hydrationFailures, retryDelayMs, useCardHydration, useCardStore } from "./cardStore";

// NOTE: the store's caches are session-level module state (that's the point —
// hydrations survive remounts), so each test uses its own card ids.

afterEach(() => {
  // Unmount every hook: a mount left behind stays in the module-level
  // live-hydrator registry and would poll a LATER test's fetch stub.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const brief = (id: string, name: string) =>
  cardBrief({ id, localId: id.split("-")[1] ?? "000", name });

function renderStoreWithEntries(entries: ReadonlyMap<string, number>) {
  return renderHook(
    (props: { entries: ReadonlyMap<string, number> }) => {
      const store = useCardStore();
      useCardHydration(props.entries, store);
      return store;
    },
    { initialProps: { entries } },
  );
}

describe("useCardStore + useCardHydration", () => {
  it("hydrates every unknown entry id in ONE batched GET /cards call", async () => {
    const mock = stubFetchResponse(
      json(cardsPage([brief("sv01-201", "Hydrated"), brief("sv01-202", "Also")])),
    );

    const { result } = renderStoreWithEntries(
      new Map([
        ["sv01-201", 2],
        ["sv01-202", 1],
      ]),
    );
    await waitFor(() => expect(result.current.byId.has("sv01-202")).toBe(true));

    const card = result.current.byId.get("sv01-201");
    expect(card?.name).toBe("Hydrated");
    expect(card?.supertype).toBe("Pokémon");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8787/cards?id=sv01-201&id=sv01-202&pageSize=100",
    );
  });

  it("chunks a hydration round at the server's 100-id cap", async () => {
    // A FRESH Response per call — a Response body reads once, and the second
    // batch re-reading a shared one would (silently) fail the batch.
    const mock = vi.fn().mockImplementation(async () => json(cardsPage([])));
    vi.stubGlobal("fetch", mock);

    const ids = Array.from({ length: 120 }, (_, i) => `bulk-${String(i).padStart(3, "0")}`);
    renderStoreWithEntries(new Map(ids.map((id) => [id, 1])));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));

    const idCounts = mock.mock.calls.map(
      (call) => new URL(String(call[0])).searchParams.getAll("id").length,
    );
    expect(idCounts.sort((a, b) => a - b)).toEqual([20, 100]);
  });

  it("skips ids the store already knows — register wins over the network", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const { result, rerender } = renderStoreWithEntries(new Map());
    act(() =>
      result.current.register([
        builderCard({ cardId: "sv01-202b", name: "Known", supertype: "Pokémon", subtype: "Basic" }),
      ]),
    );
    await waitFor(() => expect(result.current.byId.has("sv01-202b")).toBe(true));

    rerender({ entries: new Map([["sv01-202b", 1]]) });
    await waitFor(() => expect(result.current.byId.get("sv01-202b")?.name).toBe("Known"));
    expect(mock).not.toHaveBeenCalled();
  });

  it("marks ids MISSING from a successful batch unknown — a verdict, no refetch loop", async () => {
    // The batch route silently omits unknown ids instead of 404ing; absence
    // from a 200 is the "no such card" signal now.
    const mock = stubFetchResponse(json(cardsPage([brief("sv01-205", "Real")])));

    const { result, rerender } = renderStoreWithEntries(
      new Map([
        ["sv01-205", 1],
        ["gone-001", 4],
      ]),
    );
    await waitFor(() => expect(result.current.unknown.has("gone-001")).toBe(true));
    expect(result.current.byId.has("sv01-205")).toBe(true);
    expect(result.current.byId.has("gone-001")).toBe(false);

    // Entry churn re-runs the hydration effect; the verdict holds.
    rerender({ entries: new Map([["gone-001", 3]]) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("register publishes a session-cached card to a mount whose map predates it", () => {
    const card = builderCard({
      cardId: "sv01-210",
      name: "Straggler",
      supertype: "Pokémon",
      subtype: "Basic",
    });
    // Two live mounts stand in for the unmount→remount race: `stale` seeds
    // its map, THEN another mount's register lands the card in the session
    // cache — exactly the state a previous mount's late-settling fetch leaves.
    const stale = renderHook(() => useCardStore());
    const other = renderHook(() => useCardStore());
    act(() => other.result.current.register([card]));
    expect(other.result.current.byId.has("sv01-210")).toBe(true);
    expect(stale.result.current.byId.has("sv01-210")).toBe(false);

    // Re-registering the id must publish it here too (the old change check
    // consulted only sessionCards and stranded it as a pending tile) — while
    // first-sighting-wins still holds for the VALUE.
    act(() => stale.result.current.register([{ ...card, name: "Imposter" }]));
    expect(stale.result.current.byId.get("sv01-210")?.name).toBe("Straggler");
  });

  it("keeps the session cache across mounts", async () => {
    stubFetchResponse(json(cardsPage([brief("sv01-203", "Sticky")])));
    const first = renderStoreWithEntries(new Map([["sv01-203", 1]]));
    await waitFor(() => expect(first.result.current.byId.has("sv01-203")).toBe(true));
    first.unmount();

    vi.stubGlobal("fetch", vi.fn());
    const second = renderStoreWithEntries(new Map([["sv01-203", 1]]));
    expect(second.result.current.byId.get("sv01-203")?.name).toBe("Sticky");
  });
});

describe("useCardHydration — transient-failure retry", () => {
  it("self-retries a failed batch on a backoff, so an idle builder recovers on its own", async () => {
    vi.useFakeTimers();
    const mock = stubFetchSequence(
      new TypeError("network down"),
      json(cardsPage([brief("sv01-220", "Recovered")])),
    );

    const { result } = renderStoreWithEntries(new Map([["sv01-220", 1]]));
    // The initial attempt fails…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.current.byId.has("sv01-220")).toBe(false);

    // …and the first backoff step retries WITHOUT any entries/store change.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.current.byId.get("sv01-220")?.name).toBe("Recovered");
  });

  it("entry churn re-arms the pending retry but never hurries it", async () => {
    vi.useFakeTimers();
    const mock = stubFetchSequence(
      new TypeError("offline"),
      json(cardsPage([brief("sv01-221", "Later")])),
    );

    const { rerender } = renderStoreWithEntries(new Map([["sv01-221", 1]]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(1);

    // A quantity change re-runs the hydration effect mid-backoff — the wait
    // (tracked in module state) holds instead of firing an immediate refetch.
    rerender({ entries: new Map([["sv01-221", 2]]) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(1) / 2);
    });
    expect(mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("re-arms the retry when the effect run that launched the batch was disposed mid-flight", async () => {
    // The exact stall this guards against: entries/store churn re-runs the
    // hydration effect while a batch is in flight (the successor skips the
    // in-flight ids), THEN the batch rejects — the retry must land on the
    // live run's timer, not die with the disposed one.
    vi.useFakeTimers();
    let rejectFirst!: (reason: unknown) => void;
    const first = new Promise<Response>((_, reject) => {
      rejectFirst = reject;
    });
    const mock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(json(cardsPage([brief("sv01-230", "Survivor")])));
    vi.stubGlobal("fetch", mock);

    const { result } = renderStoreWithEntries(new Map([["sv01-230", 1]]));
    expect(mock).toHaveBeenCalledTimes(1);

    // Registering an unrelated card changes byId → the effect re-runs,
    // disposing the run that launched the batch…
    act(() =>
      result.current.register([
        builderCard({
          cardId: "sv01-231",
          name: "Unrelated",
          supertype: "Pokémon",
          subtype: "Basic",
        }),
      ]),
    );
    // …and only THEN does the batch fail.
    rejectFirst(new TypeError("network down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.byId.has("sv01-230")).toBe(false);

    // The live run armed the backoff timer; the retry succeeds on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.current.byId.get("sv01-230")?.name).toBe("Survivor");
  });

  it("register() clears an id's failure state — arrival via a grid page ends the backoff", async () => {
    vi.useFakeTimers();
    stubFetchSequence(new TypeError("offline"));

    const { result } = renderStoreWithEntries(new Map([["sv01-240", 1]]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hydrationFailures.has("sv01-240")).toBe(true);

    // The id arrives through register (a grid page), not the batch: the
    // stale backoff entry must not outlive it (a session-long leak).
    act(() =>
      result.current.register([
        builderCard({
          cardId: "sv01-240",
          name: "Arrived",
          supertype: "Pokémon",
          subtype: "Basic",
        }),
      ]),
    );
    expect(hydrationFailures.has("sv01-240")).toBe(false);
    expect(result.current.byId.get("sv01-240")?.name).toBe("Arrived");
  });

  it("doubles the delay per failure and caps it at 30s", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(3)).toBe(4_000);
    expect(retryDelayMs(6)).toBe(30_000);
    expect(retryDelayMs(12)).toBe(30_000);
  });

  it("never refetches an id a successful batch omitted — a verdict, not a hiccup", async () => {
    vi.useFakeTimers();
    const mock = stubFetchResponse(json(cardsPage([])));

    renderStoreWithEntries(new Map([["gone-003", 1]]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
