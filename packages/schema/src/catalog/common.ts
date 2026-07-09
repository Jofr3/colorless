// Shared building blocks of the canonical catalog vocabulary (see ./index.ts
// for the module contract). Both live here because cards and sets each carry
// a `legal` block, and set briefs carry the two-count `cardCount`.

import { z } from "zod";

/** Format legality. The DB stores both flags NOT NULL (ingest maps a missing
    upstream block to false/false), so neither side is ever null here. */
export const legalSchema = z.object({
  standard: z.boolean(),
  expanded: z.boolean(),
});
export type Legal = z.infer<typeof legalSchema>;

/** Set size: `total` includes secret rares, `official` is the printed count. */
export const cardCountSchema = z.object({
  total: z.number().int(),
  official: z.number().int(),
});
export type CardCount = z.infer<typeof cardCountSchema>;
