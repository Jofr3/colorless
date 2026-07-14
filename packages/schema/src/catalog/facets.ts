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
});
export type CatalogFacets = z.infer<typeof catalogFacetsSchema>;
