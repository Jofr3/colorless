// Full set model of the tcgdex REST API (`/sets/{id}`).

import { z } from "zod";
import {
  tcgdexBoosterSchema,
  tcgdexCardBriefSchema,
  tcgdexCardCountSchema,
  tcgdexLegalSchema,
  tcgdexSerieBriefSchema,
} from "./common";

/** Set abbreviation block, e.g. `{ "official": "SVI" }`. */
export const tcgdexSetAbbreviationSchema = z.object({
  official: z.string(),
  localized: z.string().optional(),
});
export type TcgdexSetAbbreviation = z.infer<typeof tcgdexSetAbbreviationSchema>;

/**
 * Full set. `releaseDate` is a plain `YYYY-MM-DD` date; `tcgOnline` only
 * exists for PTCGO-era sets (e.g. swsh3 → "DAA"); `boosters` is documented
 * upstream but not observed live yet.
 */
export const tcgdexSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
  symbol: z.string().optional(),
  serie: tcgdexSerieBriefSchema,
  cardCount: tcgdexCardCountSchema,
  releaseDate: z.iso.date(),
  legal: tcgdexLegalSchema,
  abbreviation: tcgdexSetAbbreviationSchema.optional(),
  tcgOnline: z.string().optional(),
  boosters: z.array(tcgdexBoosterSchema).optional(),
  cards: z.array(tcgdexCardBriefSchema),
});
export type TcgdexSet = z.infer<typeof tcgdexSetSchema>;
