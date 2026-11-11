// KV serves a cached body verbatim until it expires, so a deploy that changes a cached response's
// shape must bump CACHE_VERSION, and one that changes the card index's columns must bump
// CARD_INDEX_VERSION too, which the browser and CDN copies answer to. These pins fail until it
// does.

import { CARD_INDEX_COLUMNS, CARD_INDEX_VERSION } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";
import { CACHE_VERSION } from "./cache";
import { cardIndexRoutes } from "./cardIndex";
import { CACHED_RESPONSE_SCHEMAS, catalogRoutes } from "./routes";

/**
 * Append-only: each CACHE_VERSION with the fingerprint of the shapes cached under it. When the
 * test below fails, bump CACHE_VERSION and add its row with the fingerprint the failure received;
 * never edit a row in place, which would let the old entries be served as the new shape.
 */
const CACHED_SHAPES: Record<string, string> = {
  v12: "7159e8ad7eaf81e8",
  v13: "4ca1f3bba5089887",
};

/** Append-only, likewise: each CARD_INDEX_VERSION with the fingerprint of its columns. */
const CARD_INDEX_SHAPES: Record<number, string> = {
  1: "0988902e712513ec",
};

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const cardIndexShape = () => fingerprint(CARD_INDEX_COLUMNS);

const cachedShape = () =>
  fingerprint({
    responses: Object.fromEntries(
      Object.entries(CACHED_RESPONSE_SCHEMAS).map(([route, schema]) => [
        route,
        z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }),
      ]),
    ),
    cardIndex: { version: CARD_INDEX_VERSION, columns: CARD_INDEX_COLUMNS },
  });

describe("cached response shapes", () => {
  it("match the fingerprint pinned for this CACHE_VERSION", async () => {
    expect(await cachedShape(), `the shapes cached under ${CACHE_VERSION}`).toBe(
      CACHED_SHAPES[CACHE_VERSION],
    );
  });

  it("match the columns pinned for this CARD_INDEX_VERSION", async () => {
    expect(await cardIndexShape(), `card index version ${CARD_INDEX_VERSION}`).toBe(
      CARD_INDEX_SHAPES[CARD_INDEX_VERSION],
    );
  });
});

const d1 = useTestD1((db) =>
  seedCards(db, [{ id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 }]),
);

/** A request path for each parameterized catalog route. */
const EXAMPLE_PATHS: Record<string, string> = {
  "/cards/:id": "/cards/sv01-004",
};

describe("the routes the pins cover", () => {
  it("are every catalog route that stores its response in KV", async () => {
    const routes = [...catalogRoutes.routes, ...cardIndexRoutes.routes]
      .filter((route) => route.method === "GET")
      .map((route) => route.path);
    const stored: string[] = [];
    for (const route of new Set(routes)) {
      const path = EXAMPLE_PATHS[route] ?? route;
      expect(path, `an example path for ${route}`).not.toContain(":");
      const puts: string[] = [];
      const kv = {
        get: async () => null,
        put: async (key: string) => {
          puts.push(key);
        },
      };
      const res = await app.request(path, {}, d1().env({ CACHE: kv }));
      if (res.status === 200 && puts.length > 0) stored.push(route);
    }
    expect(stored.sort()).toEqual([...Object.keys(CACHED_RESPONSE_SCHEMAS), "/cards/index"].sort());
  });
});
