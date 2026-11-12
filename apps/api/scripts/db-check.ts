// Read-only consistency check of a D1 database: what the foreign keys cannot express. Exits 1 when
// any check finds a row. Run it after a remote ingest, after a hand-written `d1 execute`, and before
// a migration that touches user tables.
//
//   bun scripts/db-check.ts                  # local D1 (wrangler dev state)
//   bun scripts/db-check.ts --remote         # production; reads only
//   bun scripts/db-check.ts --persist-to <dir>   # another local state dir (a restore drill's copy)
//   bun ../../scripts/with-system-certs.ts bun scripts/db-check.ts --upstream
//                                            # also diff stored card ids against live tcgdex
//
// Checks: SQLite integrity and foreign keys; ownership the routes enforce (favourite deck, a deck's
// folder, a folder's parent); the value domains the request schemas enforce; one card per set
// number; the reprint post-pass (`*_effective` = OR over the print_key group); `print_key` matching
// what today's `mapCard` keys the stored columns as, with every text transform and supplement (a
// mismatch after a mapper change means a full re-ingest is owed); an Energy with no type; every
// legal Pokémon's Prize value and suffix against its printed family (src/ingest/ruleBoxes.ts); and
// with `--upstream`, card ids tcgdex no longer lists (report only; every card of a set that now
// answers 404), and any set it could not read.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CONSISTENCY_CHECKS,
  COUNTED_TABLES,
  printKeyMismatches,
  storedRuleBoxMismatches,
} from "../src/db/consistency";
import { createSource } from "../src/ingest/source";
import { staleCardIds } from "../src/ingest/staleCards";
import { type D1Target, d1Query, type Row } from "./d1";

const SAMPLE_ROWS = 5;

type Failure = { name: string; rows: readonly Row[] };

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    remote: { type: "boolean", default: false },
    upstream: { type: "boolean", default: false },
    "persist-to": { type: "string" },
  },
  strict: true,
});
if (args.remote && args["persist-to"] !== undefined) {
  console.error("db-check: --persist-to names a local state directory; drop --remote");
  process.exit(1);
}
const target: D1Target = args.remote ? "--remote" : "--local";
const persistTo = args["persist-to"] === undefined ? undefined : resolve(args["persist-to"]);

const where = args.remote ? "REMOTE, read-only" : persistTo ? `local, ${persistTo}` : "local";
console.log(`db-check: D1 "colorless" (${where})`);

const results = d1Query(
  target,
  [
    ...CONSISTENCY_CHECKS.map((c) => c.sql),
    ...COUNTED_TABLES.map((t) => `SELECT count(*) AS n FROM ${t}`),
  ].join(";\n"),
  persistTo,
);
const failures: Failure[] = CONSISTENCY_CHECKS.map((check, i) => ({
  name: check.name,
  rows: results[i] ?? [],
}));
const counts = COUNTED_TABLES.map(
  (table, i) => `${table} ${String(results[CONSISTENCY_CHECKS.length + i]?.[0]?.n)}`,
);
console.log(`rows: ${counts.join(", ")}`);

const cards = d1Query(target, "SELECT * FROM cards ORDER BY id", persistTo)[0] ?? [];
failures.push(
  {
    name: "print_key differs from what mapCard keys today (full re-ingest owed)",
    rows: printKeyMismatches(cards),
  },
  {
    name: "legal Pokémon whose Prize value or suffix disagrees with its printed family",
    rows: storedRuleBoxMismatches(cards),
  },
);
if (args.upstream) {
  const { stale, unreadable } = await staleCardIds(cards, createSource("fetch"));
  failures.push(
    { name: "card tcgdex no longer lists (report only)", rows: stale },
    { name: "set tcgdex could not be read (its cards were not checked)", rows: unreadable },
  );
}

for (const { name, rows } of failures) {
  console.log(
    `${rows.length === 0 ? "  ok  " : "  FAIL"} ${name}${rows.length === 0 ? "" : `: ${rows.length}`}`,
  );
  for (const row of rows.slice(0, SAMPLE_ROWS)) console.log(`         ${JSON.stringify(row)}`);
  if (rows.length > SAMPLE_ROWS) console.log(`         … and ${rows.length - SAMPLE_ROWS} more`);
}
const failed = failures.filter((f) => f.rows.length > 0).length;
if (failed > 0) {
  console.error(`db-check: ${failed} check(s) found rows`);
  process.exit(1);
}
console.log(`db-check: OK — ${failures.length} checks, ${cards.length} cards keyed`);
