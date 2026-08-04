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
  suffix: null,
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
  variantsJson: { normal: true, reverse: false, holo: true, firstEdition: false, wPromo: false },
  imageUrl: null,
  updated: "2025-01-04T15:52:24+01:00",
};

// mfb-33 Potion, copied VERBATIM from the production catalog — the row that
// spells absence as the literal string "None" in BOTH rarity and
// regulation_mark (D194; its 33 siblings in the `mfb` set do it in rarity
// alone). The read path must hand these back as null, because 34 such rows
// are already in the database and only a re-ingest can rewrite them.
const potionSentinelRow: CardRow = {
  id: "mfb-33",
  setId: "mfb",
  localId: "33",
  name: "Potion",
  category: "Trainer",
  illustrator: "Ayaka Yoshida",
  rarity: "None",
  regulationMark: "None",
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
  trainerType: "Item",
  energyType: null,
  effect: "Heal 30 damage from 1 of your Pokémon.",
  legalStandard: false,
  legalExpanded: true,
  variantsJson: { normal: true, reverse: false, holo: false, firstEdition: false, wPromo: false },
  imageUrl: null,
  updated: "2026-04-14T22:39:39+01:00",
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
    // A real mark stays a real mark — nothing about the sentinel guard
    // touches the 3,718 rows that carry one.
    expect(card.regulationMark).toBe("H");
    expect(card.rarity).toBe("Common");
    // `updated` is ingest bookkeeping, not domain vocabulary.
    expect("updated" in card).toBe(false);
  });

  it("maps a NULL image_url to image: null (no phantom asset path)", () => {
    const card = cardSchema.parse(mapCardRow(fireEnergyRow));
    expect(card.image).toBeNull();
    expect(card.energyType).toBe("Normal");
    expect(card.hp).toBeNull();
  });

  it("normalises the stored 'None' sentinel to null (mfb-33 Potion)", () => {
    const card = cardSchema.parse(mapCardRow(potionSentinelRow));
    expect(card.rarity).toBeNull();
    expect(card.regulationMark).toBeNull();
    expect(card.illustrator).toBe("Ayaka Yoshida");
    expect(card.effect).toBe("Heal 30 damage from 1 of your Pokémon.");
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
      types: ["Grass"],
      hp: 40,
      regulationMark: "H",
      stage: "Basic",
      trainerType: null,
      energyType: null,
      legal: { standard: true, expanded: true },
    });
  });

  it("keeps the off-category columns null (Energy row)", () => {
    const brief = cardBriefSchema.parse(mapCardBriefRow(fireEnergyRow));
    expect(brief).toMatchObject({
      types: null,
      hp: null,
      stage: null,
      trainerType: null,
      energyType: "Normal",
    });
  });

  it("normalises the stored 'None' sentinel to null (mfb-33 Potion)", () => {
    const brief = cardBriefSchema.parse(mapCardBriefRow(potionSentinelRow));
    expect(brief.rarity).toBeNull();
    expect(brief.regulationMark).toBeNull();
    // The guard touches ONLY the sentinel columns — the row's real values,
    // including a genuinely absent one, come through unchanged.
    expect(brief).toMatchObject({
      name: "Potion",
      category: "Trainer",
      trainerType: "Item",
      energyType: null,
      legal: { standard: false, expanded: true },
    });
  });

  it("folds the two legality flags into the P2 legal block", () => {
    const brief = mapCardBriefRow({ ...joltikRow, legalStandard: false, legalExpanded: true });
    expect(brief.legal).toEqual({ standard: false, expanded: true });
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
