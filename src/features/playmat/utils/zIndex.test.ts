import { describe, expect, it } from "vitest";
import type { CardPlacement } from "../types";
import {
  placementIndex,
  zIndexForAttached,
  zIndexForAttachedEnergy,
  zIndexForAttachedTool,
  zIndexForPlacement,
} from "./zIndex";

const hand = (index: number): CardPlacement => ({ owner: "you", zone: "hand", index });
const bench = (index: number): CardPlacement => ({ owner: "you", zone: "bench", index });
const active: CardPlacement = { owner: "you", zone: "active" };
const attached = (index: number): CardPlacement => ({ owner: "you", zone: "attached", index });
const stadiumGlobal: CardPlacement = { owner: "global", zone: "stadium" };
const stadiumPlayer: CardPlacement = { owner: "you", zone: "stadium" };

describe("placementIndex", () => {
  it("is 0 for active and stadium (they never carry an index)", () => {
    expect(placementIndex(active)).toBe(0);
    expect(placementIndex(stadiumGlobal)).toBe(0);
  });

  it("reads the index for indexed zones, defaulting to 0 when absent", () => {
    expect(placementIndex(bench(3))).toBe(3);
    expect(placementIndex({ owner: "you", zone: "bench" })).toBe(0);
  });
});

describe("zIndexForPlacement", () => {
  it("layers hand above bench above the active Pokémon", () => {
    expect(zIndexForPlacement(hand(0), 5)).toBeGreaterThan(zIndexForPlacement(bench(0), 5));
    expect(zIndexForPlacement(bench(0), 5)).toBeGreaterThan(zIndexForPlacement(active, 1));
  });

  it("puts later cards in a zone behind earlier ones (higher index → lower z)", () => {
    expect(zIndexForPlacement(hand(0), 5)).toBeGreaterThan(zIndexForPlacement(hand(3), 5));
    expect(zIndexForPlacement(bench(0), 5)).toBeGreaterThan(zIndexForPlacement(bench(2), 5));
  });

  it("gives the shared stadium 42 but a player-owned synthetic back 20", () => {
    expect(zIndexForPlacement(stadiumGlobal, 1)).toBe(42);
    expect(zIndexForPlacement(stadiumPlayer, 1)).toBe(20);
  });

  it("floats an attached tool above attached energy at the same slot", () => {
    expect(zIndexForPlacement(attached(0), 1, "tool")).toBeGreaterThan(
      zIndexForPlacement(attached(0), 1, "energy"),
    );
  });
});

describe("zIndexForAttached", () => {
  it("sits just behind its host and creeps forward per stack slot", () => {
    const hostZ = zIndexForPlacement(bench(0), 5);
    const first = zIndexForAttached(bench(0), 5, 0);
    const second = zIndexForAttached(bench(0), 5, 1);
    expect(first).toBeLessThan(hostZ); // behind the host
    expect(second).toBeGreaterThan(first); // later slots creep forward
  });

  it("caps the per-slot creep at 9 so a deep stack can't overtake the host", () => {
    expect(zIndexForAttached(bench(0), 5, 9)).toBe(zIndexForAttached(bench(0), 5, 20));
    expect(zIndexForAttached(bench(0), 5, 9)).toBeLessThan(zIndexForPlacement(bench(0), 5));
  });

  it("keeps an attached tool a touch in front of energy at the same slot", () => {
    expect(zIndexForAttachedTool(active, 1, 0)).toBeGreaterThan(
      zIndexForAttachedEnergy(active, 1, 0),
    );
    expect(zIndexForAttachedEnergy(active, 1, 0)).toBe(zIndexForAttached(active, 1, 0));
  });
});
