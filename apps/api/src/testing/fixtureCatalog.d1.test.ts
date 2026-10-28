import { savedDeckReasons } from "@colorless/engine";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { loadCardPool } from "../lobby/cardPool";
import { useTestD1 } from "./d1";
import { FIXTURE_DECK, fixtureCatalogStatements } from "./fixtureCatalog";

const d1 = useTestD1(async (db) => {
  await db.batch(fixtureCatalogStatements().map((statement) => db.prepare(statement)));
});

describe("the fixture catalog", () => {
  it("holds a deck a lobby plays in Expanded and refuses in Standard", async () => {
    const pool = await loadCardPool(
      drizzle(d1().db),
      FIXTURE_DECK.map((entry) => entry.cardId),
    );
    expect(Object.keys(pool).sort()).toEqual(["sv01-081", "sv01-181", "sve-002"]);
    expect(savedDeckReasons(FIXTURE_DECK, "expanded", pool)).toEqual([]);
    expect(savedDeckReasons(FIXTURE_DECK, "standard", pool)).not.toEqual([]);
  });

  it("stores no image, so nothing asks an upstream for art", async () => {
    const { results } = await d1().db.prepare("SELECT image_url FROM cards").all();
    expect(results).toEqual([{ image_url: null }, { image_url: null }, { image_url: null }]);
  });
});
