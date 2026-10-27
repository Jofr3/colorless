import { isRngState } from "@colorless/engine";
import { FIXTURE_POOL, MIXED_DECK } from "@colorless/engine/testing";
import { describe, expect, it, vi } from "vitest";
import type { Deck } from "../decks/data";
import { prepareSandbox } from "./prepareSandbox";

vi.mock("./cardPool", () => ({
  fetchCardPool: async (ids: string[]) => ({
    pool: Object.fromEntries(ids.map((id) => [id, FIXTURE_POOL[id]])),
    missing: [],
  }),
}));

const cards = Object.entries(
  MIXED_DECK.reduce<Record<string, number>>((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {}),
).map(([cardId, count]) => ({ cardId, count }));

const deck = (id: string): Deck => ({ id, name: id, format: null, cards }) as unknown as Deck;

describe("prepareSandbox", () => {
  it("starts every new local game on a fresh ChaCha20 key, never a clock seed (MI1)", async () => {
    const a = await prepareSandbox([deck("a"), deck("b")]);
    const b = await prepareSandbox([deck("a"), deck("b")]);
    for (const setup of [a, b]) {
      expect(setup.state.rngState).toMatchObject({ alg: "chacha20" });
      expect(isRngState(setup.state.rngState)).toBe(true);
    }
    const keyOf = (rng: unknown) => (rng as { key: string }).key;
    expect(keyOf(a.state.rngState)).not.toBe(keyOf(b.state.rngState));
  });
});
