import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";

const d1 = useTestD1((db) =>
  seedCards(db, [
    {
      id: "sv01-004",
      name: "Charmander",
      category: "Pokemon",
      imageUrl: "https://assets.tcgdex.net/en/sv/sv01/004",
    },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", imageUrl: null },
  ]),
);

const emptyBucket = { get: async () => null, put: async () => {} };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /assets/cards/:cardId/:file for a missing asset", () => {
  it("lets the browser cache the 404 for an hour", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    for (const path of ["unknown-001/high.webp", "sv01-016/high.webp", "sv01-004/high.webp"]) {
      const res = await app.request(`/assets/cards/${path}`, {}, d1().env({ ASSETS: emptyBucket }));
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await res.json()).toEqual({ error: "not found" });
    }
  });

  it.each([503, 429])("does not cache an origin %i", async (status) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status })),
    );
    const res = await app.request(
      "/assets/cards/sv01-004/high.webp",
      {},
      d1().env({ ASSETS: emptyBucket }),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

describe("GET /assets for an id that is not a tcgdex id", () => {
  it("404s without reading R2, D1 or the origin", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const untouched = {
      get: () => Promise.reject(new Error("R2 read")),
      put: () => Promise.reject(new Error("R2 write")),
    };
    const env = { ...d1().env({ ASSETS: untouched }), DB: undefined };
    for (const path of [
      "cards/..%2F..%2Fx/high.webp",
      "cards/a%0Ab/high.webp",
      "cards/.hidden/high.webp",
      `cards/${"a".repeat(65)}/high.webp`,
      "sets/sv01..x/logo.webp",
      "sets/-x/symbol.webp",
    ]) {
      expect((await app.request(`/assets/${path}`, {}, env)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
