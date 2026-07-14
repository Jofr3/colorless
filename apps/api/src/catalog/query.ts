// GET /cards (and /sets) query vocabulary: zod schemas for the query strings
// (validated in routes.ts via @hono/zod-validator) and the Drizzle `where`
// builder. Pure — no Worker types — so filters unit-test as plain functions.

import { cardCategorySchema } from "@luminous/schema";
import { and, asc, desc, eq, gte, inArray, like, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { cards } from "../db/schema";

/** A query-string field that must be non-empty when present. */
const param = z.string().min(1);

/** A field that may repeat (`?type=Fire&type=Water`), OR-ed within its
    dimension. hono's query validator hands a repeated key to zod as an
    array and a single occurrence as a string; both normalize to a
    non-empty string[] here. */
const multiParam = z
  .union([param, z.array(param).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/**
 * GET /cards query params. Numbers arrive as strings, hence `z.coerce`;
 * unknown params are ignored (zod objects strip); empty values 400.
 */
export const cardsQuerySchema = z.object({
  /** Case-insensitive substring of the card name. */
  name: param.optional(),
  category: cardCategorySchema.optional(),
  /** Energy type(s) the card must have one of, e.g. "Water" (repeatable). */
  type: multiParam.optional(),
  /** Exact rarity string(s), e.g. "Double rare" (repeatable). */
  rarity: multiParam.optional(),
  /** Set id, e.g. "sv06.5". */
  set: param.optional(),
  /** Exact regulation mark, e.g. "H". */
  regulationMark: param.optional(),
  /** Inclusive HP bounds (Pokémon only — non-Pokémon have NULL hp and never match). */
  hpMin: z.coerce.number().int().min(0).optional(),
  hpMax: z.coerce.number().int().min(0).optional(),
  /** Keep only cards currently legal in the given format. */
  legal: z.enum(["standard", "expanded"]).optional(),
  /** Result order; "set" is collector order, the historical default. */
  sort: z.enum(["name", "hp-desc", "set"]).default("set"),
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
 * - repeated `type` / `rarity` values OR within their dimension (a card
 *   matches if it has ANY selected type / rarity); dimensions still AND.
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
    const anyType = or(...query.type.map((t) => like(cards.typesJson, `%"${t}"%`)));
    if (anyType !== undefined) conditions.push(anyType);
  }
  if (query.rarity !== undefined) {
    conditions.push(inArray(cards.rarity, query.rarity));
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
 * Deterministic collector order: (set_id, local_id), both text. Good enough
 * on purpose — SV-era local ids are zero-padded ("001"), so the
 * lexicographic sort matches collector order; a release-date join can
 * replace set_id if cross-set chronology ever matters (docs §6).
 */
const collectorOrder = [asc(cards.setId), asc(cards.localId)];

/**
 * The ORDER BY for a validated /cards query. Every sort ends on collector
 * order so pages stay deterministic across equal keys. `hp-desc` relies on
 * SQLite treating NULL as smaller than every value — `hp DESC` puts the
 * hp-less Trainers/Energy last (verified against SQLite directly).
 */
export function cardsOrder(sort: CardsQuery["sort"]): SQL[] {
  if (sort === "name") return [asc(cards.name), ...collectorOrder];
  if (sort === "hp-desc") return [desc(cards.hp), ...collectorOrder];
  return collectorOrder;
}
