// The pure half of the P4 card-pool loader: rows → the engine's id→Card pool.
// The query half (loadCardPool) is the same chunked db.batch(inArray) shape as
// guardUnknownCards (decks/routes.ts), built from the already-tested `chunk`, so
// only the fold gets its own test here.

import { describe, expect, it } from "vitest";
import type { CardRow } from "../catalog/map";
import { poolFromRows } from "./cardPool";

/** A minimal valid row — Energy shape (every Pokémon column NULL), like the real
    ingested sve rows. Only id/name vary per case. */
function row(id: string, name: string): CardRow {
  return {
    id,
    setId: "sve",
    localId: "1",
    name,
    category: "Energy",
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: null,
    stage: null,
    suffix: null,
    evolveFrom: null,
    typesJson: null,
    retreat: null,
    abilitiesJson: null,
    attacksJson: null,
    weaknessesJson: null,
    resistancesJson: null,
    trainerType: null,
    energyType: "Normal",
    effect: null,
    legalStandard: true,
    legalExpanded: true,
    variantsJson: null,
    imageUrl: null,
    updated: "2025-01-01T00:00:00+00:00",
  };
}

describe("poolFromRows", () => {
  it("keys each mapped Card by its id", () => {
    const pool = poolFromRows([row("sve-003", "Water Energy"), row("sve-004", "Lightning Energy")]);
    expect(Object.keys(pool).sort()).toEqual(["sve-003", "sve-004"]);
    // The value is the domain Card (mapCardRow applied), not the raw row.
    expect(pool["sve-003"]?.name).toBe("Water Energy");
    expect(pool["sve-003"]?.category).toBe("Energy");
    expect(pool["sve-003"]).not.toHaveProperty("imageUrl"); // row column → domain `image`
  });

  it("is empty for no rows", () => {
    expect(poolFromRows([])).toEqual({});
  });
});
