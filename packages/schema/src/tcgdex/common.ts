// Shared building blocks for the tcgdex.dev REST models (v2, English).
//
// Everything here is authored against LIVE responses from
// https://api.tcgdex.net/v2/en/... (committed verbatim in ./__fixtures__) and
// verified by scripts/validate-live.ts. Objects use Zod's default mode (strip
// unknown keys) so additive upstream changes never break us; fields are
// optional/nullable exactly where live payloads omit or null them.
//
// All three "brief" shapes live here (rather than next to their full models)
// to keep card.ts / set.ts / serie.ts free of circular imports: a full Card
// embeds a SetBrief, a full Set embeds a SerieBrief and CardBriefs, and a full
// Serie embeds SetBriefs.

import { z } from "zod";

/**
 * tcgdex `updated` timestamps mix UTC (`2026-06-08T12:42:35Z`, with or
 * without milliseconds) and zoned (`2026-07-01T21:27:44+01:00`) forms.
 */
export const tcgdexTimestampSchema = z.iso.datetime({ offset: true });

/** Format legality flags, present on full cards and full sets. */
export const tcgdexLegalSchema = z.object({
  standard: z.boolean(),
  expanded: z.boolean(),
});
export type TcgdexLegal = z.infer<typeof tcgdexLegalSchema>;

/** The two counts every set brief carries. */
export const tcgdexCardCountBriefSchema = z.object({
  total: z.number().int(),
  official: z.number().int(),
});
export type TcgdexCardCountBrief = z.infer<typeof tcgdexCardCountBriefSchema>;

/** Full sets add per-variant counts (live data includes `normal`, undocumented upstream). */
export const tcgdexCardCountSchema = tcgdexCardCountBriefSchema.extend({
  normal: z.number().int().optional(),
  reverse: z.number().int().optional(),
  holo: z.number().int().optional(),
  firstEd: z.number().int().optional(),
});
export type TcgdexCardCount = z.infer<typeof tcgdexCardCountSchema>;

/**
 * Booster product reference. Documented by tcgdex on cards and sets but not
 * observed on any live `en` payload yet (probed sv01–sv10.5b, me01, swsh3);
 * kept optional-everywhere so it starts parsing the day it ships.
 */
export const tcgdexBoosterSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
  artwork_front: z.string().optional(),
  artwork_back: z.string().optional(),
});
export type TcgdexBooster = z.infer<typeof tcgdexBoosterSchema>;

/** List/resume shape of a card (`/cards`, `set.cards[]`). `image` is a base URL without extension. */
export const tcgdexCardBriefSchema = z.object({
  id: z.string(),
  localId: z.string(),
  name: z.string(),
  image: z.string().optional(),
});
export type TcgdexCardBrief = z.infer<typeof tcgdexCardBriefSchema>;

/**
 * List/embedded shape of a set (`/sets`, `card.set`, `serie.sets[]`).
 * `logo`/`symbol` are asset base URLs without extension; both are missing on
 * logo-less sets such as `sve` (Scarlet & Violet Energy).
 */
export const tcgdexSetBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
  symbol: z.string().optional(),
  cardCount: tcgdexCardCountBriefSchema,
});
export type TcgdexSetBrief = z.infer<typeof tcgdexSetBriefSchema>;

/**
 * List/embedded shape of a serie (`/series`, `set.serie`). The `/series` list
 * includes `logo` for most entries (missing on e.g. `misc`); the embedded
 * `set.serie` form is just `{id, name}`.
 */
export const tcgdexSerieBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
});
export type TcgdexSerieBrief = z.infer<typeof tcgdexSerieBriefSchema>;
