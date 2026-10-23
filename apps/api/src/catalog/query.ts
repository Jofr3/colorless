// GET /cards (and /sets) query vocabulary: zod schemas for the query strings
// (validated in routes.ts via @hono/zod-validator) and the Drizzle `where`
// builder. Pure — no Worker types — so filters unit-test as plain functions.

import { cardCategorySchema } from "@colorless/schema";
import {
  and,
  type AnyColumn,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { cards, sets } from "../db/schema";

/** A query-string field that must be non-empty when present. */
const param = z.string().min(1);

/** A field that may repeat (`?type=Fire&type=Water`), OR-ed within its
    dimension. hono's query validator hands a repeated key to zod as an
    array and a single occurrence as a string; both normalize to a
    non-empty string[] here. */
const multiParam = z
  .union([param, z.array(param).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/** Cap on repeatable `id` values. A deck holds ≤60 unique cards, so 100 is
    generous headroom for the hydration use case; excess 400s. The cap is no
    longer about D1's 100-bound-parameter limit — the id set rides in as ONE
    JSON parameter (see `buildCardsWhere`) — it just bounds the query string
    and the id scan. */
export const MAX_ID_VALUES = 100;

/**
 * GET /cards query params. Numbers arrive as strings, hence `z.coerce`;
 * unknown params are ignored (zod objects strip); empty values 400.
 */
export const cardsQuerySchema = z.object({
  /** Exact card id(s) for batched deck hydration, e.g. "sv06.5-001"
      (repeatable, ≤ MAX_ID_VALUES). Composes with every other filter. */
  id: multiParam.pipe(z.array(param).max(MAX_ID_VALUES)).optional(),
  /** Case-insensitive substring of the card name. */
  name: param.optional(),
  /** Case-insensitive WHOLE-name equality — the import flow's "find this
      exact card" lookup, distinct from the substring `name`. */
  nameExact: param.optional(),
  category: cardCategorySchema.optional(),
  /** Energy type(s) the card must have one of, e.g. "Water" (repeatable). */
  type: multiParam.optional(),
  /** Exact rarity string(s), e.g. "Double rare" (repeatable). */
  rarity: multiParam.optional(),
  /** Pokémon stage(s), e.g. "Basic" (repeatable, vocabulary: GET /facets). */
  stage: multiParam.optional(),
  /** Printed rule-box marker(s), e.g. "ex" / "VMAX" (repeatable, vocabulary:
      GET /facets `suffixes`). Pokémon-only by construction — the ingest
      writes NULL for Trainer and Energy rows (../ingest/map.ts) — so it never
      needs a category guard: `?suffix=ex&category=Trainer` is empty because
      no such row exists, not because the filter refused. */
  suffix: multiParam.optional(),
  /** Trainer subtype(s), e.g. "Item" (repeatable, vocabulary: GET /facets). */
  trainerType: multiParam.optional(),
  /** Energy subtype(s): "Normal" / "Special" (repeatable). */
  energyType: multiParam.optional(),
  /** Set id, e.g. "sv06.5". */
  set: param.optional(),
  /** Serie id, e.g. "sv" — cards whose set belongs to the serie. */
  serie: param.optional(),
  /** Exact illustrator (vocabulary: GET /facets). */
  illustrator: param.optional(),
  /**
   * Case-insensitive substring over rules text: ability and attack names and effects, plus Trainer
   * and Special Energy effect text.
   */
  text: param.optional(),
  /** Exact regulation mark, e.g. "H". */
  regulationMark: param.optional(),
  /**
   * Inclusive HP bounds, Pokémon only; some Trainers store a printed HP, so the bound checks the
   * category.
   */
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

/** A user-supplied term made safe inside a LIKE pattern: `\`, `%` and `_`
    escaped so they match literally. Pair with {@link likeEscaped}, whose
    ESCAPE clause makes `\` the escape character. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/** Drizzle's `like()` plus an `ESCAPE '\'` clause — the LIKE for patterns
    built from user input (SQLite has no default escape character). */
function likeEscaped(column: AnyColumn, pattern: string): SQL {
  return sql`${column} like ${pattern} escape '\\'`;
}

/**
 * The Drizzle `where` for a validated /cards query; undefined means unfiltered.
 * `%` and `_` in `name` are escaped. `type` matches the quoted value inside `types_json`, which
 * works because no type name is a substring of another. `text` matching over the JSON columns can
 * also hit JSON keys. `id` binds the whole list as one JSON array to stay under D1's 100-parameter
 * cap. Sentinel normalisation does not apply here: filters match stored values.
 */
export function buildCardsWhere(query: CardsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.id !== undefined) {
    conditions.push(
      sql`${cards.id} in (select "value" from json_each(${JSON.stringify(query.id)}))`,
    );
  }
  if (query.name !== undefined) {
    conditions.push(likeEscaped(cards.name, `%${escapeLike(query.name)}%`));
  }
  if (query.nameExact !== undefined) {
    // lower() = lower() rather than a wildcard-less LIKE so `%`/`_` in the
    // input can't act as wildcards — exact means exact. The same ASCII-only
    // case folding as LIKE (SQLite semantics, both sides).
    conditions.push(sql`lower(${cards.name}) = lower(${query.nameExact})`);
  }
  if (query.category !== undefined) {
    conditions.push(eq(cards.category, query.category));
  }
  if (query.type !== undefined) {
    const anyType = or(
      ...query.type.map((t) => likeEscaped(cards.typesJson, `%"${escapeLike(t)}"%`)),
    );
    if (anyType !== undefined) conditions.push(anyType);
  }
  if (query.rarity !== undefined) {
    conditions.push(inArray(cards.rarity, query.rarity));
  }
  if (query.stage !== undefined) {
    conditions.push(inArray(cards.stage, query.stage));
  }
  if (query.suffix !== undefined) {
    // Exact stored values, like every other vocabulary dimension — the chips
    // come from /facets, which serves the stored spellings verbatim, so the
    // case of "ex" vs "EX" (tcgdex prints both across eras) is DATA rather
    // than something to fold here. Folding it would also make the filter
    // disagree with its own vocabulary list, which is exactly the trap the
    // rarity sentinel note below warns about.
    conditions.push(inArray(cards.suffix, query.suffix));
  }
  if (query.trainerType !== undefined) {
    conditions.push(inArray(cards.trainerType, query.trainerType));
  }
  if (query.energyType !== undefined) {
    conditions.push(inArray(cards.energyType, query.energyType));
  }
  if (query.set !== undefined) {
    conditions.push(eq(cards.setId, query.set));
  }
  if (query.serie !== undefined) {
    // Membership subquery instead of a join so the where stays composable
    // with the page + count pair in routes.ts; a serie holds few sets.
    conditions.push(
      sql`${cards.setId} in (select ${sets.id} from ${sets} where ${sets.serieId} = ${query.serie})`,
    );
  }
  if (query.illustrator !== undefined) {
    conditions.push(eq(cards.illustrator, query.illustrator));
  }
  if (query.text !== undefined) {
    const pattern = `%${escapeLike(query.text)}%`;
    const anyText = or(
      likeEscaped(cards.abilitiesJson, pattern),
      likeEscaped(cards.attacksJson, pattern),
      likeEscaped(cards.effect, pattern),
    );
    if (anyText !== undefined) conditions.push(anyText);
  }
  if (query.regulationMark !== undefined) {
    conditions.push(eq(cards.regulationMark, query.regulationMark));
  }
  if (query.hpMin !== undefined) {
    conditions.push(gte(pokemonHp(), query.hpMin));
  }
  if (query.hpMax !== undefined) {
    conditions.push(lte(pokemonHp(), query.hpMax));
  }
  // The reprint rule's verdict where the ingest post-pass wrote it, else the
  // print's own flag (catalog/map.ts `legalOf` reads the same way).
  if (query.legal === "standard") {
    conditions.push(
      sql`COALESCE(${cards.legalStandardEffective}, ${cards.legalStandard}) = ${sql.raw("1")}`,
    );
  } else if (query.legal === "expanded") {
    conditions.push(
      sql`COALESCE(${cards.legalExpandedEffective}, ${cards.legalExpanded}) = ${sql.raw("1")}`,
    );
  }
  return and(...conditions);
}

/**
 * A card's HP as a Pokémon: `hp` on Pokémon rows, null otherwise, because some Trainers store a
 * printed HP.
 */
function pokemonHp(): SQL {
  return sql`(case when ${cards.category} = 'Pokemon' then ${cards.hp} end)`;
}

/**
 * Deterministic collector order: (set_id, local_id), both text. Good enough
 * on purpose — SV-era local ids are zero-padded ("001"), so the
 * lexicographic sort matches collector order; a release-date join can
 * replace set_id if cross-set chronology ever matters (docs §6).
 */
const collectorOrder = [asc(cards.setId), asc(cards.localId)];

/**
 * The ORDER BY for a validated /cards query. Every sort ends on collector order so pages are
 * deterministic. `hp-desc` relies on SQLite sorting NULL lowest, so non-Pokémon go last.
 */
export function cardsOrder(sort: CardsQuery["sort"]): SQL[] {
  if (sort === "name") return [asc(cards.name), ...collectorOrder];
  if (sort === "hp-desc") return [desc(pokemonHp()), ...collectorOrder];
  return collectorOrder;
}
