// Read-only consistency check of a D1 database: what the foreign keys cannot express. Exits 1 when
// any check finds a row. Run it after a remote ingest, after a hand-written `d1 execute`, and before
// a migration that touches user tables.
//
//   bun scripts/db-check.ts                  # local D1 (wrangler dev state)
//   bun scripts/db-check.ts --remote         # production; reads only
//   bun ../../scripts/with-system-certs.ts bun scripts/db-check.ts --upstream
//                                            # also diff stored card ids against live tcgdex
//
// Checks: SQLite integrity and foreign keys; ownership the routes enforce (favourite deck, a deck's
// folder, a folder's parent); the value domains the request schemas enforce; one card per set
// number; the reprint post-pass (`*_effective` = OR over the print_key group); `print_key` matching
// what the current `printKey` and `normalizeCardText` compute from the stored columns (a mismatch
// after either changes means a full re-ingest is owed); and with `--upstream`, card ids tcgdex no
// longer lists (report only).

import { parseArgs } from "node:util";
import { tcgdexSetSchema } from "@colorless/schema";
import {
  CARD_KEY_COLUMNS,
  CONSISTENCY_CHECKS,
  COUNTED_TABLES,
  printKeyMismatches,
} from "../src/db/consistency";
import { createSource } from "../src/ingest/source";
import { type D1Target, d1Query, type Row } from "./d1";

const SAMPLE_ROWS = 5;

type Failure = { name: string; rows: readonly Row[] };

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    remote: { type: "boolean", default: false },
    upstream: { type: "boolean", default: false },
  },
  strict: true,
});
const target: D1Target = args.remote ? "--remote" : "--local";

async function staleCardIds(cards: readonly Row[]): Promise<Row[]> {
  const bySet = new Map<string, Set<string>>();
  for (const card of cards) {
    const setId = String(card.set_id);
    const ids = bySet.get(setId) ?? new Set<string>();
    ids.add(String(card.id));
    bySet.set(setId, ids);
  }
  const source = createSource("fetch");
  const stale: Row[] = [];
  for (const [setId, stored] of bySet) {
    const set = tcgdexSetSchema.parse(await source.getSet(setId));
    const upstream = new Set(set.cards.map((card) => card.id));
    for (const id of stored) if (!upstream.has(id)) stale.push({ set_id: setId, id });
  }
  return stale;
}

console.log(`db-check: D1 "colorless" (${args.remote ? "REMOTE, read-only" : "local"})`);

const results = d1Query(
  target,
  [
    ...CONSISTENCY_CHECKS.map((c) => c.sql),
    ...COUNTED_TABLES.map((t) => `SELECT count(*) AS n FROM ${t}`),
  ].join(";\n"),
);
const failures: Failure[] = CONSISTENCY_CHECKS.map((check, i) => ({
  name: check.name,
  rows: results[i] ?? [],
}));
const counts = COUNTED_TABLES.map(
  (table, i) => `${table} ${String(results[CONSISTENCY_CHECKS.length + i]?.[0]?.n)}`,
);
console.log(`rows: ${counts.join(", ")}`);

const cards = d1Query(target, `SELECT ${CARD_KEY_COLUMNS} FROM cards ORDER BY id`)[0] ?? [];
failures.push({
  name: "print_key differs from the current printKey (full re-ingest owed)",
  rows: printKeyMismatches(cards),
});
if (args.upstream) {
  failures.push({
    name: "card tcgdex no longer lists (report only)",
    rows: await staleCardIds(cards),
  });
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
