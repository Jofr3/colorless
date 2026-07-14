// The builder's filter state and the client-side remainder of the card
// search. The heavy filtering (name / category / energy type / kind / rarity /
// set / serie / illustrator / regulation mark / HP / ability text / legality /
// sort) is done server-side by GET /cards — catalog.ts translates Filters
// into that query and useCardSearch pages it in. This module keeps the
// Filters model the rail edits, plus the ONE remainder the server can't
// express: kind selections containing a DERIVED kind (EX/Mega, name regexes).

import {
  type BuilderCard,
  cardMatchesKinds,
  type EnergyType,
  isDerivedKind,
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
  /** Selected card-kind labels, builder dialect (Basic / Stage 1 / Item /
      EX / …), contextual per supertype; empty = all. */
  subtypes: string[];
  /** Selected rarities — exact catalog strings (GET /facets); empty = all. */
  rarities: string[];
  /** Set id, e.g. "sv06" ("" = any). */
  setId: string;
  /** Serie id, e.g. "sv" ("" = any). */
  serieId: string;
  /** Exact illustrator, verbatim from GET /facets ("" = any). */
  illustrator: string;
  /** Exact regulation mark, e.g. "H" ("" = any). */
  regulationMark: string;
  /** Inclusive HP bounds as typed ("" = unset; non-numeric input is ignored
      rather than sent). Strings because they mirror debounced text inputs. */
  hpMin: string;
  hpMax: string;
  /** Ability/attack text search (server-side, debounced substring match). */
  text: string;
  /** Hide cards illegal in the active format — the server filters on the
      format's own `legal.<flag>` column (cards.ts legalFlag), the same
      verdict validateDeck reads. On by default so the grid can't be filled
      with out-of-format cards. */
  legalOnly: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  supertype: "all",
  types: [],
  subtypes: [],
  rarities: [],
  setId: "",
  serieId: "",
  illustrator: "",
  regulationMark: "",
  hpMin: "",
  hpMax: "",
  text: "",
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
    filters.setId !== "" ||
    filters.serieId !== "" ||
    filters.illustrator !== "" ||
    filters.regulationMark !== "" ||
    filters.hpMin.trim() !== "" ||
    filters.hpMax.trim() !== "" ||
    filters.text.trim() !== "" ||
    !filters.legalOnly
  );
}

/** The card-kind (`subtypes`) filter's client-side remainder. Printed kinds
    filter server-side (P2 task 9 — stage/trainerType/energyType params), so
    a purely-printed selection passes the page through untouched here. A
    selection containing a DERIVED kind (EX/Mega — name regexes the server
    can't express) falls back to this per-page filter for the WHOLE dimension,
    preserving OR-within-dimension ("Basic OR EX" can't be half server-side).
    filtersToCardsQuery applies the mirror-image rule, so exactly one side
    filters. Consequence (derived selections only): a page can show fewer
    tiles than the server total suggests. */
export function filterVisibleCards(cards: BuilderCard[], subtypes: string[]): BuilderCard[] {
  if (subtypes.length === 0 || !subtypes.some(isDerivedKind)) return cards;
  return cards.filter((card) => cardMatchesKinds(card, subtypes));
}
