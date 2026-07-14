// Shared wire-shape fixtures for the suites that stub the api.

import type { CardBrief, CatalogFacets, SerieBrief, SetBrief, User } from "@luminous/schema";

/** The signed-in account the DOM suites authenticate as. */
export const USER: User = {
  id: "user-1",
  email: "ash@example.com",
  displayName: "Ash",
  emailVerified: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** A catalog-shaped card brief (the wire vocabulary: unaccented category,
    tcgdex "Stage1"/"Tool"/"Normal" subtypes, null off-category fields). */
export function cardBrief(over: Partial<CardBrief> = {}): CardBrief {
  return {
    id: "sv06.5-001",
    name: "Joltik",
    category: "Pokemon",
    rarity: "Common",
    image: "/assets/cards/sv06.5-001",
    setId: "sv06.5",
    localId: "001",
    types: ["Grass"],
    hp: 40,
    regulationMark: "H",
    stage: "Basic",
    trainerType: null,
    energyType: null,
    legal: { standard: true, expanded: true },
    ...over,
  };
}

/** A GET /cards page envelope around briefs. */
export function cardsPage(items: CardBrief[], total = items.length) {
  return { items, page: 1, pageSize: items.length, total };
}

/** A full GET /facets payload (sorted string[] per facet, like the api). */
export const FACETS: CatalogFacets = {
  rarities: ["Common", "Double rare", "Uncommon"],
  types: ["Fire", "Grass", "Lightning", "Water"],
  stages: ["Basic", "Stage1", "Stage2"],
  trainerTypes: ["Item", "Stadium", "Supporter", "Tool"],
  energyTypes: ["Normal", "Special"],
  illustrators: ["5ban Graphics", "Mitsuhiro Arita"],
  regulationMarks: ["G", "H", "I"],
};

/** Set briefs across two series (release-date order, like GET /sets). */
export const SETS: SetBrief[] = [
  {
    id: "swsh01",
    serieId: "swsh",
    name: "Sword & Shield",
    logo: null,
    symbol: null,
    releaseDate: "2020-02-07",
    cardCount: { total: 216, official: 202 },
  },
  {
    id: "sv06",
    serieId: "sv",
    name: "Twilight Masquerade",
    logo: null,
    symbol: null,
    releaseDate: "2024-05-24",
    cardCount: { total: 226, official: 167 },
  },
];

/** Serie options matching SETS (GET /series shape minus the nested sets). */
export const SERIES: SerieBrief[] = [
  { id: "swsh", name: "Sword & Shield", releaseDate: "2020-02-07" },
  { id: "sv", name: "Scarlet & Violet", releaseDate: "2023-03-31" },
];
