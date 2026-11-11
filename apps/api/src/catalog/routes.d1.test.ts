import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";
import { fakeRateLimit } from "../testing/rateLimit";
import { resetCatalogReads } from "./searchLimit";

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

describe("GET /sets", () => {
  it("serves no set art and no single-set route", async () => {
    const res = await app.request("/sets", {}, d1().env());
    expect(res.status).toBe(200);
    const sets = (await res.json()) as { logo: unknown; symbol: unknown }[];
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((set) => set.logo === null && set.symbol === null)).toBe(true);
    expect((await app.request("/sets/sv01", {}, d1().env())).status).toBe(404);
  });
});

describe("the per-IP limit on catalog reads that miss KV", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogThrottle();
    resetCatalogReads();
  });

  const fakeLimiter = fakeRateLimit;

  /** Lets the KV write a miss queued land before the next request reads it. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  const from = (ip: string) => ({ headers: { "cf-connecting-ip": ip } });

  const logged = (spy: MockInstance<typeof console.warn>, evt: string) =>
    spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.evt === evt);

  it("counts each shape that scans and 429s an address over the budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scanning = [
      "name=char",
      "text=burn",
      "pageSize=8&page=4",
      "category=Pokemon&total=2",
      "hpMin=60",
      "pageSize=7",
    ];
    const limiter = fakeLimiter(scanning.length);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    for (const query of scanning) {
      expect((await app.request(`/cards?${query}`, from("203.0.113.9"), env)).status).toBe(200);
    }
    const refused = await app.request("/cards?name=pid", from("203.0.113.9"), env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(await refused.json()).toEqual({ error: "too many searches; try again in a minute" });
    expect((await app.request("/cards?name=pid", from("198.51.100.7"), env)).status).toBe(200);
    expect(logged(warn, "catalog")).toEqual([
      { evt: "catalog", kind: "rate_limited", route: "/cards" },
    ]);
  });

  it("keys an IPv6 caller by its /64", async () => {
    const limiter = fakeLimiter(1);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    expect((await app.request("/cards?name=a", from("2001:db8::1"), env)).status).toBe(200);
    expect((await app.request("/cards?name=a", from("2001:db8::2"), env)).status).toBe(429);
    expect(limiter.keys).toEqual(["2001:db8:0:0::/64", "2001:db8:0:0::/64"]);
  });

  it("spends the budget on a cacheable page's KV miss and never on its hit", async () => {
    const limiter = fakeLimiter(1);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    const first = await app.request("/cards?category=Pokemon&pageSize=8", from("203.0.113.9"), env);
    expect(first.headers.get("x-colorless-cache")).toBe("miss");
    await settle();
    const hit = await app.request("/cards?category=Pokemon&pageSize=8", from("203.0.113.9"), env);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("x-colorless-cache")).toBe("hit");
    expect(limiter.keys).toHaveLength(1);
    const miss = await app.request("/cards?category=Trainer&pageSize=8", from("203.0.113.9"), env);
    expect(miss.status).toBe(429);
    expect(miss.headers.get("Retry-After")).toBe("60");
  });

  it("limits a cacheable page on every repeat once KV writes fail", async () => {
    const limiter = fakeLimiter(1);
    const cache = {
      get: async () => null,
      put: () => Promise.reject(new Error("KV put() limit exceeded for the day.")),
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding, CACHE: cache });
    expect((await app.request("/cards?rarity=Common", from("203.0.113.9"), env)).status).toBe(200);
    expect((await app.request("/cards?rarity=Common", from("203.0.113.9"), env)).status).toBe(429);
  });

  it("limits a cacheable query whose key is too long for KV", async () => {
    const limiter = fakeLimiter(1);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    // 100 characters, the cap, percent-encode to 600 bytes, past KV's 512-byte key limit.
    const query = `/cards?illustrator=${encodeURIComponent("é".repeat(100))}`;
    const first = await app.request(query, from("203.0.113.9"), env);
    expect(first.headers.get("x-colorless-cache")).toBe("bypass");
    expect((await app.request(query, from("203.0.113.9"), env)).status).toBe(429);
  });

  it("answers an over-long filter value with the usual 400 before anything is read", async () => {
    const limiter = fakeLimiter(0);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    const res = await app.request(`/cards?set=${"x".repeat(101)}`, {}, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid query",
      issues: [expect.stringMatching(/^set: /)],
    });
    expect(limiter.keys).toEqual([]);
  });

  it("spends the budget on a /facets KV miss only", async () => {
    const limiter = fakeRateLimit(1);
    const env = () => d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    expect((await app.request("/facets", {}, env())).status).toBe(200);
    await settle();
    const hit = await app.request("/facets", {}, env());
    expect(hit.headers.get("x-colorless-cache")).toBe("hit");
    expect(limiter.keys).toHaveLength(1);
    for (const { name } of (await d1().kv.list()).keys) await d1().kv.delete(name);
    const refused = await app.request("/facets", {}, env());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
  });

  it("leaves id hydration, exact names and cheap catalog reads uncounted", async () => {
    const limiter = fakeLimiter(0);
    const env = d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    for (const path of ["/sets", "/sets?serie=sv", "/series", "/cards/sv01-004"]) {
      expect((await app.request(path, from("203.0.113.9"), env)).status).toBe(200);
    }
    expect(
      (await app.request("/cards/full?id=sv01-004&id=sv01-016", from("203.0.113.9"), env)).status,
    ).toBe(200);
    for (const query of [
      "id=sv01-004&id=sv01-016&pageSize=100",
      "id=sv01-004&name=char&page=9",
      "nameExact=Pidgey&pageSize=100",
      "nameExact=Pidgey&text=burn",
    ]) {
      expect((await app.request(`/cards?${query}`, from("203.0.113.9"), env)).status).toBe(200);
    }
    expect(limiter.keys).toEqual([]);
  });

  it("lets a search through when the binding fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { limit: () => Promise.reject(new Error("limiter unavailable")) };
    const env = d1().env({ CATALOG_SEARCH_LIMIT: broken });
    expect((await app.request("/cards?name=char", {}, env)).status).toBe(200);
    expect(logged(warn, "catalog")).toEqual([
      { evt: "catalog", kind: "limiter_error", route: "/cards", error: "Error" },
    ]);
  });

  it("logs what every KV miss reads, at most once a minute per isolate, at info level", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const env = d1().env();
    await app.request("/cards?name=char", {}, env);
    // A cacheable miss is tallied and its hit is not; the tally waits for the minute to pass.
    await app.request("/cards?category=Pokemon", {}, env);
    await settle();
    const hit = await app.request("/cards?category=Pokemon", {}, env);
    expect(hit.headers.get("x-colorless-cache")).toBe("hit");
    await app.request("/cards?text=burn&pageSize=24", {}, env);
    clock.mockReturnValue(now + 61_000);
    await app.request("/cards?hpMin=60&pageSize=8&page=2&total=2", {}, env);
    const lines = logged(info, "d1").filter((line) => line.kind === "catalog_reads");
    expect(lines).toEqual([
      expect.objectContaining({ queries: 1, max_params: "name,page,pageSize,sort" }),
      expect.objectContaining({ queries: 3, max_params: expect.any(String) }),
    ]);
    for (const line of lines) {
      expect(line.rows_read).toBeGreaterThan(0);
      expect(line.max_rows_read).toBeLessThanOrEqual(line.rows_read as number);
    }
  });
});
