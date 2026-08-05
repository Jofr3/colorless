// D1 row → canonical catalog domain mapping (P1 milestone 5, §5.2/§6).
//
// The inverse altitude of ../ingest/map.ts (tcgdex payload → row): here rows
// come back out as the domain shapes in @luminous/schema/catalog. Pure —
// routes.ts owns the queries — so every branch unit-tests as a plain function.
//
// The mappers ALSO normalise "no value" sentinels (the literal "None") to
// null — ../sentinel.ts documents the sweep and the argument. The mirror of
// the same guard in ../ingest/map.ts, and not redundant with it: ingest fixes
// what gets WRITTEN and can only take effect on the next re-ingest, whereas
// 34 rows (36 sentinel values across two columns) are already in production
// carrying it TODAY, and no deploy can rewrite them. Read-side
// normalisation is what makes the live API and the deck builder's facet rail
// clean now; the write-side guard is what stops it coming back.
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
import { normalizeSentinel } from "../sentinel";

export type CardRow = typeof cards.$inferSelect;
export type SetRow = typeof sets.$inferSelect;
export type SerieRow = typeof series.$inferSelect;

/** The card columns a CardBrief needs — pass to `db.select(...)` so list
    queries never drag the BIG JSON blobs (attacks/abilities/…) off disk.
    `types_json` rides along: it's a few quoted words, and the builder's
    tiles and kind filters need it (M9). The two legality flags joined for
    P2 — the deck validator reads `legal` off hydrated lists. */
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
  legalStandard: cards.legalStandard,
  legalExpanded: cards.legalExpanded,
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
    rarity: normalizeSentinel(row.rarity),
    image: row.imageUrl !== null ? cardImagePath(row.id) : null,
    setId: row.setId,
    localId: row.localId,
    types: row.typesJson,
    hp: row.hp,
    regulationMark: normalizeSentinel(row.regulationMark),
    stage: normalizeSentinel(row.stage),
    trainerType: normalizeSentinel(row.trainerType),
    energyType: normalizeSentinel(row.energyType),
    legal: { standard: row.legalStandard, expanded: row.legalExpanded },
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
