import { describe, expect, it } from "vitest";
import { type Banner, BANNER_BY_ID, bannerOfId } from "./banners";
import { CATALOG_BANNER_POOL } from "./bannerCatalogPool";
import { LEGAL_EX_POOL } from "./bannerPool";
import { PARADOX_POOL } from "./paradoxPool";

type Row = {
  id: string;
  name: string;
  category: string;
  standardLegal: boolean;
  key: string;
};

const ROWS: Row[] = [
  ...LEGAL_EX_POOL.map(([id, name, hp, attacks, abilities]) => ({
    id,
    name,
    category: "Pokemon",
    standardLegal: true,
    key: JSON.stringify([name, hp, attacks, abilities]),
  })),
  ...PARADOX_POOL.map(([id, name, category, hp, attacks, abilities]) => ({
    id,
    name,
    category,
    standardLegal: true,
    key: JSON.stringify([name, hp, attacks, abilities]),
  })),
  ...CATALOG_BANNER_POOL.map(([id, name, category, standardLegal, hp, attacks, abilities]) => ({
    id,
    name,
    category,
    standardLegal,
    key: JSON.stringify([name, hp, attacks, abilities]),
  })),
];

const SPECIES: Record<string, Banner> = {
  "Great Tusk": "Ancient",
  "Scream Tail": "Ancient",
  "Brute Bonnet": "Ancient",
  "Flutter Mane": "Ancient",
  "Slither Wing": "Ancient",
  "Sandy Shocks": "Ancient",
  "Roaring Moon": "Ancient",
  Koraidon: "Ancient",
  "Walking Wake": "Ancient",
  "Gouging Fire": "Ancient",
  "Raging Bolt": "Ancient",
  "Iron Treads": "Future",
  "Iron Bundle": "Future",
  "Iron Hands": "Future",
  "Iron Jugulis": "Future",
  "Iron Moth": "Future",
  "Iron Thorns": "Future",
  "Iron Valiant": "Future",
  Miraidon: "Future",
  "Iron Leaves": "Future",
  "Iron Boulder": "Future",
  "Iron Crown": "Future",
};

const PARADOX_TRAINERS: Record<string, Banner> = {
  "Awakening Drum": "Ancient",
  "Explorer's Guidance": "Ancient",
  "Professor Sada's Vitality": "Ancient",
  "Ancient Booster Energy Capsule": "Ancient",
  "Earthen Vessel": "Ancient",
  "Reboot Pod": "Future",
  "Ciphermaniac's Codebreaking": "Future",
  "Professor Turo's Scenario": "Future",
  "Future Booster Energy Capsule": "Future",
  "Techno Radar": "Future",
};

// The banner first printed in Paradox Rift: Scarlet & Violet, Obsidian Flames and their promos
// print none, nor do Paldean Fates' reprints of the Scarlet & Violet ex.
const BEFORE_PARADOX_RIFT = [
  "sv01-080",
  "sv01-081",
  "sv01-123",
  "sv01-124",
  "sv01-125",
  "sv01-143",
  "sv01-227",
  "sv01-230",
  "sv01-231",
  "sv01-233",
  "sv01-244",
  "sv01-246",
  "sv01-247",
  "sv01-248",
  "sv01-253",
  "sv01-254",
  "sv03-079",
  "sv03-124",
  "svp-013",
  "svp-014",
  "svp-028",
  "svp-029",
  "svp-143",
  "sv04.5-243",
  "sv04.5-245",
];

const LATER_WITHOUT_BANNER = [
  "sv07-090",
  "svp-148",
  "svp-197",
  "mep-082",
  "me05-028",
  "me05-047",
  "me06-042",
  "30th-062",
  "30th-086",
];

const TERA_PARADOX_SPECIES = ["me02.5-073", "me02.5-121"];

function expectedSpeciesBanner(row: Row): Banner | undefined {
  if (BEFORE_PARADOX_RIFT.includes(row.id) || LATER_WITHOUT_BANNER.includes(row.id)) {
    return undefined;
  }
  if (TERA_PARADOX_SPECIES.includes(row.id)) return "Tera";
  return SPECIES[row.name.replace(/ ex$/, "")];
}

describe("banners over every catalog printing, Standard and Expanded (COR-P1)", () => {
  const speciesRows = ROWS.filter(
    (row) => row.category === "Pokemon" && SPECIES[row.name.replace(/ ex$/, "")] !== undefined,
  );

  it("the three pools hold each printing once", () => {
    const ids = ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every Paradox-species Pokémon carries its species' banner unless its printing has none", () => {
    expect(speciesRows).toHaveLength(154);
    expect(speciesRows.filter((row) => !row.standardLegal)).toHaveLength(66);
    const wrong = speciesRows
      .filter((row) => bannerOfId(row.id) !== expectedSpeciesBanner(row))
      .map((row) => `${row.id} ${row.name}: ${bannerOfId(row.id)}`);
    expect(wrong).toEqual([]);
    const listed = [...BEFORE_PARADOX_RIFT, ...LATER_WITHOUT_BANNER, ...TERA_PARADOX_SPECIES];
    for (const id of listed)
      expect(
        speciesRows.some((row) => row.id === id),
        id,
      ).toBe(true);
  });

  it("every printing of a Paradox Trainer name carries that name's banner", () => {
    const trainers = ROWS.filter((row) => PARADOX_TRAINERS[row.name] !== undefined);
    expect(trainers).toHaveLength(25);
    const wrong = trainers
      .filter((row) => bannerOfId(row.id) !== PARADOX_TRAINERS[row.name])
      .map((row) => `${row.id} ${row.name}: ${bannerOfId(row.id)}`);
    expect(wrong).toEqual([]);
  });

  it("the Expanded-only printings the probe found with no banner have one", () => {
    expect(bannerOfId("sv03-125")).toBe("Tera");
    expect(bannerOfId("sv03-215")).toBe("Tera");
    expect(bannerOfId("sv04.5-054")).toBe("Tera");
    expect(bannerOfId("svp-196")).toBe("Tera");
    expect(bannerOfId("sv04-124")).toBe("Ancient");
    expect(bannerOfId("sv04-108")).toBe("Ancient");
    expect(bannerOfId("sv08.5-162")).toBe("Ancient");
    expect(bannerOfId("sv04-089")).toBe("Future");
  });

  it("REPRINT CONSISTENCY: printings sharing name, HP, attack and ability names agree on the banner", () => {
    const groups = new Map<string, string[]>();
    for (const row of ROWS) groups.set(row.key, [...(groups.get(row.key) ?? []), row.id]);
    const split = [...groups.values()].filter(
      (members) => new Set(members.map((id) => bannerOfId(id))).size > 1,
    );
    expect(split).toEqual([]);
  });

  it("every listed id is a catalog printing, and every Tera id a Pokémon ex", () => {
    const byId = new Map(ROWS.map((row) => [row.id, row] as const));
    for (const [id, banner] of Object.entries(BANNER_BY_ID)) {
      const row = byId.get(id);
      expect(row, id).toBeDefined();
      if (banner === "Tera") expect(row?.name.endsWith(" ex"), id).toBe(true);
    }
  });
});
