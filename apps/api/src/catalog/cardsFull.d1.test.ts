import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { CACHE_STATUS_HEADER } from "../httpCache";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-006", name: "Charizard ex", category: "Pokemon", hp: 330 },
    { id: "sv01-191", name: "Rare Candy", category: "Trainer" },
    { id: "sv01-230", name: "Fire Energy", category: "Energy" },
  ]),
);

async function cardById(id: string): Promise<Card> {
  const res = await app.request(`/cards/${id}`, {}, d1().env());
  expect(res.status).toBe(200);
  return (await res.json()) as Card;
}

describe("GET /cards/full", () => {
  it("answers the full Cards of the known ids in id order, leaving unknown ids out", async () => {
    const res = await app.request(
      "/cards/full?id=sv01-230&id=sv99-001&id=sv01-004&id=sv01-191",
      {},
      d1().env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      await cardById("sv01-004"),
      await cardById("sv01-191"),
      await cardById("sv01-230"),
    ]);
  });

  it("answers an empty list when no id is known", async () => {
    const res = await app.request("/cards/full?id=sv99-001", {}, d1().env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("keeps id batches out of KV", async () => {
    const res = await app.request("/cards/full?id=sv01-004", {}, d1().env());
    expect(res.headers.get(CACHE_STATUS_HEADER)).toBe("bypass");
    expect((await d1().kv.list()).keys).toEqual([]);
  });
});
