// D1 row → canonical catalog domain mapping (P1 milestone 5, §5.2/§6).
//
// The inverse altitude of ../ingest/map.ts (tcgdex payload → row): here rows
// come back out as the domain shapes in @luminous/schema/catalog. Pure —
// routes.ts owns the queries — so every branch unit-tests as a plain function.
//
// Asset rewriting is the one real transform: rows store tcgdex ORIGIN base
// URLs (extensionless, §4.4), the domain stores OUR asset base paths
// (`/assets/cards/{id}`, `/assets/sets/{id}`) served by the lazy R2 mirror.
// A path is emitted ONLY when the corresponding origin column is non-null —
// a card with image_url NULL maps to `image: null`, and a set missing just
// its logo gets `logo: null` while keeping `symbol`.

// The domain `Set` is aliased locally so it can't be confused with the global.
import type {
  Card,
  CardBrief,
  Serie,
  SerieBrief,
  Set as CatalogSet,
  SetBrief,
} from "@luminous/schema";
import { cards, type series, type sets } from "../db/schema";

export type CardRow = typeof cards.$inferSelect;
export type SetRow = typeof sets.$inferSelect;
export type SerieRow = typeof series.$inferSelect;

/** The card columns a CardBrief needs — pass to `db.select(...)` so list
    queries never drag the JSON blobs off disk. */
export const cardBriefColumns = {
  id: cards.id,
  name: cards.name,
  category: cards.category,
  rarity: cards.rarity,
  imageUrl: cards.imageUrl,
  setId: cards.setId,
  localId: cards.localId,
};
export type CardBriefRow = Pick<CardRow, keyof typeof cardBriefColumns>;

/** OUR card-image base path (clients append `/{quality}.{ext}`, §4.4). */
function cardImagePath(cardId: string): string {
  return `/assets/cards/${cardId}`;
}

/** OUR set-asset base path (clients append `/logo.{ext}` / `/symbol.{ext}`). */
function setAssetPath(setId: string): string {
  return `/assets/sets/${setId}`;
}

export function mapCardBriefRow(row: CardBriefRow): CardBrief {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    rarity: row.rarity,
    image: row.imageUrl !== null ? cardImagePath(row.id) : null,
    setId: row.setId,
    localId: row.localId,
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
    illustrator: row.illustrator,
    rarity: row.rarity,
    regulationMark: row.regulationMark,
    hp: row.hp,
    stage: row.stage,
    evolveFrom: row.evolveFrom,
    types: row.typesJson,
    retreat: row.retreat,
    abilities: row.abilitiesJson,
    attacks: row.attacksJson,
    weaknesses: row.weaknessesJson,
    resistances: row.resistancesJson,
    trainerType: row.trainerType,
    energyType: row.energyType,
    effect: row.effect,
    legal: { standard: row.legalStandard, expanded: row.legalExpanded },
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
