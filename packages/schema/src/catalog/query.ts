// GET /cards and GET /sets query strings. The api validates against these schemas; the client
// types its parameters from their input side.

import { z } from "zod";
import { cardCategorySchema } from "./card";

/** A query-string field that must be non-empty when present. */
const param = z.string().min(1);

/** A field that may repeat (`?type=Fire&type=Water`), OR-ed within its dimension. hono's query
    validator hands a repeated key to zod as an array and a single occurrence as a string; both
    normalize to a non-empty string[]. */
const multiParam = z
  .union([param, z.array(param).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/** Cap on repeatable `id` values. A deck holds at most 60 unique cards, so 100 leaves headroom for
    deck hydration while bounding the query string and the id scan. */
export const MAX_ID_VALUES = 100;

/**
 * GET /cards query params. Numbers arrive as strings, hence `z.coerce`, typed `<number>` so the
 * input side stays `number` for the client; unknown params are stripped; empty values 400.
 */
export const cardsQuerySchema = z.object({
  /** Exact card id(s) for batched deck hydration, e.g. "sv06.5-001" (repeatable, at most
      MAX_ID_VALUES; unknown ids are omitted). Composes with every other filter. */
  id: multiParam.pipe(z.array(param).max(MAX_ID_VALUES)).optional(),
  /** Case-insensitive substring of the card name. */
  name: param.optional(),
  /** Case-insensitive whole-name equality: the import flow's exact-card lookup. */
  nameExact: param.optional(),
  category: cardCategorySchema.optional(),
  /** Energy type(s) the card must have one of, e.g. "Water" (repeatable). */
  type: multiParam.optional(),
  /** Exact rarity string(s), e.g. "Double rare" (repeatable). */
  rarity: multiParam.optional(),
  /** Pokémon stage(s), e.g. "Basic" (repeatable, vocabulary: GET /facets). */
  stage: multiParam.optional(),
  /** Printed rule-box marker(s), e.g. "ex" / "VMAX" (repeatable, vocabulary: GET /facets
      `suffixes`). Only Pokémon rows carry one, so it needs no category guard. */
  suffix: multiParam.optional(),
  /** Trainer subtype(s), e.g. "Item" (repeatable, vocabulary: GET /facets). */
  trainerType: multiParam.optional(),
  /** Energy subtype(s): "Normal" / "Special" (repeatable). */
  energyType: multiParam.optional(),
  /** Set id, e.g. "sv06.5". */
  set: param.optional(),
  /** Serie id, e.g. "sv": cards whose set belongs to the serie. */
  serie: param.optional(),
  /** Exact illustrator, case-sensitive (vocabulary: GET /facets). */
  illustrator: param.optional(),
  /**
   * Case-insensitive substring over rules text: ability and attack names and effects, plus Trainer
   * and Special Energy effect text. The ability and attack halves match inside stored JSON, so a
   * term can hit a key name.
   */
  text: param.optional(),
  /** Exact regulation mark, e.g. "H". */
  regulationMark: param.optional(),
  /**
   * Inclusive HP bounds, Pokémon only; some Trainers store a printed HP, so the bound checks the
   * category.
   */
  hpMin: z.coerce.number<number>().int().min(0).optional(),
  hpMax: z.coerce.number<number>().int().min(0).optional(),
  /** Keep only cards currently legal in the given format. */
  legal: z.enum(["standard", "expanded"]).optional(),
  /** Result order; "set" is collector order. */
  sort: z.enum(["name", "hp-desc", "set"]).default("set"),
  /** 1-based page. */
  page: z.coerce.number<number>().int().min(1).default(1),
  pageSize: z.coerce.number<number>().int().min(1).max(100).default(50),
});
export type CardsQuery = z.infer<typeof cardsQuerySchema>;
/** What a caller may send: every field optional, a repeatable one as a string or string[]. */
export type CardsQueryParams = z.input<typeof cardsQuerySchema>;

/** GET /cards/full query params: the ids whose full Cards to return (repeatable, 1 to
    MAX_ID_VALUES). Unknown ids are omitted from the response. */
export const fullCardsQuerySchema = z.object({
  id: multiParam.pipe(z.array(param).max(MAX_ID_VALUES)),
});
export type FullCardsQuery = z.infer<typeof fullCardsQuerySchema>;

/** GET /sets query params. */
export const setsQuerySchema = z.object({
  /** Serie id, e.g. "sv". */
  serie: param.optional(),
});
export type SetsQuery = z.infer<typeof setsQuerySchema>;
