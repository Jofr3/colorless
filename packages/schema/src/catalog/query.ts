// GET /cards and GET /sets query strings. The api validates against these schemas; the client
// types its parameters from their input side.

import * as z from "zod";
import { cardCategorySchema } from "./card";

/**
 * The longest value a catalog param other than free text takes: an id, a vocabulary value, an
 * exact illustrator, all far shorter than this. A longer value only lengthens the KV key, which
 * past 512 bytes skips KV.
 */
export const MAX_PARAM_LENGTH = 100;

/** The longest free-text term (name, nameExact, text): the builder's search fields hold 300
    characters, and a decklist line at most 120. */
export const MAX_SEARCH_TERM_LENGTH = 300;

/** A query-string field that must be non-empty when present. */
const param = z.string().min(1).max(MAX_PARAM_LENGTH);

/** A typed search term, non-empty when present. */
const term = z.string().min(1).max(MAX_SEARCH_TERM_LENGTH);

/** A field that may repeat (`?type=Fire&type=Water`). hono's query validator hands a repeated key
    to zod as an array and a single occurrence as a string; both normalize to a non-empty
    string[]. */
const repeatable = z
  .union([param, z.array(param).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/** Cap on repeatable `id` values. A deck holds at most 60 unique cards, so 100 leaves headroom for
    deck hydration while bounding the query string and the id scan. */
export const MAX_ID_VALUES = 100;

/**
 * Caps on the repeatable vocabulary filters, per dimension and across all of them. Each value is
 * one bound SQL parameter (ids are one JSON parameter), and D1 rejects a statement with more than
 * 100, which would surface as a 500; the scalar filters bind about 15 more. Both caps sit above
 * what the vocabularies GET /facets lists can fill, per dimension and together.
 */
export const MAX_FILTER_VALUES = 30;
export const MAX_FILTER_VALUES_TOTAL = 60;

/**
 * The deepest row a GET /cards page may start at: `(page - 1) * pageSize`. D1 reads every skipped
 * row, so a deep page costs its offset, and a caller paging past this narrows its filters instead.
 * The builder stops its pager here (8 cards a page: page 126).
 */
export const MAX_CARDS_OFFSET = 1000;

/** A repeatable vocabulary filter, OR-ed within its dimension. */
const multiParam = repeatable.pipe(z.array(param).max(MAX_FILTER_VALUES));

/** The fields built on multiParam, whose values count toward MAX_FILTER_VALUES_TOTAL. */
const VOCABULARY_FILTERS = [
  "type",
  "rarity",
  "stage",
  "suffix",
  "trainerType",
  "energyType",
] as const;

/**
 * GET /cards query params. Numbers arrive as strings, hence `z.coerce`, typed `<number>` so the
 * input side stays `number` for the client; unknown params are stripped; empty values 400.
 */
export const cardsQuerySchema = z
  .object({
    /** Exact card id(s) for batched deck hydration, e.g. "sv06.5-001" (repeatable, at most
      MAX_ID_VALUES; unknown ids are omitted). Composes with every other filter. */
    id: repeatable.pipe(z.array(param).max(MAX_ID_VALUES)).optional(),
    /** Case-insensitive substring of the card name. */
    name: term.optional(),
    /** Case-insensitive whole-name equality: the import flow's exact-card lookup. */
    nameExact: term.optional(),
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
    text: term.optional(),
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
    /** The match count an earlier page of the same query reported. When present it is returned as
      `total` instead of counting the matches again. */
    total: z.coerce.number<number>().int().min(0).optional(),
  })
  .check((ctx) => {
    const offset = (ctx.value.page - 1) * ctx.value.pageSize;
    if (offset > MAX_CARDS_OFFSET) {
      ctx.issues.push({
        code: "custom",
        message: `page ${ctx.value.page} at ${ctx.value.pageSize} a page skips more than ${MAX_CARDS_OFFSET} cards; narrow the filters`,
        input: ctx.value,
        path: ["page"],
      });
    }
    const values = VOCABULARY_FILTERS.reduce(
      (sum, name) => sum + (ctx.value[name]?.length ?? 0),
      0,
    );
    if (values > MAX_FILTER_VALUES_TOTAL) {
      ctx.issues.push({
        code: "custom",
        message: `at most ${MAX_FILTER_VALUES_TOTAL} filter values across ${VOCABULARY_FILTERS.join(", ")}`,
        input: ctx.value,
      });
    }
  });
export type CardsQuery = z.infer<typeof cardsQuerySchema>;
/**
 * The free-text search params. A LIKE over a typed term walks most of the table whatever the page,
 * so the API counts such a query's matches in its page statement (a window count) rather than in a
 * second scan, and a paging client fetches several pages of one in a single request (pageSize is
 * the page count times its own page size). An exact name is an index lookup either way.
 */
export const FREE_TEXT_CATALOG_PARAMS = ["name", "nameExact", "text"] as const;
/**
 * Catalog query params whose values are typed by a person or drawn from one deck: id hydration,
 * the free-text searches and the HP bounds. Such queries almost never recur, and any number would
 * mint a KV entry, so the API does not cache them, and a paging client may send a known `total`
 * with one of them.
 */
export const UNCACHED_CATALOG_PARAMS = [
  "id",
  ...FREE_TEXT_CATALOG_PARAMS,
  "hpMin",
  "hpMax",
] as const;
/** The last GET /cards page the API caches. A browsing client's first page and its prefetches
    recur across visitors; a deeper page is one person paging, so it goes to D1, and a paging
    client sends a known `total` with it to spare the recount. */
export const MAX_CACHED_CARDS_PAGE = 3;
/** The GET /cards page sizes the API caches: the builder's grid (4 or 8 cards a page) and the
    default. Any other size goes to D1, so a caller cannot mint a KV entry per number. */
export const CACHED_CARDS_PAGE_SIZES: readonly number[] = [4, 8, 50];
/** What a caller may send: every field optional, a repeatable one as a string or string[]. */
export type CardsQueryParams = z.input<typeof cardsQuerySchema>;

/** GET /cards/full query params: the ids whose full Cards to return (repeatable, 1 to
    MAX_ID_VALUES). Unknown ids are omitted from the response. */
export const fullCardsQuerySchema = z.object({
  id: repeatable.pipe(z.array(param).max(MAX_ID_VALUES)),
});
export type FullCardsQuery = z.infer<typeof fullCardsQuerySchema>;

/** GET /sets query params. */
export const setsQuerySchema = z.object({
  /** Serie id, e.g. "sv". */
  serie: param.optional(),
});
export type SetsQuery = z.infer<typeof setsQuerySchema>;
