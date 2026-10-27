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

  it("does not cache an origin outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
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
