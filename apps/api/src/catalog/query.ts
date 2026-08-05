// GET /cards (and /sets) query vocabulary: zod schemas for the query strings
// (validated in routes.ts via @hono/zod-validator) and the Drizzle `where`
// builder. Pure — no Worker types — so filters unit-test as plain functions.

import { cardCategorySchema } from "@luminous/schema";
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
  /** Case-insensitive substring over RULES TEXT: Pokémon ability/attack names
      and effects, plus Trainer/Special-Energy `effect` prose (D197). */
  text: param.optional(),
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
 * The Drizzle `where` for a validated /cards query; undefined = unfiltered.
 *
 * Tradeoffs, on purpose:
 * - `name` uses LIKE '%…%', which in SQLite is already case-insensitive for
 *   ASCII. `%`/`_` in the input are escaped (with an ESCAPE '\' clause) so a
 *   search like "50%" matches literally instead of acting as extra wildcards.
 * - `type` LIKEs for the quoted value inside the raw `types_json` text
 *   (e.g. '%"Water"%') instead of a json_each() join. Exact enough because
 *   no energy type is a substring of another *quoted* type; revisit if the
 *   vocabulary ever grows an overlapping name.
 * - repeated `type` / `rarity` values OR within their dimension (a card
 *   matches if it has ANY selected type / rarity); dimensions still AND.
 * - `text` LIKEs over the raw abilities/attacks JSON blobs (names and effect
 *   text live inside) AND the plain-text `effect` column. The JSON halves are
 *   imprecise on purpose — a term can brush a JSON KEY or a cost value rather
 *   than prose, and the catalog says how much: over the JSON PAIR ALONE,
 *   `?text=effect` matches 2,816 of 3,786 rows and `?text=damage` matches 3,175,
 *   almost entirely on the `{cost,name,effect,damage}` keys of attacks_json.
 *   Whole-filter totals today are 2,826 and 3,267 — the `effect` column adds 10
 *   and 92 rows respectively, and adds them for genuine PROSE matches (measured
 *   on production 2026-08-04; D203 re-attributed these figures, which were
 *   presented as the whole filter's after D197 widened it under them). Still
 *   plenty for catalog search at ~3.7k rows, and cheaper than a search index.
 *
 *   `effect` (D197) does NOT inherit that hazard — it is prose, not a
 *   serialized object, so there are no key names in it to brush. It was worth
 *   adding because the JSON pair reaches NONE of it: measured on production,
 *   every one of the 517 rows carrying `effect` (499 Trainer + 18 Energy) has
 *   BOTH abilities_json and attacks_json NULL, and all 3,233 Pokémon rows have
 *   `effect` NULL. The two sets are exactly disjoint, so before this the
 *   `text` filter could not return a Trainer or a Special Energy for ANY term
 *   — 275 of the unreachable rows are Standard-legal (264 Trainer, 11 Energy:
 *   8 Special + 3 Normal), i.e. the whole Trainer half of a legal deck.
 * - `id` binds the WHOLE list as one JSON array and expands it with
 *   `json_each` instead of an N-placeholder `IN (?, ?, …)`. One bind, not
 *   ≤100, so D1's 100-bound-parameter cap is out of the picture even with
 *   LIMIT/OFFSET and every other filter's binds on the same statement — which
 *   is what lets the hydration path stay a single ordered, paged SQL query
 *   instead of a chunked batch sorted in JS (D197; see `cardsOrder`).
 *   `IN (subquery)` is set membership, so a repeated id can't duplicate a row.
 * - sentinel normalisation (../sentinel.ts, D194) deliberately does NOT reach
 *   in here. The where clause matches STORED values; the normaliser runs on
 *   the way out. So a hand-crafted `?rarity=None` still matches the 34 `mfb`
 *   rows while their payloads report `rarity: null` — inconsistent, but
 *   unreachable from the UI (the value is gone from /facets, which is where
 *   every filter value in the rail comes from) and self-healing on the next
 *   `mfb` re-ingest. Teaching the where clause to rewrite user input would
 *   be the over-reach: it would make `?rarity=None` silently mean "rarity IS
 *   NULL", a filter the API otherwise does not offer for ANY column.
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
 * The ORDER BY for a validated /cards query — the ONE sort spec in the API.
 * Every sort ends on collector order so pages stay deterministic across equal
 * keys. `hp-desc` relies on SQLite treating NULL as smaller than every value —
 * `hp DESC` puts the hp-less Trainers/Energy last (verified against SQLite
 * directly).
 *
 * It used to have a JS TWIN (`compareCardRows`), because the id-hydration
 * path chunked its `IN` list across a db.batch and so had no single statement
 * to hang an ORDER BY on; it sorted the ≤ MAX_ID_VALUES matched rows in
 * memory instead. Two hand-maintained specs for one order — they agreed
 * (measured: the divergence classes are SQLite's BINARY collation vs JS
 * UTF-16 `<`, which differ only above the BMP, and the catalog's 13
 * non-ASCII names are all BMP — `é`, `♀`, `♂`), but nothing MADE them agree,
 * and the note that deferred this asked for the unification BEFORE any sort
 * option is added. D197 removed the twin instead of syncing it: the JSON-bound
 * id list (see `buildCardsWhere`) collapsed hydration back onto the ordinary
 * single-statement path, so a new sort key is now one edit here and there is
 * no second evaluator left to disagree with SQLite.
 */
export function cardsOrder(sort: CardsQuery["sort"]): SQL[] {
  if (sort === "name") return [asc(cards.name), ...collectorOrder];
  if (sort === "hp-desc") return [desc(cards.hp), ...collectorOrder];
  return collectorOrder;
}
