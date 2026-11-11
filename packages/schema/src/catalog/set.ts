// Canonical domain set brief. No client shows a set's logo or symbol, so the API serves no set
// art and both fields are null; D1 keeps the origin URLs.

import * as z from "zod";
import { cardCountSchema } from "./common";

/** List projection of a set — what GET /sets and `serie.sets` serve. */
export const setBriefSchema = z.object({
  id: z.string(),
  serieId: z.string(),
  name: z.string(),
  logo: z.null(),
  symbol: z.null(),
  /** "YYYY-MM-DD". */
  releaseDate: z.iso.date(),
  cardCount: cardCountSchema,
  /** The official set abbreviation decklists print (e.g. "PRE"), or null. */
  abbreviation: z.string().nullable(),
});
export type SetBrief = z.infer<typeof setBriefSchema>;
