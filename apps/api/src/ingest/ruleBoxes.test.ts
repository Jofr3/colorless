import { tcgdexCardSchema } from "@colorless/schema";
import cardPokemonAbility from "@colorless/schema/tcgdex-fixtures/card-pokemon-ability-sv01-081.json";
import cardTrainer from "@colorless/schema/tcgdex-fixtures/card-trainer-sv01-181.json";
import { describe, expect, it } from "vitest";
import { type CardRow, mapCard } from "./map";
import { RULE_BOX_EXCEPTIONS, ruleBoxMismatches } from "./ruleBoxes";

const base = mapCard(tcgdexCardSchema.parse(cardPokemonAbility));

/** A legal Pokémon printed as `name`, which the catalog tags `suffix`. */
const pokemon = (id: string, name: string, suffix: string | null, legal = true): CardRow => ({
  ...base,
  id,
  name,
  suffix,
  legalStandard: false,
  legalExpanded: legal,
  legalStandardEffective: false,
  legalExpandedEffective: legal,
});

describe("ruleBoxMismatches (COR-P4)", () => {
  it("passes every printed family as the catalog tags it, with the engine's Prize count and Rule Box", () => {
    const families: [string, string | null][] = [
      ["Pikachu & Zekrom GX", "GX"],
      ["Darkrai & Cresselia LEGEND", "Legend"],
      ["Mega Lucario ex", "ex"],
      ["Miraidon ex", "ex"],
      ["Genesect EX", "EX"],
      ["M Gardevoir EX", "EX"],
      ["Buzzwole GX", "GX"],
      ["Mew VMAX", null],
      ["Mewtwo VSTAR", "V"],
      ["Zacian V", "V"],
      ["Greninja BREAK", null],
      ["Radiant Charizard", null],
      ["Crobat G", "SP"],
      ["Terapagos & Friends", null],
      ["Meganium", null],
      ["Pikachu", null],
    ];
    const rows = families.map(([name, suffix], i) => pokemon(`x-${i}`, name, suffix));
    expect(ruleBoxMismatches(rows)).toEqual([]);
  });

  it("names a catalog suffix the printed name does not carry, and one it lacks", () => {
    expect(
      ruleBoxMismatches([pokemon("x-1", "Raichu", "ex"), pokemon("x-2", "Miraidon ex", null)]),
    ).toEqual([
      "x-1: Raichu (plain) carries catalog suffix ex",
      "x-2: Miraidon ex (ex) carries catalog suffix null",
    ]);
  });

  it("lets through the two Raichu the catalog tags ex, and only those", () => {
    expect(Object.keys(RULE_BOX_EXCEPTIONS)).toEqual(["sv02-064", "sv02-211"]);
    expect(
      ruleBoxMismatches([pokemon("sv02-064", "Raichu", "ex"), pokemon("sv02-211", "Raichu", "ex")]),
    ).toEqual([]);
  });

  it("skips a card legal nowhere and anything not a Pokémon", () => {
    const trainer = mapCard(tcgdexCardSchema.parse(cardTrainer));
    expect(
      ruleBoxMismatches([pokemon("x-1", "Raichu", "ex", false), { ...trainer, suffix: "ex" }]),
    ).toEqual([]);
  });
});
