// Mapping tests run on the committed verbatim tcgdex fixtures (see
// packages/schema/src/tcgdex/__fixtures__): each payload is parsed with the
// real Zod schema first, so these tests cover schema→row end to end.

import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import cardEnergyBasic from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-basic-sve-002.json";
import cardEnergySpecial from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-special-sv02-191.json";
import cardPokemonAbility from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-ability-sv01-081.json";
import cardTrainer from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-sv01-181.json";
import serieFull from "../../../../packages/schema/src/tcgdex/__fixtures__/serie-full-sv.json";
import setFull from "../../../../packages/schema/src/tcgdex/__fixtures__/set-full-sv01.json";
import { mapCard, mapSerie, mapSet } from "./map";

describe("mapSerie", () => {
  it("maps the full sv serie, keeping the extensionless origin logo URL", () => {
    const serie = tcgdexSerieSchema.parse(serieFull);
    expect(mapSerie(serie)).toEqual({
      id: "sv",
      name: "Scarlet & Violet",
      releaseDate: "2023-03-31",
      logoUrl: "https://assets.tcgdex.net/en/sv/sv01/logo",
    });
  });

  it("nulls the optional fields when absent", () => {
    const serie = tcgdexSerieSchema.parse({ id: "misc", name: "Miscellaneous", sets: [] });
    expect(mapSerie(serie)).toEqual({
      id: "misc",
      name: "Miscellaneous",
      releaseDate: null,
      logoUrl: null,
    });
  });
});

describe("mapSet", () => {
  it("maps the full sv01 set onto the sets row", () => {
    const set = tcgdexSetSchema.parse(setFull);
    expect(mapSet(set)).toEqual({
      id: "sv01",
      serieId: "sv",
      name: "Scarlet & Violet",
      logoUrl: "https://assets.tcgdex.net/en/sv/sv01/logo",
      symbolUrl: "https://assets.tcgdex.net/univ/sv/sv01/symbol",
      releaseDate: "2023-03-31",
      countTotal: 258,
      countOfficial: 198,
      legalStandard: false,
      legalExpanded: true,
      tcgOnline: null,
    });
  });
});

describe("mapCard", () => {
  it("maps a Pokémon: battle fields filled, Trainer/Energy fields null", () => {
    const card = tcgdexCardSchema.parse(cardPokemonAbility);
    expect(mapCard(card)).toEqual({
      id: "sv01-081",
      setId: "sv01",
      localId: "081",
      name: "Miraidon ex",
      category: "Pokemon",
      illustrator: "5ban Graphics",
      rarity: "Double rare",
      regulationMark: "G",
      hp: 220,
      stage: "Basic",
      // D197 — this fixture is a "Miraidon ex", and the payload has carried
      // `"suffix":"ex"` all along; ingest simply dropped it. Persisting it is
      // what lets an EX/Mega selection become a server param instead of a
      // client-side re-derivation off the card NAME.
      suffix: "ex",
      evolveFrom: null,
      typesJson: ["Lightning"],
      retreat: 1,
      abilitiesJson: [
        {
          type: "Ability",
          name: "Tandem Unit",
          effect:
            "Once during your turn, you may search your deck for up to 2 Basic {L} Pokémon and put them onto your Bench. Then, shuffle your deck.",
        },
      ],
      attacksJson: [
        {
          cost: ["Lightning", "Lightning", "Colorless"],
          name: "Photon Blaster",
          effect: "During your next turn, this Pokémon can't attack.",
          damage: 220,
        },
      ],
      weaknessesJson: [{ type: "Fighting", value: "×2" }],
      resistancesJson: null,
      trainerType: null,
      energyType: null,
      effect: null,
      legalStandard: false,
      legalExpanded: true,
      variantsJson: {
        firstEdition: false,
        holo: false,
        normal: false,
        reverse: false,
        wPromo: false,
      },
      imageUrl: "https://assets.tcgdex.net/en/sv/sv01/081",
      updated: card.updated ?? null,
    });
  });

  it("maps a Trainer: effect/trainerType filled, Pokémon fields null", () => {
    const card = tcgdexCardSchema.parse(cardTrainer);
    const row = mapCard(card);
    expect(row.category).toBe("Trainer");
    expect(row.trainerType).toBe("Item");
    expect(row.effect).toMatch(/^Search your deck for a Basic Pokémon/);
    expect(row.energyType).toBeNull();
    expect(row.hp).toBeNull();
    expect(row.typesJson).toBeNull();
    expect(row.attacksJson).toBeNull();
    expect(row.suffix).toBeNull(); // Pokémon-only, like stage/hp
    expect(row.imageUrl).toBe("https://assets.tcgdex.net/en/sv/sv01/181");
  });

  it("maps a basic Energy: energyType filled, no effect, no image", () => {
    const card = tcgdexCardSchema.parse(cardEnergyBasic);
    const row = mapCard(card);
    expect(row.category).toBe("Energy");
    expect(row.energyType).toBe("Normal");
    expect(row.effect).toBeNull();
    expect(row.trainerType).toBeNull();
    expect(row.imageUrl).toBeNull();
    expect(row.legalStandard).toBe(true);
    expect(row.legalExpanded).toBe(true);
    expect(row.variantsJson).toEqual({
      firstEdition: false,
      holo: false,
      normal: true,
      reverse: true,
      wPromo: false,
    });
  });

  it("maps a special Energy with rules text", () => {
    const card = tcgdexCardSchema.parse(cardEnergySpecial);
    const row = mapCard(card);
    expect(row.category).toBe("Energy");
    expect(row.effect).not.toBeNull();
  });

  it("normalises upstream 'None' sentinels to NULL instead of storing them", () => {
    // The `mfb` set's payload shape (D194): upstream spells "this card has
    // no rarity / no regulation mark" as the literal STRING "None", which
    // `?? null` happily writes through. Overlaid on the real sv01-181
    // Trainer fixture so the rest of the mapping stays honest.
    const card = tcgdexCardSchema.parse({
      ...(cardTrainer as Record<string, unknown>),
      rarity: "None",
      regulationMark: "None",
    });
    const row = mapCard(card);
    expect(row.rarity).toBeNull();
    expect(row.regulationMark).toBeNull();
    // Untouched: the sentinel guard is not a general string filter.
    expect(row.trainerType).toBe("Item");
    expect(row.illustrator).not.toBeNull();
  });

  // D197 — `suffix` joins the sentinel-normalised VOCABULARY columns rather
  // than the prose ones: it is a small closed set destined for a facet list,
  // so a literal "None" would land in the rail as a dead chip exactly the way
  // rarity's did (D194). Cheaper to guard at ingest than to discover later.
  it("normalises a 'None' suffix to NULL, and an absent one too", () => {
    const sentinel = mapCard(
      tcgdexCardSchema.parse({ ...(cardPokemonAbility as Record<string, unknown>), suffix: "None" }),
    );
    expect(sentinel.suffix).toBeNull();

    const { suffix: _suffix, ...withoutSuffix } = cardPokemonAbility as Record<string, unknown>;
    expect(mapCard(tcgdexCardSchema.parse(withoutSuffix)).suffix).toBeNull();
  });

  it("defaults a missing upstream `legal` block to false/false", () => {
    const { legal: _legal, ...withoutLegal } = tcgdexCardSchema.parse(cardEnergyBasic);
    const card = tcgdexCardSchema.parse(withoutLegal);
    const row = mapCard(card);
    expect(row.legalStandard).toBe(false);
    expect(row.legalExpanded).toBe(false);
  });
});
