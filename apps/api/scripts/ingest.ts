// tcgdex to D1 catalog ingest. Card data only; images are mirrored lazily by the /assets routes.
// Every payload is validated with @colorless/schema before mapping, and all writes are upserts, so
// reruns are safe. Validated payloads are kept on disk for a day (`--refresh` refetches), and each
// set is written by one SQL file. Imports ../src/ingest/source and ./payloadCache directly so the
// SDK and node:fs cannot reach the Worker through the ingest barrel.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type TcgdexCard,
  type TcgdexSerie,
  type TcgdexSet,
  tcgdexCardSchema,
  tcgdexSerieSchema,
  tcgdexSetSchema,
} from "@colorless/schema";
import type { z } from "zod";
import { CATALOG_EPOCH_KEY } from "../src/catalog/epoch";
import {
  cardsUpsertStatements,
  mapCard,
  mapSerie,
  mapSet,
  reprintLegalitySql,
  seriesUpsertSql,
  setsUpsertSql,
  weaklessLegalPokemon,
} from "../src/ingest";
import { createPayloadCache, type PayloadKind } from "../src/ingest/payloadCache";
import { createSource, parseTransport } from "../src/ingest/source";
import { API_ROOT, DATABASE, recordBookmark } from "./d1";

const DELAY_MS = 50;
/** Card requests in flight at once; their starts still keep DELAY_MS apart. */
const FETCH_CONCURRENCY = 4;
const PAYLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES_PRINTED = 10;

// --- args -------------------------------------------------------------------

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    sets: { type: "string" },
    serie: { type: "string" },
    remote: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    transport: { type: "string" },
    refresh: { type: "boolean", default: false },
  },
  strict: true,
});

if (args.sets !== undefined && args.serie !== undefined) {
  console.error("pass either --sets or --serie, not both");
  process.exit(1);
}
let transport: ReturnType<typeof parseTransport>;
try {
  transport = parseTransport(args.transport);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const targetSetIds = args.sets
  ?.split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const targetSerieId = targetSetIds ? undefined : (args.serie ?? "sv");
const dryRun = args["dry-run"] ?? false;
const d1Target = args.remote ? "--remote" : "--local";
const refresh = args.refresh ?? false;

// --- polite fetching + validation --------------------------------------------
//
// The source only ever hands back `unknown`; every payload is parsed here
// before it can reach a mapper. Both transports pace themselves identically —
// the SDK adds no politeness of its own.

const source = createSource(transport, { delayMs: DELAY_MS });
const payloads = createPayloadCache({
  dir: join(API_ROOT, ".wrangler", "tcgdex-cache"),
  maxAgeMs: PAYLOAD_MAX_AGE_MS,
});
let cachedPayloads = 0;

/** A validated payload, from the disk cache when a fresh entry still validates, else fetched
    (and cached once it validates). */
async function fetchValidated<Schema extends z.ZodType>(
  kind: PayloadKind,
  id: string,
  fetchRaw: (id: string) => Promise<unknown>,
  schema: Schema,
): Promise<z.ZodSafeParseResult<z.output<Schema>>> {
  if (!refresh) {
    const cached = schema.safeParse(payloads.read(kind, id));
    if (cached.success) {
      cachedPayloads += 1;
      return cached;
    }
  }
  const raw = await fetchRaw(id);
  const result = schema.safeParse(raw);
  if (result.success) payloads.write(kind, id, raw);
  return result;
}

/** Runs `task` over `items` with at most `limit` running at once; results keep input order. The
    first failure rejects the whole run and stops the other workers from claiming more items. */
async function mapBounded<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as Item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchSerie(serieId: string): Promise<TcgdexSerie> {
  const result = await fetchValidated("serie", serieId, source.getSerie, tcgdexSerieSchema);
  if (!result.success) {
    throw new Error(
      `serie ${serieId} failed validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
}

async function fetchSet(setId: string): Promise<TcgdexSet> {
  const result = await fetchValidated("set", setId, source.getSet, tcgdexSetSchema);
  if (!result.success) {
    throw new Error(
      `set ${setId} failed validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
}

// --- SQL files + application --------------------------------------------------

const runStamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outDir = join(API_ROOT, ".wrangler", "tmp", `ingest-${runStamp}`);
mkdirSync(outDir, { recursive: true });
let fileOrdinal = 0;

function writeSqlFile(label: string, sql: string): string {
  const name = `${String(fileOrdinal).padStart(3, "0")}-${label}.sql`;
  fileOrdinal += 1;
  const path = join(outDir, name);
  writeFileSync(path, `${sql}\n`);
  return path;
}

/** Rows written by every remote apply so far; null once one reported no count. Local wrangler
    prints no count, so a local run never learns it. */
let rowsWritten: number | null = args.remote ? 0 : null;

/** The `rows_written` a `wrangler d1 execute --json` printed, or null when it printed none. */
function rowsWrittenOf(stdout: string): number | null {
  try {
    const statements = JSON.parse(stdout) as { meta?: { rows_written?: unknown } }[];
    const counts = statements.map((statement) => statement.meta?.rows_written);
    return counts.every((n) => typeof n === "number")
      ? counts.reduce<number>((sum, n) => sum + (n as number), 0)
      : null;
  } catch {
    return null;
  }
}

/** Applies a file through `--file`, which on --remote goes through D1's import API: the whole
    file is one transaction, and the database answers no queries while it runs (seconds a set). */
function applySqlFile(path: string): void {
  applySql(path, ["--file", path]);
}

/** Applies one statement through `--command`, which on --remote is an ordinary query and so does
    not make the database unavailable the way an import does. The file is written for the record. */
function applySqlCommand(path: string, sql: string): void {
  applySql(path, ["--command", sql]);
}

function applySql(path: string, input: readonly string[]): void {
  if (dryRun) {
    console.log(`  dry-run: would apply ${path}`);
    return;
  }
  const result = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DATABASE, d1Target, "--yes", "--json", ...input],
    { cwd: API_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`wrangler d1 execute failed for ${path}`);
  }
  const written = rowsWrittenOf(result.stdout);
  if (rowsWritten !== null) rowsWritten = written === null ? null : rowsWritten + written;
  console.log(`  applied ${path}${written === null ? "" : ` (${written} rows written)`}`);
}

/** Stamps a new catalog epoch in the CACHE namespace of the same target, which retires every
    catalog response cached before this ingest. */
function stampCatalogEpoch(): boolean {
  const epoch = Date.now().toString(36);
  if (dryRun) {
    console.log(`  dry-run: would stamp ${CATALOG_EPOCH_KEY}=${epoch}`);
    return true;
  }
  const result = spawnSync(
    "bunx",
    ["wrangler", "kv", "key", "put", CATALOG_EPOCH_KEY, epoch, "--binding", "CACHE", d1Target],
    { cwd: API_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    return false;
  }
  console.log(`  stamped ${CATALOG_EPOCH_KEY}=${epoch}`);
  return true;
}

// --- run ----------------------------------------------------------------------

interface SetOutcome {
  setId: string;
  cards: number;
  chunks: number;
  status: "ok" | "failed";
  seconds: number;
}

const startedAt = Date.now();
console.log(
  `tcgdex ingest → D1 "${DATABASE}" (${args.remote ? "REMOTE" : "local"}${dryRun ? ", dry-run" : ""}, transport=${source.transport})`,
);
console.log(`SQL files: ${outDir}\n`);

// Phase A — resolve the serie row(s) and the target set list. Failures here
// are fatal: a handful of requests, and FK order depends on them.
const setDetails = new Map<string, TcgdexSet>();
let serieRowsSource: TcgdexSerie[];
let setIds: string[];
if (targetSetIds) {
  for (const setId of targetSetIds) {
    setDetails.set(setId, await fetchSet(setId));
  }
  const serieIds = [...new Set([...setDetails.values()].map((set) => set.serie.id))];
  serieRowsSource = [];
  for (const serieId of serieIds) {
    serieRowsSource.push(await fetchSerie(serieId));
  }
  setIds = targetSetIds;
} else {
  if (targetSerieId === undefined) {
    throw new Error("unreachable: no --sets and no serie id");
  }
  const serie = await fetchSerie(targetSerieId);
  serieRowsSource = [serie];
  setIds = serie.sets.map((set) => set.id);
}

// A restore point before the first remote write.
if (args.remote && !dryRun) recordBookmark(`ingest ${setIds.join(",")}`);

// Phase B — series first (sets FK-reference them).
console.log(`series: ${serieRowsSource.map((serie) => serie.id).join(", ")}`);
const seriesSql = seriesUpsertSql(serieRowsSource.map(mapSerie));
applySqlCommand(writeSqlFile("series", seriesSql), seriesSql);

// Phase C — one set at a time: fetch + validate every card, then write the set
// row and its card chunks to one file and apply it.
const outcomes: SetOutcome[] = [];
const weakless: string[] = [];
for (const setId of setIds) {
  const setStartedAt = Date.now();
  console.log(`\nset ${setId}:`);
  try {
    const set = setDetails.get(setId) ?? (await fetchSet(setId));

    const cardPayloads: TcgdexCard[] = [];
    const failures: { cardId: string; issues: string }[] = [];
    const parsedCards = await mapBounded(set.cards, FETCH_CONCURRENCY, (brief) =>
      fetchValidated("card", brief.id, source.getCard, tcgdexCardSchema),
    );
    parsedCards.forEach((parsed, index) => {
      if (parsed.success) {
        cardPayloads.push(parsed.data);
      } else {
        const cardId = set.cards[index]?.id ?? "?";
        failures.push({ cardId, issues: JSON.stringify(parsed.error.issues) });
      }
    });
    if (failures.length > 0) {
      console.error(
        `  ${failures.length}/${set.cards.length} cards failed validation — aborting this set:`,
      );
      for (const failure of failures.slice(0, MAX_FAILURES_PRINTED)) {
        console.error(`    ${failure.cardId}: ${failure.issues}`);
      }
      if (failures.length > MAX_FAILURES_PRINTED) {
        console.error(`    … and ${failures.length - MAX_FAILURES_PRINTED} more`);
      }
      outcomes.push({
        setId,
        cards: 0,
        chunks: 0,
        status: "failed",
        seconds: (Date.now() - setStartedAt) / 1000,
      });
      continue;
    }

    const rows = cardPayloads.map(mapCard);
    weakless.push(...weaklessLegalPokemon(rows));
    const chunks = cardsUpsertStatements(rows);
    // The set-scoped reprint pass rides in the same file, so the import that upserts the set's
    // cards also settles their effective legality.
    const statements = [setsUpsertSql([mapSet(set)]), ...chunks, reprintLegalitySql(setId)];
    applySqlFile(writeSqlFile(`set-${setId}`, statements.join("\n\n")));
    outcomes.push({
      setId,
      cards: cardPayloads.length,
      chunks: chunks.length,
      status: "ok",
      seconds: (Date.now() - setStartedAt) / 1000,
    });
    console.log(`  ${cardPayloads.length} cards in ${chunks.length} statement(s), one file`);
  } catch (error) {
    console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
    outcomes.push({
      setId,
      cards: 0,
      chunks: 0,
      status: "failed",
      seconds: (Date.now() - setStartedAt) / 1000,
    });
  }
}

// Phase D — the reprint rule over the whole table (see reprintLegalitySql). Each set's file
// already settled its own rows, so a failure here leaves only other sets' twins stale.
console.log("\nreprint legality:");
let postPassFailed = false;
try {
  const postPass = reprintLegalitySql();
  applySqlCommand(writeSqlFile("reprint-legality", postPass), postPass);
} catch (error) {
  postPassFailed = true;
  console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
}

// A remote run that wrote nothing changed no response, so it keeps the cached pages and the KV
// writes that refilling them would spend. A run with an unknown count stamps.
console.log("\ncatalog cache:");
let epochStamped = true;
if (rowsWritten === 0 && !dryRun) {
  console.log(`  0 rows written: ${CATALOG_EPOCH_KEY} left as it was`);
} else {
  epochStamped = stampCatalogEpoch();
}

// --- summary -------------------------------------------------------------------

const totalCards = outcomes.reduce((sum, outcome) => sum + outcome.cards, 0);
const failedSets = outcomes.filter((outcome) => outcome.status === "failed");
console.log("\nset          cards  chunks  status  seconds");
for (const outcome of outcomes) {
  console.log(
    `${outcome.setId.padEnd(12)} ${String(outcome.cards).padStart(5)}  ${String(
      outcome.chunks,
    ).padStart(6)}  ${outcome.status.padEnd(6)}  ${outcome.seconds.toFixed(1).padStart(7)}`,
  );
}
console.log(
  `\ntotal: ${outcomes.length} set(s), ${totalCards} cards, ` +
    `${rowsWritten === null ? "" : `${rowsWritten} rows written, `}` +
    `${source.requestCount} tcgdex requests via ${source.transport} ` +
    `(${cachedPayloads} payloads from the disk cache), ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s${dryRun ? " (dry-run: nothing applied)" : ""}`,
);
if (weakless.length > 0) {
  // Written anyway (the rows are otherwise good); see weaklessLegalPokemon.
  console.error(
    `${weakless.length} Standard-legal non-Dragon Pokémon have no Weakness — add them to ` +
      `src/ingest/weakResSupplement.ts: ${weakless.join(", ")}`,
  );
}
if (failedSets.length > 0) {
  console.error(`${failedSets.length} set(s) failed: ${failedSets.map((o) => o.setId).join(", ")}`);
}
if (postPassFailed) {
  console.error(
    "the whole-table reprint pass failed: rerun the same command (unchanged rows are skipped) " +
      "so reprints in other sets pick up this run's legality",
  );
}
if (!epochStamped) {
  console.error(
    `could not stamp ${CATALOG_EPOCH_KEY}: cached catalog responses stay up to a day — rerun ` +
      `\`wrangler kv key put ${CATALOG_EPOCH_KEY} <new value> --binding CACHE ${d1Target}\``,
  );
}
if (failedSets.length > 0 || weakless.length > 0 || !epochStamped || postPassFailed) {
  process.exit(1);
}
