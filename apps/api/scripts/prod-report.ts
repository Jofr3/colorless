// `bun run --cwd apps/api prod:report [--days N] [--release]`: how production is doing, from what
// Cloudflare keeps. Usage against the account's Free quotas per UTC day, the API's requests by
// status, CPU and wall time, 5xx by day and version, per-route latency, the top D1 queries, the
// log lines worth a look, the two SLOs and the online match completion share, then every threshold
// as ok, warn or crit. `--release` adds the newest API version against the one it replaced, since
// its deploy. Run monthly and after each release (docs/conventions.md, the monthly routine).
//
// Read-only: GraphQL Analytics, the Workers Logs query API and the deployments list, with the
// ambient CLOUDFLARE_API_TOKEN (a read token); CLOUDFLARE_ACCOUNT_ID overrides the account the
// token lists. Windows: `--days` (default 7) for GraphQL, which keeps about 31 days; Workers Logs
// keep fewer (LOGS_MAX_DAYS), so their sections say how many days they read. The report prints
// counts, route patterns, statuses and version ids only, and refuses to print one that matches an
// address (leaksIn). Exits 1 on a crit, 2 when it cannot run, else 0.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALERT_LINES,
  aggregatesOf,
  availability,
  availabilityLine,
  CORE_PATHS,
  coreRouteRegex,
  countByRoute,
  cronSignal,
  DAY_MS,
  daySlices,
  databaseIdOf,
  exitCodeOf,
  fmtInt,
  fmtMs,
  isHttpAnswer,
  isLimitStatus,
  isoDate,
  isRecord,
  LOGS_MAX_DAYS,
  listOf,
  latencyLevel,
  latencyLine,
  leaksIn,
  matchLines,
  missingCorePaths,
  numAt,
  parseArgs,
  quotaDaily,
  quotaRows,
  quotaTable,
  type Route,
  releasePair,
  releaseSignals,
  routeFilters,
  routeLabel,
  routePatterns,
  SLO_DAYS,
  type Signal,
  shortId,
  signalLines,
  singleValue,
  sqlShape,
  strAt,
  type TelemetryFilter,
  table,
  utcDates,
  type VersionStats,
  versionRow,
  versionTagOf,
  WATCHED_LINES,
} from "../src/prodReport";
import { API_ROOT } from "./d1";

const API_WORKER = "colorless-api";
const CF = "https://api.cloudflare.com/client/v4";

const args = parseArgs(process.argv.slice(2));
if ("error" in args) {
  console.error(`prod:report: ${args.error}`);
  process.exit(2);
}
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("prod:report: CLOUDFLARE_API_TOKEN is not set (the ambient read token)");
  process.exit(2);
}

type Json = Record<string, unknown>;

/** A failed read: its section says so and the thresholds carry a warn. Only Cloudflare's error
    code and message are kept, never a response body. */
class ReadError extends Error {}

async function cf(path: string, body?: unknown): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(`${CF}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new ReadError(`network: ${error instanceof Error ? error.name : "failed"}`);
  }
  const json: unknown = await response.json().catch(() => undefined);
  const first = isRecord(json) ? listOf(json.errors)[0] : undefined;
  if (!response.ok || !isRecord(json) || (first !== undefined && first !== null)) {
    const detail = isRecord(first) ? `${strAt(first, "code")} ${strAt(first, "message")}` : "";
    throw new ReadError(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
  return json;
}

async function accountId(): Promise<string> {
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (fromEnv) return fromEnv;
  const accounts = listOf((await cf("/accounts")).result);
  const [only] = accounts;
  if (accounts.length !== 1 || !isRecord(only) || typeof only.id !== "string")
    throw new ReadError(`the token lists ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID`);
  return only.id;
}

let account = "";

/** One GraphQL Analytics dataset's rows; `args` holds only literals this script builds. */
async function gql(dataset: string, args: string, selection: string): Promise<unknown[]> {
  const query = `query($a: String!) { viewer { accounts(filter: {accountTag: $a}) { rows: ${dataset}(${args}) { ${selection} } } } }`;
  const json = await cf("/graphql", { query, variables: { a: account } });
  const accounts =
    isRecord(json.data) && isRecord(json.data.viewer) ? json.data.viewer.accounts : [];
  const [first] = listOf(accounts);
  return isRecord(first) ? listOf(first.rows) : [];
}

const SERVICE: TelemetryFilter = {
  key: "$metadata.service",
  operation: "eq",
  type: "string",
  value: API_WORKER,
};
const FETCH: TelemetryFilter = {
  key: "$workers.eventType",
  operation: "eq",
  type: "string",
  value: "fetch",
};
const ANSWERED: TelemetryFilter = {
  key: "$workers.event.response.status",
  operation: "gte",
  type: "number",
  value: 200,
};
const GROUPS_LIMIT = 1000;

type Calculation = { operator: string; key?: string; keyType?: "number" };
const wall = (operator: string): Calculation => ({
  operator,
  key: "$workers.wallTimeMs",
  keyType: "number",
});
const cpu = (operator: string): Calculation => ({
  operator,
  key: "$workers.cpuTimeMs",
  keyType: "number",
});
const COUNT: Calculation = { operator: "count" };

/** A Workers Logs aggregate query; it reads and stores nothing. */
async function logs(
  window: { from: number; to: number },
  calculations: Calculation[],
  filters: TelemetryFilter[],
  groupBys: string[] = [],
): Promise<unknown> {
  const json = await cf(`/accounts/${account}/workers/observability/telemetry/query`, {
    queryId: "prod-report",
    timeframe: window,
    view: "calculations",
    limit: 100,
    parameters: {
      datasets: ["cloudflare-workers"],
      filters,
      calculations,
      groupBys: groupBys.map((value) => ({ type: "string", value })),
      limit: GROUPS_LIMIT,
    },
  });
  return json.result;
}

/** At most `size` reads at a time, in order. */
async function inPool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i] as T);
      }
    }),
  );
  return out;
}

const signals: Signal[] = [];
/** Runs one read; a failure becomes a warn and the section prints `unreadable`. */
async function read<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ReadError)) throw error;
    signals.push({ level: "warn", label: "unreadable", detail: `${label} (${error.message})` });
    return undefined;
  }
}

/** The routes the Worker declares, from its own Hono table: a pattern this report prints is one
    the code declares, and a new route needs no list kept here. */
async function appRoutes(): Promise<Route[]> {
  const entry = join(API_ROOT, "src", "index.ts");
  const mod: unknown = await import(entry);
  const app = isRecord(mod) ? mod.default : undefined;
  return routePatterns(
    listOf(isRecord(app) ? app.routes : undefined).flatMap((r) =>
      isRecord(r) && typeof r.method === "string" && typeof r.path === "string"
        ? [{ method: r.method, path: r.path }]
        : [],
    ),
  );
}

// ---- Windows ----

const { days, release } = args;
const now = Date.now();
const dates = utcDates(now, days);
const today = isoDate(now);
const yesterday = isoDate(now - DAY_MS);
const first = dates[0] ?? today;
const range = { from: now - days * DAY_MS, to: now };
const logsDays = Math.min(days, LOGS_MAX_DAYS);
const logsRange = { from: now - logsDays * DAY_MS, to: now };
const sloRange = { from: now - SLO_DAYS * DAY_MS, to: now };
const timeFilter = (r: { from: number; to: number }) =>
  `datetime_geq: "${new Date(r.from).toISOString()}", datetime_leq: "${new Date(r.to).toISOString()}"`;
const dateFilter = `date_geq: "${first}", date_leq: "${today}"`;
const apiFilter = (r: { from: number; to: number }, extra = "") =>
  `limit: 1000, filter: {${timeFilter(r)}, scriptName: "${API_WORKER}"${extra}}`;

try {
  account = await accountId();
} catch (error) {
  console.error(`prod:report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const routes = await appRoutes();
const databaseId = databaseIdOf(readFileSync(join(API_ROOT, "wrangler.jsonc"), "utf8"));

// ---- Reads, in parallel ----

const [
  requestRows,
  d1Rows,
  kvRows,
  doRows,
  httpRows,
  statusRows,
  latencyRows,
  errorRows,
  sloRows,
  cronRows,
  doStatusRows,
  topByRows,
  topByTime,
] = await Promise.all([
  read("Workers requests", () =>
    gql(
      "workersInvocationsAdaptive",
      `limit: 10000, filter: {${dateFilter}}`,
      "dimensions { date } sum { requests }",
    ),
  ),
  read("D1 rows", () =>
    gql(
      "d1AnalyticsAdaptiveGroups",
      `limit: 10000, filter: {${dateFilter}}`,
      "dimensions { date } sum { rowsRead rowsWritten }",
    ),
  ),
  read("KV operations", () =>
    gql(
      "kvOperationsAdaptiveGroups",
      `limit: 10000, filter: {${dateFilter}}`,
      "dimensions { date actionType } sum { requests }",
    ),
  ),
  read("Durable Object storage", () =>
    gql(
      "durableObjectsPeriodicGroups",
      `limit: 10000, filter: {${dateFilter}}`,
      "dimensions { date } sum { rowsRead rowsWritten exceededCpuErrors exceededMemoryErrors fatalInternalErrors }",
    ),
  ),
  read("API requests by HTTP status", () =>
    gql(
      "workersInvocationsAdaptive",
      apiFilter(range),
      "dimensions { httpResponseStatus } sum { requests }",
    ),
  ),
  read("API invocation statuses", () =>
    gql(
      "workersInvocationsAdaptive",
      apiFilter(range),
      "dimensions { status eventType } sum { requests }",
    ),
  ),
  read("API CPU and wall time", () =>
    gql(
      "workersInvocationsAdaptive",
      apiFilter(range, ", httpResponseStatus_geq: 200"),
      "sum { requests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP95 wallTimeP99 } max { cpuTime }",
    ),
  ),
  read("API 5xx", () =>
    gql(
      "workersInvocationsAdaptive",
      apiFilter(range, ", httpResponseStatus_geq: 500"),
      "dimensions { date httpResponseStatus scriptVersion } sum { requests }",
    ),
  ),
  read("SLO availability", () =>
    gql(
      "workersInvocationsAdaptive",
      apiFilter(sloRange),
      "dimensions { httpResponseStatus } sum { requests }",
    ),
  ),
  // Always the last week: a date range that starts past the dataset's retention answers no rows
  // at all, which would read as a missing run.
  read("cron runs", () =>
    gql(
      "workersInvocationsAdaptive",
      `limit: 1000, filter: {date_geq: "${isoDate(now - 6 * DAY_MS)}", date_leq: "${today}", scriptName: "${API_WORKER}", eventType: "cron"}`,
      "dimensions { date status } sum { requests }",
    ),
  ),
  read("Durable Object invocations", () =>
    gql(
      "durableObjectsInvocationsAdaptiveGroups",
      `limit: 1000, filter: {${timeFilter(range)}}`,
      "dimensions { status } sum { requests }",
    ),
  ),
  ...(["sum_rowsRead_DESC", "sum_queryDurationMs_DESC"] as const).map((order) =>
    read(`D1 queries (${order})`, () =>
      databaseId === undefined
        ? Promise.reject(new ReadError("no database_id in wrangler.jsonc"))
        : gql(
            "d1QueriesAdaptiveGroups",
            `limit: 5, filter: {${timeFilter(range)}, databaseId: "${databaseId}"}, orderBy: [${order}]`,
            "dimensions { query } count sum { queryDurationMs rowsRead rowsWritten } quantiles { queryDurationMsP99 }",
          ),
    ),
  ),
]);

const logSlices = daySlices(logsRange.from, now);
const [logsPerDay, triggers, lineRows, quotaLines, matchRows, coreLatency] = await Promise.all([
  read("Workers Logs events per day", () =>
    inPool(logSlices, 4, async (slice) => ({
      date: slice.date,
      count: singleValue(await logs(slice, [COUNT], []), 0) ?? 0,
    })),
  ),
  read("Workers Logs triggers", async () =>
    aggregatesOf(await logs(logsRange, [COUNT], [SERVICE, FETCH, ANSWERED], ["$metadata.trigger"])),
  ),
  read("Workers Logs lines", async () =>
    aggregatesOf(
      await logs(
        logsRange,
        [COUNT],
        [SERVICE, { key: "evt", operation: "exists", type: "string" }],
        ["evt", "kind"],
      ),
    ),
  ),
  read("Workers Logs quota lines", async () =>
    singleValue(
      await logs(
        logsRange,
        [COUNT],
        [SERVICE, { key: "quota", operation: "eq", type: "boolean", value: true }],
      ),
      0,
    ),
  ),
  read("Workers Logs match lines", async () =>
    aggregatesOf(
      await logs(
        logsRange,
        [COUNT],
        [
          SERVICE,
          { key: "evt", operation: "eq", type: "string", value: "lobby" },
          { key: "kind", operation: "regex", type: "string", value: "^match_(started|ended)$" },
        ],
        ["kind", "cause"],
      ),
    ),
  ),
  read("SLO latency", async () => {
    const result = await logs(
      { from: now - Math.min(SLO_DAYS, LOGS_MAX_DAYS) * DAY_MS, to: now },
      [COUNT, wall("p95")],
      [
        SERVICE,
        FETCH,
        ANSWERED,
        { key: "$metadata.trigger", operation: "regex", type: "string", value: coreRouteRegex() },
      ],
    );
    return { requests: singleValue(result, 0) ?? 0, p95: singleValue(result, 1) };
  }),
]);

const routeCounts =
  triggers === undefined
    ? undefined
    : countByRoute(
        triggers.map((t) => ({ trigger: t.groups[0] ?? "", count: t.value })),
        routes,
      );
const routeStats =
  routeCounts === undefined
    ? undefined
    : await read("per-route latency", () =>
        inPool(
          [...routeCounts.byRoute.values()].sort((a, b) => b.count - a.count),
          4,
          async ({ route }) => {
            const result = await logs(
              logsRange,
              [
                COUNT,
                wall("median"),
                wall("p95"),
                wall("p99"),
                cpu("median"),
                cpu("p95"),
                cpu("p99"),
              ],
              [SERVICE, FETCH, ANSWERED, ...routeFilters(route, routes)],
            );
            return { route, values: [0, 1, 2, 3, 4, 5, 6].map((i) => singleValue(result, i)) };
          },
        ),
      );

// ---- Release ----

async function versionStats(id: string, window: { from: number; to: number }) {
  const version: TelemetryFilter = {
    key: "$workers.scriptVersion.id",
    operation: "eq",
    type: "string",
    value: id,
  };
  const [answered, errors, lines] = await Promise.all([
    logs(window, [COUNT, wall("p95")], [SERVICE, FETCH, ANSWERED, version]),
    logs(
      window,
      [COUNT],
      [
        SERVICE,
        FETCH,
        version,
        { key: "$workers.event.response.status", operation: "gte", type: "number", value: 500 },
      ],
    ),
    logs(
      window,
      [COUNT],
      [SERVICE, version, { key: "evt", operation: "exists", type: "string" }],
      ["evt", "kind"],
    ),
  ]);
  const requests = singleValue(answered, 0) ?? 0;
  const counts = new Map(aggregatesOf(lines).map((a) => [a.groups.join(" "), a.value]));
  return {
    id,
    requests,
    errors5xx: singleValue(errors, 0) ?? 0,
    ...(requests > 0 ? { wallP95: singleValue(answered, 1) } : {}),
    lines: Object.fromEntries(WATCHED_LINES.map((line) => [line, counts.get(line) ?? 0])),
  } satisfies VersionStats;
}

const releaseSection: string[] = [];
if (release) {
  const pair = await read("API deployments", async () => {
    const json = await cf(`/accounts/${account}/workers/scripts/${API_WORKER}/deployments`);
    return releasePair(isRecord(json.result) ? json.result.deployments : undefined);
  });
  releaseSection.push("", "== Release: the newest API version against the one it replaced");
  if (pair === undefined) releaseSection.push("unreadable");
  else {
    const deployedAt = Date.parse(pair.next.at);
    const since = { from: deployedAt, to: now };
    const before = {
      from: Math.max(deployedAt - (now - deployedAt), now - LOGS_MAX_DAYS * DAY_MS),
      to: deployedAt,
    };
    const stats = await read("release comparison", () =>
      Promise.all([
        versionStats(pair.next.id, since),
        pair.previous === undefined ? undefined : versionStats(pair.previous.id, before),
      ]),
    );
    const tag = await read("API version tag", async () =>
      versionTagOf(
        (await cf(`/accounts/${account}/workers/scripts/${API_WORKER}/versions/${pair.next.id}`))
          .result,
      ),
    );
    const hours = (now - deployedAt) / 3_600_000;
    releaseSection.push(
      `deployed ${new Date(deployedAt).toISOString().slice(0, 16).replace("T", " ")} UTC${tag ? ` from ${tag}` : ""}, ${hours.toFixed(1)} h ago; the previous version is read over the same span before it (Workers Logs)`,
    );
    if (stats === undefined) releaseSection.push("unreadable");
    else {
      const [next, previous] = stats;
      releaseSection.push(
        ...table(
          ["", "version", "requests", "5xx", "wall p95", "watched lines"],
          [versionRow("new", next), versionRow("previous", previous)],
        ),
        `watched lines: ${WATCHED_LINES.join(", ")}`,
      );
      signals.push(...releaseSignals(next, previous));
    }
  }
}

// ---- Sections ----

const out: string[] = [];
out.push(
  `colorless production report, ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  `window: ${days} d (${first} to ${today}, GraphQL); Workers Logs sections: last ${logsDays} d`,
);

// Usage against the Free quotas.
const quotas = quotaRows(
  quotaDaily({
    requests: requestRows,
    d1: d1Rows,
    kv: kvRows,
    durableObjects: doRows,
    logs: logsPerDay,
  }),
  today,
);
out.push(
  "",
  "== Usage against the Free quotas (whole account, per UTC day; today is partial)",
  ...quotaTable(quotas),
);
for (const row of quotas)
  signals.push({
    level: row.level,
    label: row.quota.label,
    detail:
      row.peak === undefined
        ? "unreadable"
        : `peak ${fmtInt(row.peak.value)} on ${row.peak.date} (warn ${fmtInt(row.quota.warn)}${row.quota.crit === undefined ? "" : `, crit ${fmtInt(row.quota.crit)}`})`,
  });

// API requests.
out.push("", `== API requests (${API_WORKER}, ${days} d)`);
if (httpRows === undefined) out.push("by HTTP status: unreadable");
else {
  const byStatus = new Map<number, number>();
  for (const r of httpRows) {
    const status = numAt(r, "dimensions", "httpResponseStatus");
    byStatus.set(status, (byStatus.get(status) ?? 0) + numAt(r, "sum", "requests"));
  }
  const answered = [...byStatus].filter(([s]) => isHttpAnswer(s)).sort((a, b) => b[1] - a[1]);
  const sessions = [...byStatus].filter(([s]) => !isHttpAnswer(s)).reduce((n, [, c]) => n + c, 0);
  out.push(
    `by HTTP status: ${answered.map(([s, n]) => `${s} ×${fmtInt(n)}`).join(", ") || "none"}`,
    `WebSocket sessions and cron runs (status below 200, left out of every latency figure): ${fmtInt(sessions)}`,
  );
}
if (statusRows !== undefined) {
  const byName = new Map<string, number>();
  for (const r of statusRows) {
    const name = strAt(r, "dimensions", "status");
    byName.set(name, (byName.get(name) ?? 0) + numAt(r, "sum", "requests"));
  }
  out.push(
    `invocation outcomes: ${[...byName].map(([s, n]) => `${s} ${fmtInt(n)}`).join(", ") || "none"}`,
  );
  const limited = [...byName].filter(([s, n]) => isLimitStatus(s) && n > 0);
  signals.push(
    limited.length === 0
      ? { level: "ok", label: "Worker limits", detail: "no invocation exceeded a limit" }
      : {
          level: "warn",
          label: "Worker limits",
          detail: limited.map(([s, n]) => `${s} ${fmtInt(n)}`).join(", "),
        },
  );
}
const [latency] = latencyRows ?? [];
if (latency !== undefined) {
  const us = (field: string, group = "quantiles") => fmtMs(numAt(latency, group, field) / 1000);
  out.push(
    `CPU p50 ${us("cpuTimeP50")}, p99 ${us("cpuTimeP99")}, max ${us("cpuTime", "max")} (Free reference 10 ms); wall p50 ${us("wallTimeP50")}, p95 ${us("wallTimeP95")}, p99 ${us("wallTimeP99")}`,
  );
} else if (latencyRows === undefined) out.push("CPU and wall time: unreadable");
if (doRows !== undefined || doStatusRows !== undefined) {
  const sum = (field: string) =>
    (doRows ?? []).reduce<number>((n, r) => n + numAt(r, "sum", field), 0);
  const requests = (doStatusRows ?? []).reduce<number>(
    (n, r) => n + numAt(r, "sum", "requests"),
    0,
  );
  const limits = ["exceededCpuErrors", "exceededMemoryErrors", "fatalInternalErrors"].map(
    (f) => [f, sum(f)] as const,
  );
  out.push(
    `LobbyDO: ${fmtInt(requests)} invocations; ${limits.map(([f, n]) => `${f} ${fmtInt(n)}`).join(", ")}`,
  );
  const hit = limits.filter(([, n]) => n > 0);
  signals.push(
    hit.length === 0
      ? { level: "ok", label: "Durable Object limits", detail: "none hit" }
      : {
          level: "warn",
          label: "Durable Object limits",
          detail: hit.map(([f, n]) => `${f} ${fmtInt(n)}`).join(", "),
        },
  );
}

// 5xx by day and version.
out.push("", `== 5xx answers by day and API version (${days} d)`);
if (errorRows === undefined) out.push("unreadable");
else if (errorRows.length === 0) out.push("none");
else
  out.push(
    ...table(
      ["date", "status", "version", "requests"],
      errorRows
        .map((r) => [
          strAt(r, "dimensions", "date"),
          strAt(r, "dimensions", "httpResponseStatus"),
          shortId(strAt(r, "dimensions", "scriptVersion")),
          fmtInt(numAt(r, "sum", "requests")),
        ])
        .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    ),
  );

// Per-route latency.
out.push(
  "",
  `== Latency by route (Workers Logs, ${logsDays} d; HTTP answers only, WebSocket sessions left out)`,
);
if (routeCounts === undefined || routeStats === undefined) out.push("unreadable");
else {
  out.push(
    ...table(
      ["route", "requests", "wall p50", "p95", "p99", "CPU p50", "p95", "p99"],
      routeStats.map(({ route, values: [n, ...ms] }) => [
        routeLabel(route),
        fmtInt(n ?? 0),
        ...ms.map((v) => (v === undefined ? "-" : fmtInt(v))),
      ]),
    ),
    "(milliseconds)",
  );
  if (routeCounts.unmatched > 0)
    out.push(`requests no route matches (scanners, typos): ${fmtInt(routeCounts.unmatched)}`);
  if ((triggers?.length ?? 0) >= GROUPS_LIMIT)
    signals.push({
      level: "warn",
      label: "per-route latency",
      detail: `Workers Logs returned ${GROUPS_LIMIT} triggers, the most it groups; routes may be missing`,
    });
}

// Top D1 queries.
const d1Table = (rows: unknown[] | undefined) =>
  rows === undefined
    ? ["unreadable"]
    : table(
        ["query shape", "runs", "rows read", "total ms", "p99 ms"],
        rows.map((r) => [
          sqlShape(strAt(r, "dimensions", "query")),
          fmtInt(numAt(r, "count")),
          fmtInt(numAt(r, "sum", "rowsRead")),
          fmtInt(numAt(r, "sum", "queryDurationMs")),
          numAt(r, "quantiles", "queryDurationMsP99").toFixed(1),
        ]),
      );
out.push(
  "",
  `== Top D1 queries on colorless (${days} d), by rows read`,
  ...d1Table(topByRows),
  "by total duration",
  ...d1Table(topByTime),
);

// Log lines.
out.push("", `== Log lines worth a look (Workers Logs, ${logsDays} d)`);
const lineCounts = new Map((lineRows ?? []).map((a) => [a.groups.join(" "), a.value]));
if (lineRows === undefined) out.push("unreadable");
else
  out.push(
    `${WATCHED_LINES.map((line) => `${line} ${fmtInt(lineCounts.get(line) ?? 0)}`).join(", ")}; quota:true ${quotaLines === undefined ? "unreadable" : fmtInt(quotaLines)}`,
  );
for (const line of ALERT_LINES) {
  const n = lineCounts.get(line);
  if (n !== undefined && n > 0)
    signals.push({ level: "warn", label: line, detail: `${fmtInt(n)} lines in ${logsDays} d` });
}
if (quotaLines !== undefined && quotaLines > 0)
  signals.push({
    level: "warn",
    label: "quota lines",
    detail: `${fmtInt(quotaLines)} lines with quota:true in ${logsDays} d`,
  });
if (cronRows === undefined) out.push("daily cron: unreadable");
else {
  const cron = cronSignal(
    cronRows.map((r) => ({
      date: strAt(r, "dimensions", "date"),
      status: strAt(r, "dimensions", "status"),
      requests: numAt(r, "sum", "requests"),
    })),
    yesterday,
  );
  out.push(`daily cron (GraphQL, 7 d): ${cron.detail}`);
  signals.push(cron);
}

// SLOs and matches.
out.push("", "== SLOs and online matches");
if (sloRows === undefined) out.push("SLO availability: unreadable");
else {
  const a = availability(
    sloRows.map((r) => ({
      status: numAt(r, "dimensions", "httpResponseStatus"),
      requests: numAt(r, "sum", "requests"),
    })),
  );
  out.push(availabilityLine(a));
  signals.push({ level: a.level, label: "SLO", detail: availabilityLine(a).replace(/^SLO /, "") });
}
const latencyDays = Math.min(SLO_DAYS, LOGS_MAX_DAYS);
if (coreLatency === undefined) out.push("SLO latency: unreadable");
else {
  const line = latencyLine(coreLatency.p95, coreLatency.requests, latencyDays);
  out.push(line, `core routes: ${CORE_PATHS.join(", ")}`);
  signals.push({
    level: latencyLevel(coreLatency.p95),
    label: "SLO",
    detail: line.replace(/^SLO /, ""),
  });
}
const missingCore = missingCorePaths(routes);
if (missingCore.length > 0)
  signals.push({
    level: "warn",
    label: "SLO latency",
    detail: `core paths the app no longer routes: ${missingCore.join(", ")}`,
  });
out.push(
  ...(matchRows === undefined
    ? ["match lines: unreadable"]
    : matchLines(
        matchRows.map((a) => ({
          kind: a.groups[0] ?? "",
          cause: a.groups[1] || undefined,
          count: a.value,
        })),
      )),
);

out.push(...releaseSection);
out.push("", "== Thresholds", ...signalLines(signals));
if (release)
  out.push("(a release finding is a warn: compare by hand, roll back with `wrangler rollback`)");

const text = out.join("\n");
const leaks = leaksIn(text);
if (leaks.length > 0) {
  console.error(
    `prod:report: refusing to print a report that appears to hold ${leaks.join(" and ")}`,
  );
  process.exit(2);
}
console.log(text);
process.exit(exitCodeOf(signals.map((s) => s.level)));
