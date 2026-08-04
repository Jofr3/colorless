// @tcgdex/sdk 2.9.0 vs our Zod boundary — the drift detector (D188).
//
// The SDK's TypeScript types are erased at runtime, so they can never be the
// validation boundary (D5). But they ARE a claim about the payload, and this
// file pins that claim against the two things we can check without network:
// the committed live fixtures, and the SDK's own runtime model-building.
//
// Three kinds of assertion, all of which go RED on drift:
//  1. runtime — every fixture the SDK transport would deliver still parses at
//     the Zod boundary;
//  2. runtime — the SDK's model layer MUTATES payloads (documented below),
//     which is why ./source.ts uses the raw `client.fetch(...)` endpoints;
//  3. compile-time — `@ts-expect-error` on each field the SDK's type omits but
//     live data carries. TypeScript errors on an UNUSED expect-error, so the
//     day the SDK adds one of these fields, `bun run check` fails and someone
//     re-reads this file. That is the point.
//
// FINDINGS (SDK type ✗ vs live payload / our schema), all still true at 2.9.0:
//  - `Card` declares NO `pricing`, NO `updated`, NO `variants_detailed` — all
//    three are present on every committed card fixture, and `updated` is
//    written to D1 by mapCard. Adopting the SDK type as the mapper's input
//    would have silently dropped a column.
//  - `Set` declares no `abbreviation`; live sv01 has `{"official":"SVI"}`.
//  - `Serie` declares only `{id,name,logo?,sets}`; live `sv` also has
//    `releaseDate`, `firstSet`, `lastSet`.
//  - `variants` omits `wPromo`, which our schema models.
//  - `VariantsDetailed` omits `pricing` (present on live variants) and makes
//    `variantId` required; it adds `subtype`/`thirdParty`, which we strip.
//  - `Card.item` is typed `{name: string; effect: string}` (both required) but
//    live dp5-4 serves `item: {}`.
//  - `Card.category` is `string`, not the three-way literal our discriminated
//    union needs — the SDK is LOOSER here, which is the safe direction.
//  - `Card.rarity`/`Card.legal` and `Set.cardCount.normal|reverse|holo` are
//    required in the SDK, optional in our schema. Our schema is the more
//    liberal of the two, so nothing the SDK can serve is rejected.

import {
  type TcgdexCard,
  tcgdexCardSchema,
  tcgdexSerieSchema,
  tcgdexSetSchema,
} from "@luminous/schema";
import TCGdex, {
  type Card as SdkCard,
  CardModel,
  Model,
  type Serie as SdkSerie,
  type Set as SdkSet,
  SetModel,
} from "@tcgdex/sdk";
import { describe, expect, it } from "vitest";
import cardEnergyBasic from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-basic-sve-002.json";
import cardPokemonHeldItem from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-helditem-dp5-4.json";
import cardPokemonPromo from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-promo-svp-001.json";
import cardPokemonAttacks from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-swsh3-136.json";
import cardTrainer from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-sv01-181.json";
import serieFull from "../../../../packages/schema/src/tcgdex/__fixtures__/serie-full-sv.json";
import setFull from "../../../../packages/schema/src/tcgdex/__fixtures__/set-full-sv01.json";
import { mapCard } from "./map";
import { createSdkSource, type TcgdexRawClient } from "./source";

/** Inert — `new TCGdex()` performs no I/O; only its endpoints would. */
const sdk = new TCGdex("en");

const cardFixtures: { name: string; payload: unknown }[] = [
  { name: "swsh3-136 (Pokémon, attacks)", payload: cardPokemonAttacks },
  { name: "dp5-4 (Pokémon, empty held item)", payload: cardPokemonHeldItem },
  { name: "svp-001 (Pokémon, promo)", payload: cardPokemonPromo },
  { name: "sv01-181 (Trainer)", payload: cardTrainer },
  { name: "sve-002 (Energy, basic)", payload: cardEnergyBasic },
];

describe("payloads the SDK transport would deliver still clear the Zod boundary", () => {
  for (const { name, payload } of cardFixtures) {
    it(`card ${name}`, async () => {
      const client = { fetch: async () => payload } as TcgdexRawClient;
      const delivered = await createSdkSource({ client, delayMs: 0 }).getCard("x");
      // Identity, not deep-equality: the seam must not clone or reshape.
      expect(delivered).toBe(payload);
      expect(tcgdexCardSchema.safeParse(delivered).success).toBe(true);
    });
  }

  it("full set + full serie", async () => {
    const client = { fetch: async () => setFull } as TcgdexRawClient;
    const source = createSdkSource({ client, delayMs: 0 });
    expect(tcgdexSetSchema.safeParse(await source.getSet("sv01")).success).toBe(true);
    expect(tcgdexSerieSchema.safeParse(serieFull).success).toBe(true);
  });
});

describe("why ./source.ts uses the SDK's raw endpoints, not its model endpoints", () => {
  it("CardModel RENAMES variants_detailed → variantsDetailed, and Zod then drops it SILENTLY", () => {
    expect(cardPokemonAttacks).toHaveProperty("variants_detailed");
    const model = Model.build(new CardModel(sdk), cardPokemonAttacks) as unknown as Record<
      string,
      unknown
    >;
    expect(model.variants_detailed).toBeUndefined();
    expect(model.variantsDetailed).toEqual(cardPokemonAttacks.variants_detailed);

    // The dangerous part: this still PARSES. An optional field that upstream
    // renamed is not a validation failure, it is invisible data loss — exactly
    // what the boundary exists to make impossible, so we never feed it models.
    const parsed = tcgdexCardSchema.safeParse(model);
    expect(parsed.success).toBe(true);
    expect(parsed.success && "variants_detailed" in parsed.data).toBe(false);
  });

  it("SetModel rebuilds set.cards as class instances carrying an `sdk` back-reference", () => {
    const model = Model.build(new SetModel(sdk), setFull);
    const first = model.cards[0] as unknown as Record<string, unknown>;
    expect(first).toBeDefined();
    expect(first.sdk).toBe(sdk);
    // Circular, so the model is not even JSON-serialisable — a raw payload is.
    expect(() => JSON.stringify(model)).toThrow();
    expect(() => JSON.stringify(setFull)).not.toThrow();
  });
});

describe("fields the SDK's types omit that live payloads carry", () => {
  it("Card: pricing / updated / variants_detailed are on every card fixture", () => {
    for (const { name, payload } of cardFixtures) {
      const raw = payload as Record<string, unknown>;
      expect(raw.pricing, `${name} pricing`).toBeDefined();
      expect(raw.updated, `${name} updated`).toBeDefined();
      expect(raw.variants_detailed, `${name} variants_detailed`).toBeDefined();
    }
  });

  it("mapCard writes `updated`, which the SDK's Card type does not declare", () => {
    const card = tcgdexCardSchema.parse(cardPokemonAttacks) satisfies TcgdexCard;
    expect(mapCard(card).updated).toBe(cardPokemonAttacks.updated);
  });

  it("Set: `abbreviation` is served but undeclared; Serie: releaseDate/firstSet/lastSet likewise", () => {
    expect(setFull.abbreviation).toEqual({ official: "SVI" });
    expect(serieFull.releaseDate).toBeDefined();
    expect(serieFull.firstSet).toBeDefined();
    expect(serieFull.lastSet).toBeDefined();
  });

  it("Card.item is declared with required name/effect, but live dp5-4 serves {}", () => {
    expect(cardPokemonHeldItem.item).toEqual({});
    // @ts-expect-error — SDK: `item?: {name: string; effect: string}`; the
    // fixture proves both are optional in practice. Our schema has them optional.
    const _item: SdkCard["item"] = {};
    expect(_item).toEqual({});
  });

  // Compile-time drift detectors. Each of these FAILS `tsc` the moment the SDK
  // starts declaring the field — which is the signal we want, not a silent win.
  it("the omissions are still omissions at the type level", () => {
    const card = {} as SdkCard;
    // @ts-expect-error — SDK's Card declares no `pricing`.
    void card.pricing;
    // @ts-expect-error — SDK's Card declares no `updated` (mapCard needs it).
    void card.updated;
    // @ts-expect-error — SDK's Card declares no `variants_detailed`.
    void card.variants_detailed;
    // @ts-expect-error — SDK's `variants` omits `wPromo`.
    void card.variants?.wPromo;

    const set = {} as SdkSet;
    // @ts-expect-error — SDK's Set declares no `abbreviation`.
    void set.abbreviation;

    const serie = {} as SdkSerie;
    // @ts-expect-error — SDK's Serie declares no `releaseDate`.
    void serie.releaseDate;
    // @ts-expect-error — SDK's Serie declares no `firstSet`.
    void serie.firstSet;

    expect(TRANSPORT_TYPES_CHECKED).toBe(true);
  });
});

/** Marker so the compile-time block above is still a real, asserting test. */
const TRANSPORT_TYPES_CHECKED = true;
