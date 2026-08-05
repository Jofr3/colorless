// tcgdex → D1 catalog ingest (P1 milestone 4, §3.4). Card DATA only — images
// are mirrored lazily by the /assets Worker routes (D9), never here.
//
//   bun scripts/ingest.ts                      # whole `sv` serie, local D1
//   bun scripts/ingest.ts --sets sve,sv06.5    # specific sets
//   bun scripts/ingest.ts --serie sv --remote  # remote D1 (the real backfill)
//   bun scripts/ingest.ts --dry-run            # write SQL files, apply nothing
//   bun scripts/ingest.ts --transport=sdk      # fetch via @tcgdex/sdk (D188)
//
// Flow: resolve target sets → per set, fetch every card's FULL detail
// (sequentially, 50ms apart — same politeness as validate-live.ts), validate
// each payload with @luminous/schema; any failure aborts that set with a
// report → write chunked upsert SQL files → apply in FK order (series → set →
// card chunks) via `wrangler d1 execute`. Idempotent: everything is an
// ON CONFLICT DO UPDATE upsert, so reruns are always safe.
//
// TRANSPORT (D188). Network access lives behind ../src/ingest/source.ts, which
// has two implementations: `fetch` (the historical raw-fetch path) and `sdk`
// (@tcgdex/sdk). The seam returns RAW UNVALIDATED payloads either way, so the
// Zod boundary below is unchanged and unconditional — swapping transport can
// never swap out validation. Default is `fetch`: it is the only transport ever
// proven end-to-end, and the SDK discards HTTP statuses below 500 (see the
// source.ts header). `--transport=sdk` is the path to exercise when validating
// the SDK against the live API.
//
// Deliberately OUTSIDE tsconfig's `include` (bun executes it directly; Biome
// still lints it), mirroring packages/schema/scripts/validate-live.ts. It
// imports ../src/ingest/source directly rather than through the ../src/ingest
// barrel, so the SDK dependency cannot reach the Worker via that barrel.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type TcgdexCard,
  type TcgdexSerie,
  type TcgdexSet,
  tcgdexCardSchema,
  tcgdexSerieSchema,
  tcgdexSetSchema,
} from "@luminous/schema";
import {
  CARDS_PER_CHUNK,
  cardsUpsertSql,
  chunk,
  mapCard,
  mapSerie,
  mapSet,
  seriesUpsertSql,
  setsUpsertSql,
} from "../src/ingest";
import { createSource, parseTransport } from "../src/ingest/source";

const DELAY_MS = 50;
const DATABASE = "luminous";
const MAX_FAILURES_PRINTED = 10;

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- args -------------------------------------------------------------------

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    sets: { type: "string" },
    serie: { type: "string" },
    remote: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    transport: { type: "string" },
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

// --- polite fetching + validation --------------------------------------------
//
// The source only ever hands back `unknown`; every payload is parsed here
// before it can reach a mapper. Both transports pace themselves identically —
// the SDK adds no politeness of its own.

const source = createSource(transport, { delayMs: DELAY_MS });

async function fetchSerie(serieId: string): Promise<TcgdexSerie> {
  const raw = await source.getSerie(serieId);
  const result = tcgdexSerieSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `serie ${serieId} failed validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
}

async function fetchSet(setId: string): Promise<TcgdexSet> {
  const raw = await source.getSet(setId);
  const result = tcgdexSetSchema.safeParse(raw);
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

function applySqlFile(path: string): void {
  if (dryRun) {
    console.log(`  dry-run: would apply ${path}`);
    return;
  }
  const result = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DATABASE, d1Target, "--yes", "--file", path],
    { cwd: API_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`wrangler d1 execute failed for ${path}`);
  }
  console.log(`  applied ${path}`);
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

// Phase B — series first (sets FK-reference them).
console.log(`series: ${serieRowsSource.map((serie) => serie.id).join(", ")}`);
applySqlFile(writeSqlFile("series", seriesUpsertSql(serieRowsSource.map(mapSerie))));

// Phase C — one set at a time: fetch + validate every card, then write and
// apply the set row followed by its card chunks.
const outcomes: SetOutcome[] = [];
for (const setId of setIds) {
  const setStartedAt = Date.now();
  console.log(`\nset ${setId}:`);
  try {
    const set = setDetails.get(setId) ?? (await fetchSet(setId));

    const cardPayloads: TcgdexCard[] = [];
    const failures: { cardId: string; issues: string }[] = [];
    for (const brief of set.cards) {
      const raw = await source.getCard(brief.id);
      const parsed = tcgdexCardSchema.safeParse(raw);
      if (parsed.success) {
        cardPayloads.push(parsed.data);
      } else {
        failures.push({ cardId: brief.id, issues: JSON.stringify(parsed.error.issues) });
      }
    }
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

    applySqlFile(writeSqlFile(`set-${setId}`, setsUpsertSql([mapSet(set)])));
    const chunks = chunk(cardPayloads.map(mapCard), CARDS_PER_CHUNK);
    chunks.forEach((rows, index) => {
      const label = `cards-${setId}-${String(index).padStart(2, "0")}`;
      applySqlFile(writeSqlFile(label, cardsUpsertSql(rows)));
    });
    outcomes.push({
      setId,
      cards: cardPayloads.length,
      chunks: chunks.length,
      status: "ok",
      seconds: (Date.now() - setStartedAt) / 1000,
    });
    console.log(`  ${cardPayloads.length} cards in ${chunks.length} chunk file(s)`);
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
    `${source.requestCount} tcgdex requests via ${source.transport}, ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s${dryRun ? " (dry-run: nothing applied)" : ""}`,
);
if (failedSets.length > 0) {
  console.error(`${failedSets.length} set(s) failed: ${failedSets.map((o) => o.setId).join(", ")}`);
  process.exit(1);
}
