// Full serie model of the tcgdex REST API (`/series/{id}`).

import * as z from "zod";
import { tcgdexIdSchema, tcgdexSetBriefSchema } from "./common";

/**
 * Full serie. Live data adds `releaseDate` and `firstSet`/`lastSet` set
 * briefs on top of the documented `{id, name, logo?, sets}`.
 */
export const tcgdexSerieSchema = z.object({
  id: tcgdexIdSchema,
  name: z.string(),
  logo: z.string().optional(),
  releaseDate: z.iso.date().optional(),
  firstSet: tcgdexSetBriefSchema.optional(),
  lastSet: tcgdexSetBriefSchema.optional(),
  sets: z.array(tcgdexSetBriefSchema),
});
export type TcgdexSerie = z.infer<typeof tcgdexSerieSchema>;
