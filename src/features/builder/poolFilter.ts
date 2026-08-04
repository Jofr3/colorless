// The builder's filter state. EVERY dimension (name / category / energy type /
// kind / rule box / rarity / set / serie / illustrator / regulation mark / HP /
// rules text / legality / sort) is filtered server-side by GET /cards —
// catalog.ts translates Filters into that query and useCardSearch pages it in.
// This module is now just the Filters model the rail edits.
//
// It used to carry one client-side remainder, `filterVisibleCards`, for kind
// selections containing a DERIVED kind (EX/Mega, matched by name regex).
// D198 deleted it: `?suffix=` answers those server-side, so nothing thins a
// page after the server has counted it — which is what made a mixed selection
// render a nearly-empty page under a total in the hundreds. The one honest
// invariant is back: what the grid shows and what `total` counts are the same
// query.

import type { EnergyType, Supertype } from "./cards";

export type SortKey = "name" | "hp-desc" | "set";

export interface Filters {
  /** Free-text name search (server-side, debounced substring match). */
  query: string;
  /** "all" or one supertype. */
  supertype: "all" | Supertype;
  /** Selected energy types; empty means no type restriction. */
  types: EnergyType[];
  /** Selected card-kind labels, builder dialect (Basic / Stage 1 / Item / …),
      contextual per supertype; empty = all. */
  subtypes: string[];
  /** Selected printed rule-box markers — exact catalog strings from GET
      /facets `suffixes` ("ex", "V", "VMAX", …); empty = all. Its OWN
      dimension, not extra `subtypes` chips, because the server ANDs across
      dimensions and ORs within one: "Basic" + "ex" must mean "a Basic that is
      an ex", which is what two dimensions say and what one dimension could
      not. Empty in production until an ingest fills `cards.suffix`, and then
      the rail renders no section at all. */
  suffixes: string[];
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
  suffixes: [],
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
    filters.suffixes.length > 0 ||
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
