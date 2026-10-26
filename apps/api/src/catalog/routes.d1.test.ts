import { describe, expect, it } from "vitest";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", hp: 60 },
    { id: "sv01-191", name: "Rare Candy", category: "Trainer" },
  ]),
);

type CardsPage = { items: { id: string }[]; page: number; total: number };

async function cardsPage(search: string): Promise<CardsPage> {
  const res = await app.request(`/cards?${search}`, {}, d1().env());
  expect(res.status).toBe(200);
  return (await res.json()) as CardsPage;
}

describe("GET /cards total", () => {
  it("counts every match when no total is given", async () => {
    const page = await cardsPage("category=Pokemon&pageSize=1");
    expect(page.items.map((item) => item.id)).toEqual(["sv01-004"]);
    expect(page.total).toBe(2);
  });

  it("returns a total passed back from an earlier page instead of recounting", async () => {
    const page = await cardsPage("category=Pokemon&pageSize=1&page=2&total=7");
    expect(page.items.map((item) => item.id)).toEqual(["sv01-016"]);
    expect(page.total).toBe(7);
  });

  it("rejects a total that is not a count", async () => {
    for (const total of ["-1", "1.5", "many"]) {
      const res = await app.request(`/cards?total=${total}`, {}, d1().env());
      expect(res.status).toBe(400);
    }
  });
});
