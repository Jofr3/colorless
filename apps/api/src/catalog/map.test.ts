// Row → domain mapping, against hand-built rows that mirror the REAL
// ingested shapes (sv06.5-001 Joltik, sve-002 Fire Energy, the sv06.5 set,
// the sv serie — checked against the local D1). Every mapped value is also
// parsed through its domain schema, pinning the row → schema contract.

import { cardBriefSchema, cardSchema, serieSchema, setSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  type CardRow,
  mapCardBriefRow,
  mapCardRow,
  mapSerieRow,
  mapSetBriefRow,
  mapSetRow,
  type SerieRow,
  type SetRow,
} from "./map";

const joltikRow: CardRow = {
  id: "sv06.5-001",
  setId: "sv06.5",
  localId: "001",
  name: "Joltik",
  category: "Pokemon",
  illustrator: "Naoyo Kimura",
  rarity: "Common",
  regulationMark: "H",
  hp: 40,
  stage: "Basic",
  evolveFrom: null,
  typesJson: ["Grass"],
  retreat: 1,
  abilitiesJson: null,
  attacksJson: [{ cost: ["Grass"], name: "Splashing Dodge", effect: "Flip a coin. …", damage: 10 }],
  weaknessesJson: [{ type: "Fire", value: "×2" }],
  resistancesJson: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legalStandard: true,
  legalExpanded: true,
  variantsJson: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false },
  imageUrl: "https://assets.tcgdex.net/en/sv/sv06.5/001",
  updated: "2026-07-01T21:27:44+02:00",
};

// Basic energy: no image, no rules text, every Pokémon column NULL.
const fireEnergyRow: CardRow = {
  id: "sve-002",
  setId: "sve",
  localId: "002",
  name: "Fire Energy",
  category: "Energy",
  illustrator: null,
  rarity: "Common",
  regulationMark: null,
  hp: null,
  stage: null,
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
  variantsJson: { normal: true, reverse: false, holo: true, firstEdition: false, wPromo: false },
  imageUrl: null,
  updated: "2025-01-04T15:52:24+01:00",
};

const shroudedFableRow: SetRow = {
  id: "sv06.5",
  serieId: "sv",
  name: "Shrouded Fable",
  logoUrl: "https://assets.tcgdex.net/en/sv/sv06.5/logo",
  symbolUrl: "https://assets.tcgdex.net/univ/sv/sv06.5/symbol",
  releaseDate: "2024-08-02",
  countTotal: 99,
  countOfficial: 64,
  legalStandard: false,
  legalExpanded: true,
  tcgOnline: null,
};

const svSerieRow: SerieRow = {
  id: "sv",
  name: "Scarlet & Violet",
  releaseDate: "2023-03-31",
  logoUrl: "https://assets.tcgdex.net/en/sv/sv03.5/logo",
};

describe("mapCardRow", () => {
  it("maps a Pokémon row, rewriting the origin image URL to OUR asset base path", () => {
    const card = cardSchema.parse(mapCardRow(joltikRow));
    expect(card).toMatchObject({
      id: "sv06.5-001",
      category: "Pokemon",
      image: "/assets/cards/sv06.5-001",
      types: ["Grass"],
      legal: { standard: true, expanded: true },
      trainerType: null,
    });
    expect(card.attacks?.[0]?.name).toBe("Splashing Dodge");
    // `updated` is ingest bookkeeping, not domain vocabulary.
    expect("updated" in card).toBe(false);
  });

  it("maps a NULL image_url to image: null (no phantom asset path)", () => {
    const card = cardSchema.parse(mapCardRow(fireEnergyRow));
    expect(card.image).toBeNull();
    expect(card.energyType).toBe("Normal");
    expect(card.hp).toBeNull();
  });
});

describe("mapCardBriefRow", () => {
  it("projects the brief from the brief column subset", () => {
    const brief = cardBriefSchema.parse(mapCardBriefRow(joltikRow));
    expect(brief).toEqual({
      id: "sv06.5-001",
      name: "Joltik",
      category: "Pokemon",
      rarity: "Common",
      image: "/assets/cards/sv06.5-001",
      setId: "sv06.5",
      localId: "001",
    });
  });
});

describe("mapSetRow / mapSetBriefRow", () => {
  it("rewrites logo and symbol to the set asset base path independently", () => {
    const set = setSchema.parse(mapSetRow(shroudedFableRow));
    expect(set).toMatchObject({
      id: "sv06.5",
      logo: "/assets/sets/sv06.5",
      symbol: "/assets/sets/sv06.5",
      cardCount: { total: 99, official: 64 },
      legal: { standard: false, expanded: true },
      tcgOnline: null,
    });
  });

  it("nulls each asset path only when ITS origin column is null", () => {
    const brief = mapSetBriefRow({ ...shroudedFableRow, logoUrl: null });
    expect(brief.logo).toBeNull();
    expect(brief.symbol).toBe("/assets/sets/sv06.5");
  });
});

describe("mapSerieRow", () => {
  it("joins the serie with its set briefs and drops the unservable logo_url", () => {
    const serie = serieSchema.parse(mapSerieRow(svSerieRow, [shroudedFableRow]));
    expect(serie.id).toBe("sv");
    expect(serie.releaseDate).toBe("2023-03-31");
    expect(serie.sets.map((set) => set.id)).toEqual(["sv06.5"]);
    expect("logo" in serie).toBe(false);
  });
});
