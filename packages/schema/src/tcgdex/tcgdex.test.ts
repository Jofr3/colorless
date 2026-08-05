// The fixtures are verbatim live responses from https://api.tcgdex.net/v2/en/
// (fetched 2026-07-09). Positive tests: every fixture parses with its schema.
// Negative tests: structurally broken payloads are rejected. For broader
// coverage against the live API, run `bun packages/schema/scripts/validate-live.ts`.

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import cardEnergyBasic from "./__fixtures__/card-energy-basic-sve-002.json";
import cardEnergySpecial from "./__fixtures__/card-energy-special-sv02-191.json";
import cardPokemonAbility from "./__fixtures__/card-pokemon-ability-sv01-081.json";
import cardPokemonHeldItem from "./__fixtures__/card-pokemon-helditem-dp5-4.json";
import cardPokemonPromo from "./__fixtures__/card-pokemon-promo-svp-001.json";
import cardPokemonAttacks from "./__fixtures__/card-pokemon-swsh3-136.json";
import cardTrainer from "./__fixtures__/card-trainer-sv01-181.json";
import cardsFilteredPage from "./__fixtures__/cards-filtered-pikachu-hp120.json";
import serieFull from "./__fixtures__/serie-full-sv.json";
import seriesList from "./__fixtures__/series-list.json";
import setFull from "./__fixtures__/set-full-sv01.json";
import setsPage from "./__fixtures__/sets-page1.json";
import {
  tcgdexCardBriefSchema,
  tcgdexCardSchema,
  tcgdexSerieBriefSchema,
  tcgdexSerieSchema,
  tcgdexSetBriefSchema,
  tcgdexSetSchema,
} from "./index";

/** Parse and, on failure, surface the zod issues in the assertion message. */
function expectParses<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    expect.fail(
      `expected payload to parse, got issues:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
}

describe("tcgdexCardSchema (full cards)", () => {
  it("parses a Pokémon with attacks + weaknesses (swsh3-136 Furret)", () => {
    const card = expectParses(tcgdexCardSchema, cardPokemonAttacks);
    expect(card.category).toBe("Pokemon");
    if (card.category === "Pokemon") {
      expect(card.attacks?.length).toBe(2);
      expect(card.weaknesses?.[0]?.type).toBe("Fighting");
    }
  });

  it("parses an SV-era Pokémon with an ability (sv01-081 Miraidon ex)", () => {
    const card = expectParses(tcgdexCardSchema, cardPokemonAbility);
    if (card.category === "Pokemon") {
      expect(card.abilities?.[0]?.name).toBe("Tandem Unit");
      expect(card.suffix).toBe("ex");
    }
  });

  it("parses a dp-era Pokémon with empty held item + string damage (dp5-4 Dialga)", () => {
    const card = expectParses(tcgdexCardSchema, cardPokemonHeldItem);
    if (card.category === "Pokemon") {
      expect(card.item).toEqual({});
      expect(card.attacks?.[1]?.damage).toBe("60+");
      expect(card.resistances?.[0]?.value).toBe("-20");
    }
  });

  it("parses a promo Pokémon (svp-001 Sprigatito)", () => {
    const card = expectParses(tcgdexCardSchema, cardPokemonPromo);
    expect(card.rarity).toBe("Promo");
  });

  it("parses a Trainer (sv01-181 Nest Ball)", () => {
    const card = expectParses(tcgdexCardSchema, cardTrainer);
    expect(card.category).toBe("Trainer");
    if (card.category === "Trainer") {
      expect(card.trainerType).toBe("Item");
    }
  });

  it("parses a basic Energy with null tcgplayer pricing (sve-002 Fire Energy)", () => {
    const card = expectParses(tcgdexCardSchema, cardEnergyBasic);
    if (card.category === "Energy") {
      expect(card.energyType).toBe("Normal");
      expect(card.pricing?.tcgplayer).toBeNull();
    }
  });

  it("parses a special Energy (sv02-191 Luminous Energy)", () => {
    const card = expectParses(tcgdexCardSchema, cardEnergySpecial);
    if (card.category === "Energy") {
      expect(card.energyType).toBe("Special");
      expect(card.effect).toBeTruthy();
    }
  });

  it("strips unknown keys instead of failing on them", () => {
    const card = expectParses(tcgdexCardSchema, { ...cardTrainer, someFutureField: 42 });
    expect(card).not.toHaveProperty("someFutureField");
  });
});

describe("tcgdexSetSchema / tcgdexSetBriefSchema", () => {
  it("parses a full set including its card briefs (sv01)", () => {
    const set = expectParses(tcgdexSetSchema, setFull);
    expect(set.cards.length).toBe(258);
    expect(set.serie.id).toBe("sv");
    expect(set.cardCount.official).toBe(198);
  });

  it("parses every entry of a /sets page as a set brief", () => {
    for (const entry of setsPage) {
      expectParses(tcgdexSetBriefSchema, entry);
    }
    expect(setsPage.length).toBeGreaterThan(0);
  });
});

describe("tcgdexSerieSchema / tcgdexSerieBriefSchema", () => {
  it("parses the full sv serie including set briefs", () => {
    const serie = expectParses(tcgdexSerieSchema, serieFull);
    expect(serie.sets.length).toBeGreaterThan(10);
    expect(serie.firstSet?.id).toBe("sve");
  });

  it("parses every entry of the /series list as a serie brief", () => {
    for (const entry of seriesList) {
      expectParses(tcgdexSerieBriefSchema, entry);
    }
    expect(seriesList.length).toBeGreaterThan(0);
  });
});

describe("tcgdexCardBriefSchema", () => {
  it("parses every entry of a filtered /cards page", () => {
    for (const entry of cardsFilteredPage) {
      expectParses(tcgdexCardBriefSchema, entry);
    }
    expect(cardsFilteredPage.length).toBeGreaterThan(0);
  });
});

describe("rejects garbage", () => {
  it("rejects a card with a mangled category", () => {
    const result = tcgdexCardSchema.safeParse({ ...cardTrainer, category: "Sorcery" });
    expect(result.success).toBe(false);
  });

  it("rejects a card missing its id", () => {
    const { id: _id, ...withoutId } = cardPokemonAttacks;
    expect(tcgdexCardSchema.safeParse(withoutId).success).toBe(false);
  });

  it("rejects a Pokémon whose hp is a string", () => {
    const result = tcgdexCardSchema.safeParse({ ...cardPokemonAttacks, hp: "110" });
    expect(result.success).toBe(false);
  });

  it("rejects a set whose releaseDate is not an ISO date", () => {
    const result = tcgdexSetSchema.safeParse({ ...setFull, releaseDate: "March 31st 2023" });
    expect(result.success).toBe(false);
  });

  it("rejects a set brief without a cardCount", () => {
    const result = tcgdexSetBriefSchema.safeParse({ id: "sv01", name: "Scarlet & Violet" });
    expect(result.success).toBe(false);
  });

  it("rejects a card brief missing localId", () => {
    const result = tcgdexCardBriefSchema.safeParse({ id: "sv01-001", name: "Pineco" });
    expect(result.success).toBe(false);
  });
});
