import { describe, expect, it } from "vitest";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";

const d1 = useTestD1(async (db) => {
  await seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", hp: 60 },
    { id: "sv01-191", name: "Rare Candy", category: "Trainer" },
  ]);
  // Facet values, among them a sentinel rarity and illustrators either side of U+FFFF.
  await db.batch([
    db.prepare(
      `UPDATE cards SET rarity = 'Common', types_json = '["Fire"]', stage = 'Basic',
        illustrator = 'Ryo Ueda', regulation_mark = 'G' WHERE id = 'sv01-004'`,
    ),
    db.prepare(
      `UPDATE cards SET rarity = 'None', types_json = '["Colorless","Fire"]', stage = 'Basic',
        illustrator = '𝒜 Astral', regulation_mark = 'H', suffix = 'ex' WHERE id = 'sv01-016'`,
    ),
    db.prepare(
      `UPDATE cards SET rarity = 'Uncommon', trainer_type = 'Item', illustrator = 'Ｆullwidth',
        regulation_mark = 'G' WHERE id = 'sv01-191'`,
    ),
  ]);
});

type CardsPage = { items: { id: string }[]; page: number; pageSize: number; total: number };

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

  it("counts a free-text search's matches on any page", async () => {
    const first = await cardsPage("name=a&sort=name&pageSize=2");
    expect(first.items.map((item) => item.id)).toEqual(["sv01-004", "sv01-191"]);
    expect(first.total).toBe(2);
    const text = await cardsPage("text=zzz");
    expect(text).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
    // Past the last match no row carries the count, and the total is still the real one.
    const beyond = await cardsPage("name=a&pageSize=2&page=3");
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(2);
  });

  it("returns a passed-back total for a free-text search", async () => {
    const page = await cardsPage("name=a&sort=name&pageSize=1&page=2&total=9");
    expect(page.items.map((item) => item.id)).toEqual(["sv01-191"]);
    expect(page.total).toBe(9);
  });

  it("serves a free-text block as the same cards as its pages", async () => {
    const block = await cardsPage("name=e&sort=name&pageSize=3");
    const pages = [1, 2, 3].map((page) => cardsPage(`name=e&sort=name&pageSize=1&page=${page}`));
    expect((await Promise.all(pages)).flatMap((page) => page.items)).toEqual(block.items);
    expect(block.total).toBe(3);
  });
});

describe("GET /facets", () => {
  it("lists each vocabulary sorted in byte order, sentinels and nulls dropped", async () => {
    const res = await app.request("/facets", {}, d1().env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rarities: ["Common", "Uncommon"],
      types: ["Colorless", "Fire"],
      stages: ["Basic"],
      trainerTypes: ["Item"],
      energyTypes: [],
      illustrators: ["Ryo Ueda", "Ｆullwidth", "𝒜 Astral"],
      regulationMarks: ["G", "H"],
      suffixes: ["ex"],
    });
  });
});
