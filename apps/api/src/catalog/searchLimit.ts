// The per-IP limit on GET /cards queries that read a large part of the catalog on every request,
// and the log of what those queries read.
//
// A `name` or `text` search is a LIKE that walks the whole table (about 5,100 rows on the
// 5,084-card catalog), and a deep page reads every row it skips. Such shapes never reach KV, and
// D1's 5M rows read a day are the whole account's: about 1,000 of them stop sign-in, decks and
// the lobby until 00:00 UTC. The CATALOG_SEARCH_LIMIT binding (wrangler.jsonc) allows
// SEARCH_LIMIT_PER_MINUTE of them per address. The builder asks GET /cards only for the pages KV
// caches and serves every other page (free text, HP bounds, pages past MAX_CACHED_CARDS_PAGE) from
// the card index in the browser (cardIndex.ts), so the limit meets only other callers. It bounds a
// careless loop, not a determined attacker: one address can still read about 150k rows a minute.
// The same budget covers GET /cards/index when KV misses it.

import type { CardsQuery } from "@colorless/schema";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { Env } from "../env";
import { bindingRefusal, bindingRefuses } from "../http/bindingLimit";
import { clientIpKey } from "../http/clientIp";
import { logEvent, logEventThrottled } from "../http/log";

/** wrangler.jsonc `CATALOG_SEARCH_LIMIT.simple.limit`; its period is BINDING_PERIOD_SECONDS. */
export const SEARCH_LIMIT_PER_MINUTE = 30;

/**
 * A 429 once the caller's address is over its search budget for queries `scans` picks, else
 * next. Without the binding (unit tests), or when it throws, the request proceeds
 * (bindingRefuses): a broken limiter must not close the builder.
 */
export function catalogSearchLimit(
  scans: (query: CardsQuery) => boolean,
): MiddlewareHandler<{ Bindings: Env }, string, { out: { query: CardsQuery } }> {
  return async (c, next) => {
    const binding = c.env.CATALOG_SEARCH_LIMIT;
    if (binding === undefined || !scans(c.req.valid("query"))) return next();
    return limited(c, binding, "/cards", next);
  };
}

/** The same budget for a route that reads the whole catalog whenever it runs: mounted after the
    route's KV cache, so only a miss spends it. */
export function catalogScanLimit(route: string): MiddlewareHandler<{ Bindings: Env }> {
  return (c, next) => limited(c, c.env.CATALOG_SEARCH_LIMIT, route, next);
}

async function limited(c: Context, binding: RateLimit | undefined, route: string, next: Next) {
  if (!(await bindingRefuses(binding, clientIpKey(c), "catalog", route, "limiter_error"))) {
    return next();
  }
  logEventThrottled("catalog", "rate_limited", { route });
  return bindingRefusal(c, "too many searches; try again in a minute");
}

/** How often an isolate writes its tally of uncached /cards reads. */
const READS_LOG_INTERVAL_MS = 60_000;

type ReadsTally = { queries: number; rowsRead: number; maxRowsRead: number; maxParams: string };
const emptyTally = (): ReadsTally => ({ queries: 0, rowsRead: 0, maxRowsRead: 0, maxParams: "" });
let tally = emptyTally();
let lastLogged: number | undefined;

/**
 * Adds one uncached /cards query's D1 `rows_read` to this isolate's tally, and writes the tally as
 * one `evt = "d1", kind = "catalog_reads"` line at most once a minute: the queries, their rows
 * read, and the heaviest one's param names (never their values). The first query an isolate
 * serves is logged at once; a tally the isolate dies holding is lost, so the lines undercount.
 */
export function recordCatalogReads(query: CardsQuery, rowsRead: number, now = Date.now()): void {
  tally.queries += 1;
  tally.rowsRead += rowsRead;
  if (rowsRead > tally.maxRowsRead) {
    tally.maxRowsRead = rowsRead;
    tally.maxParams = Object.keys(query)
      .filter((name) => query[name as keyof CardsQuery] !== undefined)
      .sort()
      .join(",");
  }
  if (lastLogged !== undefined && now - lastLogged < READS_LOG_INTERVAL_MS) return;
  logEvent("d1", "catalog_reads", {
    queries: tally.queries,
    rows_read: tally.rowsRead,
    max_rows_read: tally.maxRowsRead,
    max_params: tally.maxParams,
  });
  lastLogged = now;
  tally = emptyTally();
}

/** Forgets the tally; tests only. */
export function resetCatalogReads(): void {
  tally = emptyTally();
  lastLogged = undefined;
}

/** `db` with each batch's `meta.rows_read` added to `reads.rows`. Only batches are counted: they
    are the one drizzle path whose results carry D1's meta. */
export function countingReads(db: D1Database, reads: { rows: number }): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          for (const result of results) reads.rows += result.meta?.rows_read ?? 0;
          return results;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
