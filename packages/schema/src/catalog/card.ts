// The canonical domain Card (D5 — docs/workstreams/backend-data.md §5.2).
//
// MODELING CHOICE — one flat object, not the tcgdex discriminated union: the
// D1 rows (§5.3) already flatten the three categories into one table where
// every category-specific column is NULL off-category, and the read API
// serves that reality verbatim. Consumers still narrow on `category`; a flat
// shape just spares them a union round-trip for fields that are `null`
// either way. Nullability mirrors the DB exactly: TEXT/INTEGER nullable
// columns → `.nullable()`, NOT NULL columns → required.
//
// ASSET CONVENTION — `image` is OUR asset base path, `/assets/cards/{id}`
// (or null when the card has no scan). Clients append `/{quality}.{ext}`
// with quality ∈ high|low and ext ∈ webp|png|jpg — the same suffix rule as
// tcgdex origin URLs (§4.4) — and the Worker's GET /assets/cards/:id/:file
// route mirrors + serves the bytes. tcgdex origin URLs never leave the API.

import { z } from "zod";
import { legalSchema } from "./common";

export const cardCategorySchema = z.enum(["Pokemon", "Trainer", "Energy"]);
export type CardCategory = z.infer<typeof cardCategorySchema>;

// The nested blocks persist as JSON columns typed with the tcgdex shapes, so
// these domain twins are structurally identical to their Tcgdex* namesakes —
// stored JSON round-trips through them unchanged.

/** An attack. `damage` is a number OR a modifier string ("60+", "20×"). */
export const attackSchema = z.object({
  cost: z.array(z.string()).optional(),
  name: z.string(),
  effect: z.string().optional(),
  damage: z.union([z.number(), z.string()]).optional(),
});
export type Attack = z.infer<typeof attackSchema>;

/** An ability block (`type` is "Ability", or era labels like "Poke-POWER"). */
export const abilitySchema = z.object({
  type: z.string().optional(),
  name: z.string(),
  effect: z.string().optional(),
});
export type Ability = z.infer<typeof abilitySchema>;

/** A weakness or resistance. `value` is a modifier string: "×2", "+20", "-30". */
export const weakResSchema = z.object({
  type: z.string(),
  value: z.string().optional(),
});
export type WeakRes = z.infer<typeof weakResSchema>;

/** Which print runs a card exists in. */
export const variantsSchema = z.object({
  normal: z.boolean().optional(),
  reverse: z.boolean().optional(),
  holo: z.boolean().optional(),
  firstEdition: z.boolean().optional(),
  wPromo: z.boolean().optional(),
});
export type Variants = z.infer<typeof variantsSchema>;

/** List/search projection of a card — what GET /cards and `set.cards` serve. */
export const cardBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: cardCategorySchema,
  rarity: z.string().nullable(),
  /** OUR asset base path `/assets/cards/{id}` (append `/{quality}.{ext}`), or null. */
  image: z.string().nullable(),
  setId: z.string(),
  localId: z.string(),
});
export type CardBrief = z.infer<typeof cardBriefSchema>;

/** The one canonical Card (D5) — everything the catalog persists for a card. */
export const cardSchema = z.object({
  /** tcgdex id, e.g. "sv06.5-001" — our canonical card id. */
  id: z.string(),
  setId: z.string(),
  localId: z.string(),
  name: z.string(),
  category: cardCategorySchema,
  /** OUR asset base path `/assets/cards/{id}` (append `/{quality}.{ext}`), or null. */
  image: z.string().nullable(),
  illustrator: z.string().nullable(),
  rarity: z.string().nullable(),
  regulationMark: z.string().nullable(),

  // Pokémon-only (null on Trainer/Energy).
  hp: z.number().int().nullable(),
  stage: z.string().nullable(),
  evolveFrom: z.string().nullable(),
  /** Energy types, e.g. ["Grass"]. */
  types: z.array(z.string()).nullable(),
  retreat: z.number().int().nullable(),
  abilities: z.array(abilitySchema).nullable(),
  attacks: z.array(attackSchema).nullable(),
  weaknesses: z.array(weakResSchema).nullable(),
  resistances: z.array(weakResSchema).nullable(),

  // Trainer/Energy-only.
  trainerType: z.string().nullable(),
  energyType: z.string().nullable(),
  /** Trainer/Energy rules text (null on basic energies and all Pokémon). */
  effect: z.string().nullable(),

  legal: legalSchema,
  variants: variantsSchema.nullable(),
});
export type Card = z.infer<typeof cardSchema>;
