// Shared wire-shape fixtures for the suites that stub the api, plus the
// hand-built BuilderCard factory (`builderCard`) the pure builder suites use.

import type { CardBrief, CatalogFacets, SerieBrief, SetBrief, User } from "@luminous/schema";
import type { BuilderCard } from "../features/builder/cards";

/** The signed-in account the DOM suites authenticate as. */
export const USER: User = {
  id: "user-1",
  email: "ash@example.com",
  displayName: "Ash",
  emailVerified: false,
  avatarSeed: "1a2b3c4d",
  favouriteDeckId: null,
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

// --- Hand-built builder cards ----------------------------------------------
// `BuilderCard.legal` is required (D191): the catalog's structured verdict is
// the app's one legality mechanism. A fixture typed by hand has no catalog to
// ask, so THIS is where a printed regulation mark becomes a verdict — the one
// reader of the mark list below, and the one site a rotation edits. It used to
// be two: the same allow-list also sat on STANDARD_FORMAT, consulted by
// isLegalInFormat whenever `legal` was absent, so a rotation had to be applied
// twice and nothing failed if it wasn't.

/** The regulation marks a fixture's Standard verdict is derived from — the
    marks after the April 2026 rotation (G rotated out). "J" is ASPIRATIONAL:
    zero J-marked cards exist in the catalog today (see legality.test.ts's
    census), the entry anticipates the next rotation. This list is a fixture
    convenience, NOT a legality oracle — the catalog's own `legal_standard` is,
    and it disagrees with this derivation on 31 of its 3,786 rows, every one of
    them enumerated and pinned in that census. Rotation lands → edit here. */
export const STANDARD_LEGAL_MARKS = ["H", "I", "J"];

/** The verdict a fixture with this printed mark carries. Standard: the mark
    must be in {@link STANDARD_LEGAL_MARKS}; an UNMARKED card is legal, which
    is right for the basic Energy that most unmarked fixtures are (36 of the
    catalog's 66 unmarked rows) and wrong for the 30 pre-mark promos that make
    up the rest — model one of those by passing `legal` outright. Expanded:
    always true, which is exactly what the catalog says today (3,786 of 3,786
    rows are Expanded-legal — the format spans far more sets than the mark
    system covers). */
export function legalFromMark(mark: string | undefined): BuilderCard["legal"] {
  return { standard: mark === undefined || STANDARD_LEGAL_MARKS.includes(mark), expanded: true };
}

/** A hand-built builder card: everything the test states, plus the `legal`
    verdict derived from its printed mark. Nothing is defaulted but the verdict
    — a fixture still says its own name/supertype/subtype, so no suite inherits
    fields it didn't ask for. Pass `legal` explicitly to model a card whose
    catalog verdict contradicts its mark (sv04-266 Reversal Energy is the live
    catalog's only such row: mark G, Standard-legal). */
export function builderCard(
  card: Omit<BuilderCard, "legal"> & { legal?: BuilderCard["legal"] },
): BuilderCard {
  return { ...card, legal: card.legal ?? legalFromMark(card.regulationMark) };
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
  /** Printed rule-box markers. In SQLite's BINARY collation — which is what
      the api's ORDER BY uses — every uppercase letter sorts before every
      lowercase one, so "MEGA"/"V" precede "ex". PRODUCTION SERVES `[]` HERE
      until an ingest fills `cards.suffix`; tests that care about the empty
      case override it explicitly rather than relying on this fixture. */
  suffixes: ["MEGA", "V", "ex"],
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
