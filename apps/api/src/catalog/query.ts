// The Drizzle `where` and `order by` for a validated GET /cards query (the schema lives in
// @colorless/schema). Pure, with no Worker types, so filters unit-test as plain functions.

import type { CardsQuery } from "@colorless/schema";
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
import { cards, sets } from "../db/schema";

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

/** `cards.id` is one of `ids`, bound as one JSON array to stay under D1's 100-parameter cap. */
export function cardIdIn(ids: readonly string[]): SQL {
  return sql`${cards.id} in (select "value" from json_each(${JSON.stringify(ids)}))`;
}

/**
 * The Drizzle `where` for a validated /cards query; undefined means unfiltered.
 * `%` and `_` in `name` are escaped. `type` matches the quoted value inside `types_json`, which
 * works because no type name is a substring of another. `text` matching over the JSON columns can
 * also hit JSON keys. Sentinel normalisation does not apply here: filters match stored values.
 */
export function buildCardsWhere(query: CardsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.id !== undefined) {
    conditions.push(cardIdIn(query.id));
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
