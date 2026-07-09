// GET /cards (and /sets) query vocabulary: zod schemas for the query strings
// (validated in routes.ts via @hono/zod-validator) and the Drizzle `where`
// builder. Pure — no Worker types — so filters unit-test as plain functions.

import { cardCategorySchema } from "@luminous/schema";
import { and, asc, eq, gte, like, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { cards } from "../db/schema";

/** A query-string field that must be non-empty when present. */
const param = z.string().min(1);

/**
 * GET /cards query params. Numbers arrive as strings, hence `z.coerce`;
 * unknown params are ignored (zod objects strip); empty values 400.
 */
export const cardsQuerySchema = z.object({
  /** Case-insensitive substring of the card name. */
  name: param.optional(),
  category: cardCategorySchema.optional(),
  /** One energy type the card must have, e.g. "Water". */
  type: param.optional(),
  /** Exact rarity string, e.g. "Double Rare". */
  rarity: param.optional(),
  /** Set id, e.g. "sv06.5". */
  set: param.optional(),
  /** Exact regulation mark, e.g. "H". */
  regulationMark: param.optional(),
  /** Inclusive HP bounds (Pokémon only — non-Pokémon have NULL hp and never match). */
  hpMin: z.coerce.number().int().min(0).optional(),
  hpMax: z.coerce.number().int().min(0).optional(),
  /** Keep only cards currently legal in the given format. */
  legal: z.enum(["standard", "expanded"]).optional(),
  /** 1-based page. */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type CardsQuery = z.infer<typeof cardsQuerySchema>;

/** GET /sets query params. */
export const setsQuerySchema = z.object({
  /** Serie id, e.g. "sv". */
  serie: param.optional(),
});
export type SetsQuery = z.infer<typeof setsQuerySchema>;

/**
 * The Drizzle `where` for a validated /cards query; undefined = unfiltered.
 *
 * Tradeoffs, on purpose:
 * - `name` uses LIKE '%…%', which in SQLite is already case-insensitive for
 *   ASCII. `%`/`_` in the input act as extra wildcards — harmless in a
 *   read-only, parameterized catalog search, so they are not escaped.
 * - `type` LIKEs for the quoted value inside the raw `types_json` text
 *   (e.g. '%"Water"%') instead of a json_each() join. Exact enough because
 *   no energy type is a substring of another *quoted* type; revisit if the
 *   vocabulary ever grows an overlapping name.
 */
export function buildCardsWhere(query: CardsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.name !== undefined) {
    conditions.push(like(cards.name, `%${query.name}%`));
  }
  if (query.category !== undefined) {
    conditions.push(eq(cards.category, query.category));
  }
  if (query.type !== undefined) {
    conditions.push(like(cards.typesJson, `%"${query.type}"%`));
  }
  if (query.rarity !== undefined) {
    conditions.push(eq(cards.rarity, query.rarity));
  }
  if (query.set !== undefined) {
    conditions.push(eq(cards.setId, query.set));
  }
  if (query.regulationMark !== undefined) {
    conditions.push(eq(cards.regulationMark, query.regulationMark));
  }
  if (query.hpMin !== undefined) {
    conditions.push(gte(cards.hp, query.hpMin));
  }
  if (query.hpMax !== undefined) {
    conditions.push(lte(cards.hp, query.hpMax));
  }
  if (query.legal === "standard") {
    conditions.push(eq(cards.legalStandard, true));
  } else if (query.legal === "expanded") {
    conditions.push(eq(cards.legalExpanded, true));
  }
  return and(...conditions);
}

/**
 * Deterministic /cards order: (set_id, local_id), both text. Good enough on
 * purpose — SV-era local ids are zero-padded ("001"), so the lexicographic
 * sort matches collector order; a release-date join can replace set_id if
 * cross-set chronology ever matters (docs §6).
 */
export const cardsOrder = [asc(cards.setId), asc(cards.localId)];
