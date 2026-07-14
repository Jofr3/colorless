// @vitest-environment jsdom
import type { Card } from "@luminous/schema";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCardHydration, useCardStore } from "./cardStore";

// NOTE: the store's caches are session-level module state (that's the point —
// hydrations survive remounts), so each test uses its own card ids.

afterEach(() => {
  vi.unstubAllGlobals();
});

const fullCard = (id: string, name: string): Card => ({
  id,
  setId: "sv01",
  localId: id.split("-")[1] ?? "000",
  name,
  category: "Pokemon",
  image: `/assets/cards/${id}`,
  illustrator: null,
  rarity: "Common",
  regulationMark: "H",
  hp: 60,
  stage: "Basic",
  evolveFrom: null,
  types: ["Grass"],
  retreat: 1,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
  it("fetches unknown entry ids via GET /cards/:id and registers the results", async () => {
    const mock = vi.fn().mockResolvedValue(jsonResponse(200, fullCard("sv01-201", "Hydrated")));
    vi.stubGlobal("fetch", mock);

    const { result } = renderStoreWithEntries(new Map([["sv01-201", 2]]));
    await waitFor(() => expect(result.current.byId.has("sv01-201")).toBe(true));

    const card = result.current.byId.get("sv01-201");
    expect(card?.name).toBe("Hydrated");
    expect(card?.supertype).toBe("Pokémon");
    expect(mock.mock.calls[0]?.[0]).toBe("http://localhost:8787/cards/sv01-201");
  });

  it("skips ids the store already knows — register wins over the network", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const { result, rerender } = renderStoreWithEntries(new Map());
    act(() =>
      result.current.register([
        { cardId: "sv01-202", name: "Known", supertype: "Pokémon", subtype: "Basic" },
      ]),
    );
    await waitFor(() => expect(result.current.byId.has("sv01-202")).toBe(true));

    rerender({ entries: new Map([["sv01-202", 1]]) });
    await waitFor(() => expect(result.current.byId.get("sv01-202")?.name).toBe("Known"));
    expect(mock).not.toHaveBeenCalled();
  });

  it("marks 404 ids unknown — one attempt, no refetch loop", async () => {
    const mock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "card not found" }));
    vi.stubGlobal("fetch", mock);

    const { result, rerender } = renderStoreWithEntries(new Map([["gone-001", 4]]));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));

    // Entry churn re-runs the hydration effect; the 404 verdict holds.
    rerender({ entries: new Map([["gone-001", 3]]) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.current.byId.has("gone-001")).toBe(false);
  });

  it("register publishes a session-cached card to a mount whose map predates it", () => {
    const card = {
      cardId: "sv01-210",
      name: "Straggler",
      supertype: "Pokémon" as const,
      subtype: "Basic",
    };
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, fullCard("sv01-203", "Sticky"))),
    );
    const first = renderStoreWithEntries(new Map([["sv01-203", 1]]));
    await waitFor(() => expect(first.result.current.byId.has("sv01-203")).toBe(true));
    first.unmount();

    vi.stubGlobal("fetch", vi.fn());
    const second = renderStoreWithEntries(new Map([["sv01-203", 1]]));
    expect(second.result.current.byId.get("sv01-203")?.name).toBe("Sticky");
  });
});
