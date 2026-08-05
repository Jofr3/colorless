// Live validation sweep for the tcgdex Zod schemas (P1 milestone 2).
//
//   bun packages/schema/scripts/validate-live.ts
//
// Deliberately OUTSIDE tsconfig's `include` (bun executes it directly; Biome
// still lints it). Sequentially, with a small delay and a hard request cap:
//   1. validates every /series brief,
//   2. validates the full `sv` serie,
//   3. validates every one of its sets (full),
//   4. validates EVERY card (full detail) of three diverse SV sets — the
//      promo set (svp), the energy set (sve) and a recent expansion
//      (sv06.5 "Shrouded Fable") — chosen so the whole sweep fits the cap.
// Prints per-model pass/fail counts and the first failures with zod issues.

import type { z } from "zod";
import {
  tcgdexCardSchema,
  tcgdexSerieBriefSchema,
  tcgdexSerieSchema,
  tcgdexSetSchema,
} from "../src/tcgdex";

const BASE_URL = "https://api.tcgdex.net/v2/en";
const DELAY_MS = 50;
const MAX_REQUESTS = 400;
const SERIE_ID = "sv";
const CARD_SWEEP_SET_IDS = ["svp", "sve", "sv06.5"];
const MAX_FAILURES_PRINTED = 10;

interface Failure {
  model: string;
  path: string;
  issues: z.core.$ZodIssue[] | string;
}

const counts = new Map<string, { pass: number; fail: number }>();
const failures: Failure[] = [];
let requestsMade = 0;

function record(model: string, path: string, result: z.ZodSafeParseResult<unknown>): void {
  const entry = counts.get(model) ?? { pass: 0, fail: 0 };
  if (result.success) {
    entry.pass += 1;
  } else {
    entry.fail += 1;
    failures.push({ model, path, issues: result.error.issues });
  }
  counts.set(model, entry);
}

function recordFetchError(model: string, path: string, message: string): void {
  const entry = counts.get(model) ?? { pass: 0, fail: 0 };
  entry.fail += 1;
  failures.push({ model, path, issues: `fetch error: ${message}` });
  counts.set(model, entry);
}

async function fetchJson(path: string): Promise<unknown> {
  if (requestsMade >= MAX_REQUESTS) {
    throw new Error(`request cap of ${MAX_REQUESTS} reached before ${path}`);
  }
  if (requestsMade > 0) {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  requestsMade += 1;
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

// 1. All /series briefs.
const seriesList = await fetchJson("/series");
if (!Array.isArray(seriesList)) {
  throw new Error("/series did not return an array");
}
for (const brief of seriesList) {
  // Label by raw JSON (not `brief.id`) so malformed entries stay identifiable.
  const label = `/series → ${JSON.stringify(brief).slice(0, 60)}`;
  record("serieBrief", label, tcgdexSerieBriefSchema.safeParse(brief));
}

// 2. The full `sv` serie.
const serieRaw = await fetchJson(`/series/${SERIE_ID}`);
const serieResult = tcgdexSerieSchema.safeParse(serieRaw);
record("serie", `/series/${SERIE_ID}`, serieResult);
if (!serieResult.success) {
  throw new Error("cannot continue: the sv serie itself failed to parse");
}

// 3. Every set of the serie, full detail. Keep card id lists for step 4.
const cardIdsBySet = new Map<string, string[]>();
for (const setBrief of serieResult.data.sets) {
  const path = `/sets/${encodeURIComponent(setBrief.id)}`;
  try {
    const setRaw = await fetchJson(path);
    const setResult = tcgdexSetSchema.safeParse(setRaw);
    record("set", path, setResult);
    if (setResult.success) {
      cardIdsBySet.set(
        setBrief.id,
        setResult.data.cards.map((card) => card.id),
      );
    }
  } catch (error) {
    recordFetchError("set", path, error instanceof Error ? error.message : String(error));
  }
}

// 4. Every card of the three sweep sets, full detail.
for (const setId of CARD_SWEEP_SET_IDS) {
  const cardIds = cardIdsBySet.get(setId);
  if (!cardIds) {
    console.warn(`warning: no card list for set ${setId}; skipping its card sweep`);
    continue;
  }
  for (const cardId of cardIds) {
    const path = `/cards/${encodeURIComponent(cardId)}`;
    try {
      const cardRaw = await fetchJson(path);
      record("card", path, tcgdexCardSchema.safeParse(cardRaw));
    } catch (error) {
      recordFetchError("card", path, error instanceof Error ? error.message : String(error));
    }
  }
}

// Summary.
let totalPass = 0;
let totalFail = 0;
console.log(`\ntcgdex live validation sweep — ${BASE_URL}`);
console.log(`requests made: ${requestsMade} (cap ${MAX_REQUESTS})`);
console.log("model        pass   fail");
for (const [model, entry] of counts) {
  totalPass += entry.pass;
  totalFail += entry.fail;
  const row = `${model.padEnd(12)} ${String(entry.pass).padStart(4)}  ${String(entry.fail).padStart(5)}`;
  console.log(row);
}
console.log(`total        ${String(totalPass).padStart(4)}  ${String(totalFail).padStart(5)}`);

if (failures.length > 0) {
  const shown = Math.min(failures.length, MAX_FAILURES_PRINTED);
  console.log(`\nfirst ${shown} of ${failures.length} failures:`);
  for (const failure of failures.slice(0, MAX_FAILURES_PRINTED)) {
    console.log(`\n[${failure.model}] ${failure.path}`);
    console.log(
      typeof failure.issues === "string" ? failure.issues : JSON.stringify(failure.issues, null, 2),
    );
  }
  process.exit(1);
}
console.log("\nall live payloads parsed cleanly.");
