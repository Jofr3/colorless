// The catalog's filter vocabularies (P2 task 10) — what GET /facets serves,
// so the web's filter selects reflect what is actually ingested instead of
// hardcoded constants.

import { z } from "zod";

/** One facet: the distinct non-null values present in the catalog, sorted
    ascending. Plain strings on purpose — the vocabulary IS the data. */
const facetSchema = z.array(z.string());

/** GET /facets — every filterable vocabulary the cards table contains.
    `types` is flattened from the per-card energy-type arrays; every list
    excludes NULLs (a facet never offers "no value" as an option). */
export const catalogFacetsSchema = z.object({
  rarities: facetSchema,
  types: facetSchema,
  stages: facetSchema,
  trainerTypes: facetSchema,
  energyTypes: facetSchema,
  illustrators: facetSchema,
  regulationMarks: facetSchema,
  /** Printed rule-box markers — tcgdex's Pokémon `suffix` ("ex", "V",
      "VMAX", "VSTAR", "MEGA", …), the vocabulary behind `?suffix=`.
      EMPTY UNTIL AN INGEST FILLS `cards.suffix` (D197 added the column; no
      run has populated it), and that is the designed degradation rather than
      an oversight: a facet list renders one chip per value, so an empty list
      renders no chip and the filter is simply unreachable. It is the reason
      the filter could land at all — the alternative was a chip that returned
      an empty page for every value with no signal why. */
  suffixes: facetSchema,
});
export type CatalogFacets = z.infer<typeof catalogFacetsSchema>;
