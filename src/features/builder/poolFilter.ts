// The builder's filter state and the client-side remainder of the card
// search. The heavy filtering (name / category / energy type / rarity /
// legality / sort) is done server-side by GET /cards — catalog.ts translates
// Filters into that query and useCardSearch pages it in. This module keeps
// the Filters model the rail edits, plus the ONE dimension the server can't
// express: the card-"kind" chips.

import {
  type BuilderCard,
  cardMatchesCategories,
  type EnergyType,
  type Rarity,
  type Supertype,
} from "./cards";

export type SortKey = "name" | "hp-desc" | "set";

export interface Filters {
  /** Free-text name search (server-side, debounced substring match). */
  query: string;
  /** "all" or one supertype. */
  supertype: "all" | Supertype;
  /** Selected energy types; empty means no type restriction. */
  types: EnergyType[];
  /** Selected subtypes (Basic / Stage 1 / Item / Supporter / …); empty = all. */
  subtypes: string[];
  /** Selected rarities (Common / Uncommon / Double rare / …); empty = all. */
  rarities: Rarity[];
  /** Hide cards illegal in the active format. On by default so the grid can't
      be filled with rotated-out cards; only bites when the format actually
      restricts legality (Standard, not Expanded). */
  legalOnly: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  supertype: "all",
  types: [],
  subtypes: [],
  rarities: [],
  legalOnly: true,
  sort: "name",
};

/** True when a filter deviates from the defaults — used to show a "reset"
    affordance only when it would do something (sort is excluded). */
export function filtersActive(filters: Filters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.supertype !== "all" ||
    filters.types.length > 0 ||
    filters.subtypes.length > 0 ||
    filters.rarities.length > 0 ||
    !filters.legalOnly
  );
}

/** The card-kind (`subtypes`) filter, applied CLIENT-side to each fetched
    page. M9 approximation: the kind labels union printed subtypes with
    derived ones (Evolution spans two stages; EX/Mega are read off the card
    NAME), which the server's single-column filters can't express as one OR —
    so the grid narrows the loaded pages locally with the same heuristics as
    before. Consequence: a page can show fewer tiles than the server total
    suggests. P2 replaces the name regexes with structured card data and
    moves this server-side. */
export function filterVisibleCards(cards: BuilderCard[], subtypes: string[]): BuilderCard[] {
  if (subtypes.length === 0) return cards;
  return cards.filter((card) => cardMatchesCategories(card, subtypes));
}
