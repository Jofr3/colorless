// tcgdex → catalog-row mapping (P1 milestone 4, §3.4).
//
// Row types derive from the Drizzle insert types (src/db/catalog.ts) with
// optionality stripped: mapping always emits EVERY column, explicit `null`
// included, so the multi-row upserts in ./upserts.ts stay rectangular and a
// rerun overwrites stale values instead of leaving them behind.
//
// Rules (docs/workstreams/backend-data.md §5.3 + the M3 session notes):
// - missing upstream `legal` → false/false;
// - Pokémon-only fields are NULL on Trainer/Energy (and vice versa);
// - `*_url` columns keep the tcgdex ORIGIN base URLs (extensionless, §4.4);
// - `*Json` fields stay raw objects here — ./sql.ts JSON.stringifies them
//   into the SQL text (these rows never pass through Drizzle's json mode).

import type { TcgdexCard, TcgdexSerie, TcgdexSet } from "@luminous/schema";
import type { cards, series, sets } from "../db/schema";

export type SeriesRow = Required<typeof series.$inferInsert>;
export type SetRow = Required<typeof sets.$inferInsert>;
export type CardRow = Required<typeof cards.$inferInsert>;

export function mapSerie(serie: TcgdexSerie): SeriesRow {
  return {
    id: serie.id,
    name: serie.name,
    releaseDate: serie.releaseDate ?? null,
    logoUrl: serie.logo ?? null,
  };
}

export function mapSet(set: TcgdexSet): SetRow {
  return {
    id: set.id,
    serieId: set.serie.id,
    name: set.name,
    logoUrl: set.logo ?? null,
    symbolUrl: set.symbol ?? null,
    releaseDate: set.releaseDate,
    countTotal: set.cardCount.total,
    countOfficial: set.cardCount.official,
    legalStandard: set.legal.standard,
    legalExpanded: set.legal.expanded,
    tcgOnline: set.tcgOnline ?? null,
  };
}

export function mapCard(card: TcgdexCard): CardRow {
  // Every category-specific column defaults to null; each branch fills its own.
  const base: CardRow = {
    id: card.id,
    setId: card.set.id,
    localId: card.localId,
    name: card.name,
    category: card.category,
    illustrator: card.illustrator ?? null,
    rarity: card.rarity ?? null,
    regulationMark: card.regulationMark ?? null,
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
    energyType: null,
    effect: null,
    legalStandard: card.legal?.standard ?? false,
    legalExpanded: card.legal?.expanded ?? false,
    variantsJson: card.variants ?? null,
    imageUrl: card.image ?? null,
    updated: card.updated ?? null,
  };
  switch (card.category) {
    case "Pokemon":
      return {
        ...base,
        hp: card.hp ?? null,
        stage: card.stage ?? null,
        evolveFrom: card.evolveFrom ?? null,
        typesJson: card.types ?? null,
        retreat: card.retreat ?? null,
        abilitiesJson: card.abilities ?? null,
        attacksJson: card.attacks ?? null,
        weaknessesJson: card.weaknesses ?? null,
        resistancesJson: card.resistances ?? null,
      };
    case "Trainer":
      return {
        ...base,
        trainerType: card.trainerType ?? null,
        effect: card.effect ?? null,
      };
    case "Energy":
      return {
        ...base,
        energyType: card.energyType ?? null,
        effect: card.effect ?? null,
      };
  }
}
