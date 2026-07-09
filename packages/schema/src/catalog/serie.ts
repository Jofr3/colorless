// Canonical domain Serie. Deliberately NO `logo` field: the DB keeps
// `series.logo_url`, but there is no /assets/series/* mirror route yet, so a
// domain path would 404 — add both together when a feature needs serie logos.

import { z } from "zod";
import { setBriefSchema } from "./set";

export const serieBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "YYYY-MM-DD"; null for series tcgdex doesn't date. */
  releaseDate: z.iso.date().nullable(),
});
export type SerieBrief = z.infer<typeof serieBriefSchema>;

/** Full serie — the brief plus its set briefs (what GET /series serves). */
export const serieSchema = serieBriefSchema.extend({
  sets: z.array(setBriefSchema),
});
export type Serie = z.infer<typeof serieSchema>;
