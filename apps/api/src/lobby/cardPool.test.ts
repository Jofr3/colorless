import { describe, expect, it } from "vitest";
import type { CardRow } from "../catalog/map";
import { poolFromRows } from "./cardPool";

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
    printKey: null,
    legalStandardEffective: null,
    legalExpandedEffective: null,
    variantsJson: null,
    imageUrl: null,
    updated: "2025-01-01T00:00:00+00:00",
  };
}

describe("poolFromRows", () => {
  it("keys each mapped Card by its id", () => {
    const pool = poolFromRows([row("sve-003", "Water Energy"), row("sve-004", "Lightning Energy")]);
    expect(Object.keys(pool).sort()).toEqual(["sve-003", "sve-004"]);
    expect(pool["sve-003"]?.name).toBe("Water Energy");
    expect(pool["sve-003"]?.category).toBe("Energy");
    expect(pool["sve-003"]).not.toHaveProperty("imageUrl");
  });

  it("is empty for no rows", () => {
    expect(poolFromRows([])).toEqual({});
  });
});
