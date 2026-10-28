// A small catalog built from the committed tcgdex payloads, through the ingest's own mapping, for a
// local API that must not need the network or a copy of a real catalog (the browser smoke,
// scripts/e2e.ts). It holds one deck that is legal in Expanded.

import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@colorless/schema";
import fireEnergy from "@colorless/schema/tcgdex-fixtures/card-energy-basic-sve-002.json";
import miraidon from "@colorless/schema/tcgdex-fixtures/card-pokemon-ability-sv01-081.json";
import nestBall from "@colorless/schema/tcgdex-fixtures/card-trainer-sv01-181.json";
import serieFull from "@colorless/schema/tcgdex-fixtures/serie-full-sv.json";
import setFull from "@colorless/schema/tcgdex-fixtures/set-full-sv01.json";
import {
  cardsUpsertStatements,
  mapCard,
  mapSerie,
  mapSet,
  reprintLegalitySql,
  type SetRow,
  seriesUpsertSql,
  setsUpsertSql,
} from "../ingest";

/** A 60-card deck of the fixture catalog's cards, legal in Expanded and not in Standard. */
export const FIXTURE_DECK: readonly { cardId: string; count: number }[] = [
  { cardId: "sv01-081", count: 4 },
  { cardId: "sv01-181", count: 4 },
  { cardId: "sve-002", count: 52 },
];

/** The upserts that write the fixture catalog, one statement each. Cards carry no image, so the
    asset routes never reach for an upstream. */
export function fixtureCatalogStatements(): string[] {
  const serie = tcgdexSerieSchema.parse(serieFull);
  const scarletViolet = mapSet(tcgdexSetSchema.parse(setFull));
  // The energy set has no full payload among the fixtures; the serie lists its name and counts.
  const energySet = serie.sets.find((set) => set.id === "sve");
  if (energySet === undefined) throw new Error("the sv serie fixture lists no sve set");
  const energy: SetRow = {
    ...scarletViolet,
    id: energySet.id,
    name: energySet.name,
    logoUrl: null,
    symbolUrl: null,
    countTotal: energySet.cardCount.total,
    countOfficial: energySet.cardCount.official,
    legalStandard: true,
    abbreviation: null,
  };
  const cards = [miraidon, nestBall, fireEnergy].map((payload) => ({
    ...mapCard(tcgdexCardSchema.parse(payload)),
    imageUrl: null,
  }));
  return [
    seriesUpsertSql([mapSerie(serie)]),
    setsUpsertSql([scarletViolet, energy]),
    ...cardsUpsertStatements(cards),
    reprintLegalitySql(),
  ];
}
