// Maps D1 rows to the catalog domain shapes. The mappers normalise the "None" sentinel to null,
// since rows already written may still carry it. Asset columns are rewritten from tcgdex origin
// bases to our /assets paths, and only when the origin column is non-null.

// The domain `Set` is aliased locally so it can't be confused with the global.
import type {
  Card,
  CardBrief,
  Serie,
  SerieBrief,
  Set as CatalogSet,
  SetBrief,
} from "@colorless/schema";
import { isBasicEnergy, isSpecialEnergy } from "@colorless/engine";
import { sql } from "drizzle-orm";
import { cards, type series, type sets } from "../db/schema";
import { normalizeSentinel } from "../sentinel";

export type CardRow = typeof cards.$inferSelect;
export type SetRow = typeof sets.$inferSelect;
export type SerieRow = typeof series.$inferSelect;

/** The card columns a CardBrief needs — pass to `db.select(...)` so list
    queries never drag the BIG JSON blobs (attacks/abilities/…) off disk.
    `types_json` rides along: it's a few quoted words, and the builder's
    tiles and kind filters need it. The two legality flags ride along too:
    the deck validator reads `legal` off hydrated lists. */
export const cardBriefColumns = {
  id: cards.id,
  name: cards.name,
  category: cards.category,
  rarity: cards.rarity,
  imageUrl: cards.imageUrl,
  setId: cards.setId,
  localId: cards.localId,
  typesJson: cards.typesJson,
  hp: cards.hp,
  regulationMark: cards.regulationMark,
  stage: cards.stage,
  trainerType: cards.trainerType,
  energyType: cards.energyType,
  /**
   * Rules text of Energy rows only (null otherwise), so the brief can tell Special Energy that
   * tcgdex tags "Normal".
   */
  effect: sql<string | null>`CASE WHEN ${cards.category} = 'Energy' THEN ${cards.effect} END`,
  legalStandard: cards.legalStandard,
  legalExpanded: cards.legalExpanded,
  legalStandardEffective: cards.legalStandardEffective,
  legalExpandedEffective: cards.legalExpandedEffective,
};
export type CardBriefRow = Pick<CardRow, keyof typeof cardBriefColumns>;

/**
 * The brief's Energy subtype as the engine classifies it: a "Normal"-tagged Energy that prints
 * rules text is "Special".
 */
function briefEnergyType(
  row: Pick<CardBriefRow, "category" | "energyType" | "effect">,
): string | null {
  const energyType = normalizeSentinel(row.energyType);
  const face = { category: row.category, energyType, effect: row.effect };
  if (isSpecialEnergy(face)) return "Special";
  return isBasicEnergy(face) ? "Normal" : energyType;
}

/** OUR card-image base path (clients append `/{quality}.{ext}`, §4.4). */
function cardImagePath(cardId: string): string {
  return `/assets/cards/${cardId}`;
}

/** OUR set-asset base path (clients append `/logo.{ext}` / `/symbol.{ext}`). */
function setAssetPath(setId: string): string {
  return `/assets/sets/${setId}`;
}

/** A print's served legality: the reprint-rule verdict when the ingest
    post-pass has written it, else its own tcgdex flags (db/catalog.ts). */
function legalOf(
  row: Pick<
    CardRow,
    "legalStandard" | "legalExpanded" | "legalStandardEffective" | "legalExpandedEffective"
  >,
) {
  return {
    standard: row.legalStandardEffective ?? row.legalStandard,
    expanded: row.legalExpandedEffective ?? row.legalExpanded,
  };
}

export function mapCardBriefRow(row: CardBriefRow): CardBrief {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    rarity: normalizeSentinel(row.rarity),
    image: row.imageUrl !== null ? cardImagePath(row.id) : null,
    setId: row.setId,
    localId: row.localId,
    types: row.typesJson,
    hp: row.hp,
    regulationMark: normalizeSentinel(row.regulationMark),
    stage: normalizeSentinel(row.stage),
    trainerType: normalizeSentinel(row.trainerType),
    energyType: briefEnergyType(row),
    legal: legalOf(row),
  };
}

export function mapCardRow(row: CardRow): Card {
  return {
    id: row.id,
    setId: row.setId,
    localId: row.localId,
    name: row.name,
    category: row.category,
    image: row.imageUrl !== null ? cardImagePath(row.id) : null,
    illustrator: normalizeSentinel(row.illustrator),
    rarity: normalizeSentinel(row.rarity),
    regulationMark: normalizeSentinel(row.regulationMark),
    hp: row.hp,
    stage: normalizeSentinel(row.stage),
    evolveFrom: normalizeSentinel(row.evolveFrom),
    types: row.typesJson,
    retreat: row.retreat,
    abilities: row.abilitiesJson,
    attacks: row.attacksJson,
    weaknesses: row.weaknessesJson,
    resistances: row.resistancesJson,
    trainerType: normalizeSentinel(row.trainerType),
    energyType: normalizeSentinel(row.energyType),
    effect: row.effect,
    legal: legalOf(row),
    variants: row.variantsJson,
  };
}

export function mapSetBriefRow(row: SetRow): SetBrief {
  return {
    id: row.id,
    serieId: row.serieId,
    name: row.name,
    logo: row.logoUrl !== null ? setAssetPath(row.id) : null,
    symbol: row.symbolUrl !== null ? setAssetPath(row.id) : null,
    releaseDate: row.releaseDate,
    cardCount: { total: row.countTotal, official: row.countOfficial },
    abbreviation: row.abbreviation,
  };
}

export function mapSetRow(row: SetRow): CatalogSet {
  return {
    ...mapSetBriefRow(row),
    legal: { standard: row.legalStandard, expanded: row.legalExpanded },
    tcgOnline: row.tcgOnline,
  };
}

export function mapSerieBriefRow(row: SerieRow): SerieBrief {
  return {
    id: row.id,
    name: row.name,
    releaseDate: row.releaseDate,
  };
}

/** Full serie = the brief + its set briefs (joined by the caller). */
export function mapSerieRow(row: SerieRow, setRows: SetRow[]): Serie {
  return {
    ...mapSerieBriefRow(row),
    sets: setRows.map(mapSetBriefRow),
  };
}
