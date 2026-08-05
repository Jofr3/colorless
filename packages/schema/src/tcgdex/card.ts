// Full card model of the tcgdex REST API (`/cards/{id}`).
//
// MODELING CHOICE — discriminated union on `category`, not one bag of
// optionals: every live payload carries exactly one of "Pokemon" | "Trainer" |
// "Energy", and the category-specific fields never bleed across branches
// (`hp`/`attacks` only on Pokemon, `trainerType` only on Trainer,
// `energyType` only on Energy). The union therefore parses every real payload
// while rejecting chimeras (a Trainer with `attacks`, a mangled category) and
// gives consumers narrowing via `card.category` for free. Within a branch we
// stay liberal: promos and old sets omit almost everything (sve-002 has no
// image/illustrator, dp5-4 has `item: {}`), so branch extras are optional.

import { z } from "zod";
import {
  tcgdexBoosterSchema,
  tcgdexLegalSchema,
  tcgdexSetBriefSchema,
  tcgdexTimestampSchema,
} from "./common";
import { tcgdexPricingSchema, tcgdexVariantDetailedSchema, tcgdexVariantsSchema } from "./pricing";

/** An attack. `damage` is a number OR a string ("60+", "20×") on modifier attacks. */
export const tcgdexAttackSchema = z.object({
  cost: z.array(z.string()).optional(),
  name: z.string(),
  effect: z.string().optional(),
  damage: z.union([z.number(), z.string()]).optional(),
});
export type TcgdexAttack = z.infer<typeof tcgdexAttackSchema>;

/** A weakness or resistance. `value` is a modifier string: "×2", "+20", "-30". */
export const tcgdexWeakResSchema = z.object({
  type: z.string(),
  value: z.string().optional(),
});
export type TcgdexWeakRes = z.infer<typeof tcgdexWeakResSchema>;

/** An ability block (`type` is "Ability", or era labels like "Poke-POWER"). */
export const tcgdexAbilitySchema = z.object({
  type: z.string().optional(),
  name: z.string(),
  effect: z.string().optional(),
});
export type TcgdexAbility = z.infer<typeof tcgdexAbilitySchema>;

/** dp/neo-era held item. Live data serves `item: {}` on some cards (dp5-4). */
export const tcgdexItemSchema = z.object({
  name: z.string().optional(),
  effect: z.string().optional(),
});
export type TcgdexItem = z.infer<typeof tcgdexItemSchema>;

// Fields shared by all three categories. `image` is a base URL without
// quality/extension (append e.g. `/high.webp`); missing on cards without
// scans. `updated` mixes `Z` and `+HH:MM` offsets across cards.
const tcgdexCardBaseShape = {
  id: z.string(),
  localId: z.string(),
  name: z.string(),
  image: z.string().optional(),
  illustrator: z.string().optional(),
  rarity: z.string().optional(),
  set: tcgdexSetBriefSchema,
  variants: tcgdexVariantsSchema.optional(),
  variants_detailed: z.array(tcgdexVariantDetailedSchema).optional(),
  boosters: z.array(tcgdexBoosterSchema).optional(),
  pricing: tcgdexPricingSchema.optional(),
  regulationMark: z.string().optional(),
  legal: tcgdexLegalSchema.optional(),
  updated: tcgdexTimestampSchema.optional(),
} satisfies z.ZodRawShape;

export const tcgdexPokemonCardSchema = z.object({
  ...tcgdexCardBaseShape,
  category: z.literal("Pokemon"),
  dexId: z.array(z.number()).optional(),
  hp: z.number().optional(),
  types: z.array(z.string()).optional(),
  evolveFrom: z.string().optional(),
  description: z.string().optional(),
  // Old "LV.X"-style cards make level a string; numbers elsewhere.
  level: z.union([z.number(), z.string()]).optional(),
  stage: z.string().optional(),
  suffix: z.string().optional(),
  item: tcgdexItemSchema.optional(),
  abilities: z.array(tcgdexAbilitySchema).optional(),
  attacks: z.array(tcgdexAttackSchema).optional(),
  weaknesses: z.array(tcgdexWeakResSchema).optional(),
  resistances: z.array(tcgdexWeakResSchema).optional(),
  retreat: z.number().optional(),
});
export type TcgdexPokemonCard = z.infer<typeof tcgdexPokemonCardSchema>;

export const tcgdexTrainerCardSchema = z.object({
  ...tcgdexCardBaseShape,
  category: z.literal("Trainer"),
  effect: z.string().optional(),
  trainerType: z.string().optional(),
});
export type TcgdexTrainerCard = z.infer<typeof tcgdexTrainerCardSchema>;

export const tcgdexEnergyCardSchema = z.object({
  ...tcgdexCardBaseShape,
  category: z.literal("Energy"),
  // Basic energies have no rules text; `energyType` is "Normal" | "Special".
  effect: z.string().optional(),
  energyType: z.string().optional(),
});
export type TcgdexEnergyCard = z.infer<typeof tcgdexEnergyCardSchema>;

/** Full card (`/cards/{id}`, `/sets/{setId}/{localId}`). */
export const tcgdexCardSchema = z.discriminatedUnion("category", [
  tcgdexPokemonCardSchema,
  tcgdexTrainerCardSchema,
  tcgdexEnergyCardSchema,
]);
export type TcgdexCard = z.infer<typeof tcgdexCardSchema>;
