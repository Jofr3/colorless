// Pricing + variant blocks of a full tcgdex card. Shapes taken from live
// payloads (see __fixtures__): both markets can be `null` (e.g. tcgplayer on
// sve-002), every aggregate can be `null` on thinly-traded cards, and the
// tcgplayer block keys its per-print prices by dynamic variant names
// ("normal", "holofoil", "reverse-holofoil", ...), hence the catchall.

import { z } from "zod";
import { tcgdexTimestampSchema } from "./common";

/** Cardmarket aggregates are EUR numbers, `null` when there is no data (holo-only cards etc.). */
const cardmarketPrice = z.number().nullable().optional();

export const tcgdexCardmarketPricingSchema = z.object({
  updated: tcgdexTimestampSchema,
  unit: z.string(),
  idProduct: z.number().optional(),
  avg: cardmarketPrice,
  low: cardmarketPrice,
  trend: cardmarketPrice,
  avg1: cardmarketPrice,
  avg7: cardmarketPrice,
  avg30: cardmarketPrice,
  "avg-holo": cardmarketPrice,
  "low-holo": cardmarketPrice,
  "trend-holo": cardmarketPrice,
  "avg1-holo": cardmarketPrice,
  "avg7-holo": cardmarketPrice,
  "avg30-holo": cardmarketPrice,
});
export type TcgdexCardmarketPricing = z.infer<typeof tcgdexCardmarketPricingSchema>;

/** One tcgplayer print run ("normal", "holofoil", "reverse-holofoil", ...). */
export const tcgdexTcgplayerVariantPricingSchema = z.object({
  productId: z.number().optional(),
  lowPrice: z.number().nullable().optional(),
  midPrice: z.number().nullable().optional(),
  highPrice: z.number().nullable().optional(),
  marketPrice: z.number().nullable().optional(),
  directLowPrice: z.number().nullable().optional(),
});
export type TcgdexTcgplayerVariantPricing = z.infer<typeof tcgdexTcgplayerVariantPricingSchema>;

/**
 * `unit`/`updated` plus one key per print run — the run names are dynamic, so
 * unknown keys are validated (not stripped) as variant pricing objects.
 */
export const tcgdexTcgplayerPricingSchema = z
  .object({
    updated: tcgdexTimestampSchema,
    unit: z.string(),
  })
  .catchall(tcgdexTcgplayerVariantPricingSchema);
export type TcgdexTcgplayerPricing = z.infer<typeof tcgdexTcgplayerPricingSchema>;

/** Card-level pricing block; either market can be absent or explicitly `null`. */
export const tcgdexPricingSchema = z.object({
  cardmarket: tcgdexCardmarketPricingSchema.nullable().optional(),
  tcgplayer: tcgdexTcgplayerPricingSchema.nullable().optional(),
});
export type TcgdexPricing = z.infer<typeof tcgdexPricingSchema>;

/** Which print runs a card exists in. */
export const tcgdexVariantsSchema = z.object({
  normal: z.boolean().optional(),
  reverse: z.boolean().optional(),
  holo: z.boolean().optional(),
  firstEdition: z.boolean().optional(),
  wPromo: z.boolean().optional(),
});
export type TcgdexVariants = z.infer<typeof tcgdexVariantsSchema>;

/**
 * `variants_detailed[]` — undocumented in older references but live on most
 * cards: one entry per physical print, with optional stamps ("player-rewards-
 * program"), foil style ("cosmos", "pokeball") and per-print pricing.
 */
export const tcgdexVariantDetailedSchema = z.object({
  type: z.string(),
  size: z.string().optional(),
  variantId: z.string().optional(),
  foil: z.string().optional(),
  stamp: z.array(z.string()).optional(),
  pricing: tcgdexPricingSchema.optional(),
});
export type TcgdexVariantDetailed = z.infer<typeof tcgdexVariantDetailedSchema>;
