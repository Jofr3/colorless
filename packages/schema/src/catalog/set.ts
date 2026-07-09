// Canonical domain Set. `logo`/`symbol` are OUR asset base path
// `/assets/sets/{id}` (or null when the set has no such asset — e.g. `sve`
// has neither): clients append `/logo.{ext}` or `/symbol.{ext}` with
// ext ∈ png|webp, served by the Worker's GET /assets/sets/:id/:file route.
// Both fields carry the same base path — each is null-gated by its own
// origin column, so a symbol-only set gets `logo: null`.

import { z } from "zod";
import { cardBriefSchema } from "./card";
import { cardCountSchema, legalSchema } from "./common";

/** List projection of a set — what GET /sets and `serie.sets` serve. */
export const setBriefSchema = z.object({
  id: z.string(),
  serieId: z.string(),
  name: z.string(),
  /** OUR asset base path `/assets/sets/{id}` (append `/logo.{ext}`), or null. */
  logo: z.string().nullable(),
  /** OUR asset base path `/assets/sets/{id}` (append `/symbol.{ext}`), or null. */
  symbol: z.string().nullable(),
  /** "YYYY-MM-DD". */
  releaseDate: z.iso.date(),
  cardCount: cardCountSchema,
});
export type SetBrief = z.infer<typeof setBriefSchema>;

/** Full set — the brief plus legality and the PTCGO code. */
export const setSchema = setBriefSchema.extend({
  legal: legalSchema,
  /** PTCGO set code (e.g. "DAA"); only PTCGO-era sets have one. */
  tcgOnline: z.string().nullable(),
});
export type Set = z.infer<typeof setSchema>;

/** GET /sets/:id response — the full set with its card briefs. */
export const setWithCardsSchema = setSchema.extend({
  cards: z.array(cardBriefSchema),
});
export type SetWithCards = z.infer<typeof setWithCardsSchema>;
