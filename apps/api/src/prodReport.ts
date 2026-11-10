// What scripts/prod-report.ts concludes from its Cloudflare reads, as pure functions so vitest can
// test them; it sits beside releaseChecks.ts for that reason, and the Worker does not import it.
// Every line it formats holds counts, dates, route patterns from the app's own route table, HTTP
// statuses, Cloudflare's status names, version ids and SQL shapes with their literals removed:
// never a value a request or a log line carried.

export type Level = "ok" | "warn" | "crit";

const RANK: Record<Level, number> = { ok: 0, warn: 1, crit: 2 };

export const worstLevel = (levels: readonly Level[]): Level =>
  levels.reduce<Level>((worst, level) => (RANK[level] > RANK[worst] ? level : worst), "ok");

/** The report fails only on a crit: a warn is read, not acted on by a caller. */
export const exitCodeOf = (levels: readonly Level[]): number =>
  worstLevel(levels) === "crit" ? 1 : 0;

/** One line of the thresholds section. */
export type Signal = { level: Level; label: string; detail: string };

export type Threshold = { warn: number; crit?: number };

export function levelOf(value: number, threshold: Threshold): Level {
  if (threshold.crit !== undefined && value >= threshold.crit) return "crit";
  return value >= threshold.warn ? "warn" : "ok";
}

// ---- Reading Cloudflare's JSON ----

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const at = (row: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), row);

/** `row.a.b` as a number, 0 when absent. */
export const numAt = (row: unknown, ...path: string[]): number => {
  const value = at(row, path);
  return typeof value === "number" ? value : 0;
};

/** `row.a.b` as a string, "" when absent. */
export const strAt = (row: unknown, ...path: string[]): string => {
  const value = at(row, path);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

// ---- Arguments and windows ----

/** GraphQL's adaptive datasets keep about 31 days. */
export const MAX_DAYS = 30;
/** The most Workers Logs keep on Free; a longer window reads what is left. */
export const LOGS_MAX_DAYS = 7;
/** The SLO window, whatever `--days` says. */
export const SLO_DAYS = 7;

export type ReportArgs = { days: number; release: boolean };

export function parseArgs(argv: readonly string[]): ReportArgs | { error: string } {
  let days = 7;
  let release = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--release") release = true;
    else if (arg === "--days") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS)
        return { error: `--days takes a whole number from 1 to ${MAX_DAYS}` };
      days = value;
    } else return { error: `unknown argument ${arg}; use [--days N] [--release]` };
  }
  return { days, release };
}

export const DAY_MS = 86_400_000;

export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The `days` UTC dates ending with today's, oldest first. */
export function utcDates(now: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => isoDate(now - (days - 1 - i) * DAY_MS));
}

/** Each UTC day's slice of [from, now], oldest first; the first and the last are partial. */
export function daySlices(from: number, now: number): { date: string; from: number; to: number }[] {
  const slices: { date: string; from: number; to: number }[] = [];
  for (let start = from; start < now; ) {
    const end = Math.min(Date.parse(`${isoDate(start)}T00:00:00Z`) + DAY_MS, now);
    slices.push({ date: isoDate(start), from: start, to: end });
    start = end;
  }
  return slices;
}

// ---- Free quotas ----

export type QuotaKey =
  | "workersRequests"
  | "d1RowsRead"
  | "d1RowsWritten"
  | "kvReads"
  | "kvWrites"
  | "kvDeletes"
  | "kvLists"
  | "doRowsRead"
  | "doRowsWritten"
  | "logsEvents";

export type Quota = Threshold & { key: QuotaKey; label: string; limit: number };

/** The Workers Free daily limits the account shares across its Workers and databases: a warn at
    half the limit, a crit at 80%. A quota with no crit stops no shared flow when spent: Workers
    Logs drop events past the cap, and Durable Object storage is the lobby's alone. */
export const QUOTAS: readonly Quota[] = [
  { key: "workersRequests", label: "Workers requests", limit: 100_000, warn: 50_000, crit: 80_000 },
  { key: "d1RowsRead", label: "D1 rows read", limit: 5_000_000, warn: 2_500_000, crit: 4_000_000 },
  { key: "d1RowsWritten", label: "D1 rows written", limit: 100_000, warn: 50_000, crit: 80_000 },
  { key: "kvReads", label: "KV reads", limit: 100_000, warn: 50_000, crit: 80_000 },
  { key: "kvWrites", label: "KV writes", limit: 1_000, warn: 500, crit: 800 },
  { key: "kvDeletes", label: "KV deletes", limit: 1_000, warn: 500, crit: 800 },
  { key: "kvLists", label: "KV lists", limit: 1_000, warn: 500, crit: 800 },
  { key: "doRowsRead", label: "DO rows read", limit: 5_000_000, warn: 2_500_000 },
  { key: "doRowsWritten", label: "DO rows written", limit: 100_000, warn: 50_000 },
  { key: "logsEvents", label: "Workers Logs events", limit: 200_000, warn: 100_000 },
];

/** A KV `actionType` as GraphQL names it, to its quota. */
const KV_QUOTA: Readonly<Record<string, QuotaKey>> = {
  read: "kvReads",
  write: "kvWrites",
  delete: "kvDeletes",
  list: "kvLists",
};

export type Daily = Map<string, number>;

/** The GraphQL rows (`{ dimensions: { date }, sum }`) and Workers Logs counts each quota reads
    from; a source left undefined could not be read. */
export type QuotaSources = {
  requests?: readonly unknown[];
  d1?: readonly unknown[];
  kv?: readonly unknown[];
  durableObjects?: readonly unknown[];
  logs?: readonly { date: string; count: number }[];
};

/** Per-day totals for each quota whose source was read. */
export function quotaDaily(sources: QuotaSources): Partial<Record<QuotaKey, Daily>> {
  const daily: Partial<Record<QuotaKey, Daily>> = {};
  const add = (key: QuotaKey, date: string, n: number) => {
    const days = daily[key] ?? new Map<string, number>();
    days.set(date, (days.get(date) ?? 0) + n);
    daily[key] = days;
  };
  const dateOf = (row: unknown) => strAt(row, "dimensions", "date");
  const sumOf = (rows: readonly unknown[] | undefined, fields: [string, QuotaKey][]) => {
    if (rows === undefined) return;
    for (const [, key] of fields) daily[key] ??= new Map();
    for (const row of rows)
      for (const [field, key] of fields) add(key, dateOf(row), numAt(row, "sum", field));
  };
  sumOf(sources.requests, [["requests", "workersRequests"]]);
  sumOf(sources.d1, [
    ["rowsRead", "d1RowsRead"],
    ["rowsWritten", "d1RowsWritten"],
  ]);
  sumOf(sources.durableObjects, [
    ["rowsRead", "doRowsRead"],
    ["rowsWritten", "doRowsWritten"],
  ]);
  if (sources.kv !== undefined) {
    for (const key of Object.values(KV_QUOTA)) daily[key] ??= new Map();
    for (const row of sources.kv) {
      const key = KV_QUOTA[strAt(row, "dimensions", "actionType")];
      if (key !== undefined) add(key, dateOf(row), numAt(row, "sum", "requests"));
    }
  }
  if (sources.logs !== undefined) {
    daily.logsEvents = new Map();
    for (const { date, count } of sources.logs) add("logsEvents", date, count);
  }
  return daily;
}

export type QuotaRow = {
  quota: Quota;
  /** Undefined when its source could not be read. */
  peak?: { date: string; value: number };
  today: number;
  level: Level;
};

/** Each quota's busiest day in the window; a quota whose source failed is a warn. */
export function quotaRows(
  daily: Partial<Record<QuotaKey, Daily>>,
  today: string,
  quotas: readonly Quota[] = QUOTAS,
): QuotaRow[] {
  return quotas.map((quota) => {
    const days = daily[quota.key];
    if (days === undefined) return { quota, today: 0, level: "warn" };
    let peak = { date: today, value: 0 };
    for (const [date, value] of days) if (value > peak.value) peak = { date, value };
    return { quota, peak, today: days.get(today) ?? 0, level: levelOf(peak.value, quota) };
  });
}

// ---- Routes ----

export type Route = { method: string; path: string };

const segmentsOf = (path: string): string[] => path.split("/").filter((s) => s !== "");
const isParam = (segment: string) => segment.startsWith(":") || segment === "*";

/** The app's routes (Hono's `app.routes`) as distinct method and pattern pairs: middleware
    (`ALL`) dropped, and a HEAD beside every GET, since Hono answers HEAD with the GET handler. */
export function routePatterns(routes: readonly Route[]): Route[] {
  const seen = new Map<string, Route>();
  for (const { method, path } of routes) {
    if (method === "ALL" || path.includes("*")) continue;
    for (const m of method === "GET" ? ["GET", "HEAD"] : [method])
      seen.set(`${m} ${path}`, { method: m, path });
  }
  return [...seen.values()];
}

export const routeLabel = (route: Route): string => `${route.method} ${route.path}`;

function pathMatches(pattern: string, path: string): boolean {
  const want = segmentsOf(pattern);
  const got = segmentsOf(path);
  return want.length === got.length && want.every((s, i) => isParam(s) || s === got[i]);
}

/** The route a Workers Logs trigger (`GET /decks/abc`) was served by: the matching pattern with the
    most literal segments, so `/cards/index` wins over `/cards/:id`. */
export function routeOfTrigger(trigger: string, routes: readonly Route[]): Route | undefined {
  const space = trigger.indexOf(" ");
  if (space === -1) return undefined;
  const method = trigger.slice(0, space);
  const path = trigger.slice(space + 1).split("?")[0] ?? "";
  let best: Route | undefined;
  let bestLiterals = -1;
  for (const route of routes) {
    if (route.method !== method || !pathMatches(route.path, path)) continue;
    const literals = segmentsOf(route.path).filter((s) => !isParam(s)).length;
    if (literals > bestLiterals) [best, bestLiterals] = [route, literals];
  }
  return best;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pathRegex = (path: string): string =>
  segmentsOf(path)
    .map((s) => (isParam(s) ? "[^/]+" : escapeRegex(s)))
    .join("/");

/** A Workers Logs regex for `$metadata.trigger` that matches the pattern's requests. */
export const triggerRegex = (methods: string, path: string): string =>
  `^${methods} /${pathRegex(path)}$`;

export type TelemetryFilter = {
  key: string;
  operation: "eq" | "neq" | "gte" | "lt" | "regex" | "exists";
  type: "string" | "number" | "boolean";
  value?: string | number | boolean;
};

/** The trigger filters that select one route: its regex, less each literal route the regex also
    matches (`GET /cards/:id` would otherwise take `GET /cards/index`). */
export function routeFilters(route: Route, routes: readonly Route[]): TelemetryFilter[] {
  const regex: TelemetryFilter = {
    key: "$metadata.trigger",
    operation: "regex",
    type: "string",
    value: triggerRegex(escapeRegex(route.method), route.path),
  };
  const shadowed = routes.filter(
    (other) =>
      other !== route &&
      other.method === route.method &&
      !segmentsOf(other.path).some(isParam) &&
      pathMatches(route.path, other.path),
  );
  return [
    regex,
    ...shadowed.map(
      (other): TelemetryFilter => ({
        key: "$metadata.trigger",
        operation: "neq",
        type: "string",
        value: routeLabel(other),
      }),
    ),
  ];
}

/** Requests by route from per-trigger counts; a trigger no route matches (a scanner's path) is
    counted, never named. */
export function countByRoute(
  triggers: readonly { trigger: string; count: number }[],
  routes: readonly Route[],
): { byRoute: Map<string, { route: Route; count: number }>; unmatched: number } {
  const byRoute = new Map<string, { route: Route; count: number }>();
  let unmatched = 0;
  for (const { trigger, count } of triggers) {
    const route = routeOfTrigger(trigger, routes);
    if (route === undefined) {
      unmatched += count;
      continue;
    }
    const entry = byRoute.get(routeLabel(route)) ?? { route, count: 0 };
    entry.count += count;
    byRoute.set(routeLabel(route), entry);
  }
  return { byRoute, unmatched };
}

// ---- SLOs ----

export const AVAILABILITY_TARGET = 0.995;
export const LATENCY_P95_TARGET_MS = 500;
/** The routes the latency target covers: the signed-in flows and the catalog boot. The asset
    mirror, OAuth and WebSockets wait on other servers or on players, so they are left out. */
export const CORE_PATHS = ["/decks", "/decks/:id", "/auth/me", "/sets", "/cards/index"] as const;

export const coreRouteRegex = (): string => `^[A-Z]+ /(${CORE_PATHS.map(pathRegex).join("|")})$`;

/** Core paths the app no longer routes: the latency SLO would quietly cover less. */
export const missingCorePaths = (routes: readonly Route[]): string[] =>
  CORE_PATHS.filter((path) => !routes.some((route) => route.path === path));

/** A WebSocket session reports HTTP status 0 in GraphQL and 101 in Workers Logs, with the session's
    length as its wall time, so every request figure starts at 200. */
export const isHttpAnswer = (status: number): boolean => status >= 200;

export type Availability = {
  requests: number;
  errors: number;
  share: number;
  budget: number;
  level: Level;
};

export function availability(
  rows: readonly { status: number; requests: number }[],
  target = AVAILABILITY_TARGET,
): Availability {
  const answered = rows.filter((row) => isHttpAnswer(row.status));
  const requests = answered.reduce((sum, row) => sum + row.requests, 0);
  const errors = answered.filter((row) => row.status >= 500).reduce((s, r) => s + r.requests, 0);
  const share = requests === 0 ? 1 : 1 - errors / requests;
  return {
    requests,
    errors,
    share,
    budget: Math.floor(requests * (1 - target)),
    level: share >= target ? "ok" : "warn",
  };
}

export function availabilityLine(a: Availability, days = SLO_DAYS): string {
  return [
    `SLO availability (${days} d): ${fmtPct(a.share, 2)} of ${fmtInt(a.requests)} API requests not 5xx`,
    `(target ${fmtPct(AVAILABILITY_TARGET, 1)}; ${fmtInt(a.errors)} 5xx against a budget of ${fmtInt(a.budget)})`,
    a.level === "ok" ? "met" : "MISSED",
  ].join(" ");
}

export function latencyLine(p95: number | undefined, requests: number, days: number): string {
  if (requests === 0 || p95 === undefined)
    return `SLO latency (${days} d): no core-route requests in Workers Logs`;
  const met = p95 < LATENCY_P95_TARGET_MS;
  return `SLO latency (${days} d): p95 wall ${fmtMs(p95)} over ${fmtInt(requests)} core-route requests (target under ${LATENCY_P95_TARGET_MS} ms) ${met ? "met" : "MISSED"}`;
}

export const latencyLevel = (p95: number | undefined): Level =>
  p95 !== undefined && p95 >= LATENCY_P95_TARGET_MS ? "warn" : "ok";

// ---- Online matches ----

/** `match_ended`'s causes: the engine's reasons for a win, a tie, and the two forfeits. Any other
    value is printed as `other`, never by name. */
export const MATCH_CAUSES = [
  "prizesTaken",
  "noPokemon",
  "deckOut",
  "cardEffect",
  "conceded",
  "tie",
  "left",
  "abandoned",
] as const;
/** The ending that is not a finished game: a player who disconnected and never came back, which
    is what a desync or a client crash looks like from the lobby. */
const UNFINISHED = new Set<string>(["abandoned"]);

export function matchLines(
  rows: readonly { kind: string; cause: string | undefined; count: number }[],
): string[] {
  const started = rows
    .filter((r) => r.kind === "match_started")
    .reduce((sum, r) => sum + r.count, 0);
  const ended = rows.filter((r) => r.kind === "match_ended");
  if (started === 0 && ended.length === 0) return ["no match lines yet"];
  const byCause = new Map<string, number>();
  for (const { cause, count } of ended) {
    const known = MATCH_CAUSES.find((c) => c === cause) ?? "other";
    byCause.set(known, (byCause.get(known) ?? 0) + count);
  }
  const total = [...byCause.values()].reduce((sum, n) => sum + n, 0);
  const completed = [...byCause].filter(([c]) => !UNFINISHED.has(c)).reduce((s, [, n]) => s + n, 0);
  const causes = [...MATCH_CAUSES, "other"]
    .filter((c) => byCause.has(c))
    .map((c) => `${c} ${fmtInt(byCause.get(c) ?? 0)}`);
  return [
    started === 0
      ? `match completion: ${fmtInt(completed)} completed, but no match_started line in the window`
      : `match completion: ${fmtInt(completed)} of ${fmtInt(started)} started (${fmtPct(completed / started, 0)})`,
    `ended ${fmtInt(total)}${causes.length > 0 ? `: ${causes.join(", ")}` : ""}; not ended (still playing, retired, wiped or kicked) ${fmtInt(Math.max(started - total, 0))}`,
  ];
}

// ---- Cron and resource limits ----

/** The daily cron's record: yesterday must hold a run and every run must have succeeded. */
export function cronSignal(
  rows: readonly { date: string; status: string; requests: number }[],
  yesterday: string,
): Signal {
  const ran = rows.filter((r) => r.date === yesterday && r.requests > 0);
  const failed = rows.filter((r) => r.status !== "success" && r.requests > 0);
  if (ran.length === 0) return { level: "crit", label: "cron", detail: `no run on ${yesterday}` };
  if (failed.some((r) => r.date === yesterday))
    return { level: "crit", label: "cron", detail: `the ${yesterday} run did not succeed` };
  if (failed.length > 0)
    return {
      level: "warn",
      label: "cron",
      detail: `runs that did not succeed on ${[...new Set(failed.map((r) => r.date))].join(", ")}`,
    };
  return { level: "ok", label: "cron", detail: `ran on ${yesterday}` };
}

/** Invocation statuses that mean a Free limit stopped the Worker. */
export const isLimitStatus = (status: string): boolean => /^exceeded/i.test(status);

// ---- Releases ----

/** Log kinds a release can introduce that no health probe sees. */
export const WATCHED_LINES = [
  "http unhandled",
  "http invalid_request",
  "lobby match_retired",
  "lobby handoff_failed",
  "lobby action_threw",
] as const;

/** Lines whose presence in any window is a warn: a retired match or a failed handoff. */
export const ALERT_LINES = ["lobby match_retired", "lobby handoff_failed"] as const;

export type VersionStats = {
  id: string;
  requests: number;
  errors5xx: number;
  wallP95?: number;
  lines: Readonly<Record<string, number>>;
};

/** Below this many requests per version, a ratio is noise: the comparison judges presence. */
export const RELEASE_MIN_REQUESTS = 20;
export const RELEASE_P95_FACTOR = 2;

export function releaseSignals(next: VersionStats, previous?: VersionStats): Signal[] {
  const label = `release ${shortId(next.id)}`;
  const signals: Signal[] = [];
  if (next.errors5xx > 0)
    signals.push({ level: "warn", label, detail: `${fmtInt(next.errors5xx)} 5xx answers` });
  for (const line of WATCHED_LINES) {
    const n = next.lines[line] ?? 0;
    if (n > 0) signals.push({ level: "warn", label, detail: `${fmtInt(n)} ${line} lines` });
  }
  if (
    previous?.wallP95 !== undefined &&
    next.wallP95 !== undefined &&
    next.requests >= RELEASE_MIN_REQUESTS &&
    previous.requests >= RELEASE_MIN_REQUESTS &&
    next.wallP95 > RELEASE_P95_FACTOR * previous.wallP95
  )
    signals.push({
      level: "warn",
      label,
      detail: `wall p95 ${fmtMs(next.wallP95)} against ${fmtMs(previous.wallP95)} before`,
    });
  if (signals.length === 0)
    signals.push({
      level: "ok",
      label,
      detail:
        next.requests < RELEASE_MIN_REQUESTS
          ? `nothing new seen in ${fmtInt(next.requests)} requests (too few to compare latency)`
          : "no regression seen",
    });
  return signals;
}

export function versionRow(role: string, v: VersionStats | undefined): string[] {
  if (v === undefined) return [role, "-", "-", "-", "-", "-"];
  const rate = v.requests === 0 ? "-" : fmtPct(v.errors5xx / v.requests, 1);
  const lines = WATCHED_LINES.map((line) => v.lines[line] ?? 0).reduce((s, n) => s + n, 0);
  return [
    role,
    shortId(v.id),
    fmtInt(v.requests),
    `${fmtInt(v.errors5xx)} (${rate})`,
    fmtMs(v.wallP95),
    fmtInt(lines),
  ];
}

// ---- D1 ----

/** A query's shape: string, blob and number literals become `?`, a double-quoted token that is not
    a plain identifier (SQLite reads it as a string) too, and it is cut to `max` characters. An
    operator's ad hoc `wrangler d1 execute` can inline a value; the shape never carries it. */
export function sqlShape(sql: string, max = 90): string {
  const shape = sql
    .replace(/[xX]?'(?:[^']|'')*'/g, "?")
    .replace(/"([^"]*)"/g, (whole, inner: string) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) ? whole : "?",
    )
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return shape.length > max ? `${shape.slice(0, max - 1)}…` : shape;
}

/** `d1_databases[].database_id` from apps/api/wrangler.jsonc, read from a line that is not
    commented out. */
export const databaseIdOf = (config: string): string | undefined =>
  /^\s*"database_id"\s*:\s*"([^"]+)"/m.exec(config)?.[1];

// ---- Workers Logs answers and the deployments list ----

export type Aggregate = { groups: string[]; value: number };

/** One calculation's groups from a Workers Logs `view: "calculations"` result. A calculation with
    no group by has one aggregate with no groups. */
export function aggregatesOf(result: unknown, index = 0): Aggregate[] {
  const calculation = isRecord(result) ? listOf(result.calculations)[index] : undefined;
  if (!isRecord(calculation)) return [];
  return listOf(calculation.aggregates).flatMap((aggregate): Aggregate[] => {
    if (!isRecord(aggregate)) return [];
    const value = typeof aggregate.value === "number" ? aggregate.value : aggregate.count;
    if (typeof value !== "number") return [];
    const groups = listOf(aggregate.groups).map((g) =>
      isRecord(g) && g.value !== undefined && g.value !== null ? String(g.value) : "",
    );
    return [{ groups, value }];
  });
}

/** The value of a calculation with no group by. */
export const singleValue = (result: unknown, index: number): number | undefined =>
  aggregatesOf(result, index)[0]?.value;

export type Deployed = { id: string; at: string };

/** The API's newest deployment and the version it replaced, from the deployments list (newest
    first or not): a deployment's version is the one taking the most traffic. */
export function releasePair(
  deployments: unknown,
): { next: Deployed; previous?: Deployed } | undefined {
  const parsed = listOf(deployments)
    .flatMap((d): Deployed[] => {
      if (!isRecord(d) || typeof d.created_on !== "string") return [];
      const versions = listOf(d.versions).filter(isRecord);
      const main = versions.sort((a, b) => Number(b.percentage) - Number(a.percentage))[0];
      if (main === undefined || typeof main.version_id !== "string") return [];
      return [{ id: main.version_id, at: d.created_on }];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const [next] = parsed;
  if (next === undefined) return undefined;
  const previous = parsed.find((d) => d.id !== next.id);
  return previous === undefined ? { next } : { next, previous };
}

/** The commit a version was deployed from (`wrangler deploy --tag`), from the version's details,
    which also carry its uploader: only a short hex tag is taken from them. */
export function versionTagOf(version: unknown): string | undefined {
  const tag =
    isRecord(version) && isRecord(version.annotations)
      ? version.annotations["workers/tag"]
      : undefined;
  return typeof tag === "string" && /^[0-9a-f]{7,40}$/.test(tag) ? tag : undefined;
}

// ---- Output ----

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtInt = (n: number): string => intFormat.format(Math.round(n));

export const fmtMs = (ms: number | undefined): string =>
  ms === undefined || Number.isNaN(ms) ? "-" : `${fmtInt(ms)} ms`;

export const fmtPct = (share: number, digits: number): string =>
  `${(share * 100).toFixed(digits)}%`;

export const shortId = (id: string): string => id.slice(0, 8);

/** Columns padded to their widest cell; the first is left-aligned, the rest right-aligned. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => (row[i] ?? "").length)));
  return all.map((row) =>
    row
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
}

export function quotaTable(rows: readonly QuotaRow[]): string[] {
  return table(
    ["quota / UTC day", "peak", "on", "of limit", "today", "limit", "warn", "crit", ""],
    rows.map(({ quota, peak, today, level }) =>
      peak === undefined
        ? [quota.label, "unreadable", "", "", "", fmtInt(quota.limit), "", "", level]
        : [
            quota.label,
            fmtInt(peak.value),
            peak.date,
            fmtPct(peak.value / quota.limit, 1),
            fmtInt(today),
            fmtInt(quota.limit),
            fmtInt(quota.warn),
            quota.crit === undefined ? "-" : fmtInt(quota.crit),
            level,
          ],
    ),
  );
}

export function signalLines(signals: readonly Signal[]): string[] {
  const raised = signals.filter((s) => s.level !== "ok");
  if (raised.length === 0) return [`all clear: ${signals.length} signals ok`];
  return [
    ...raised
      .sort((a, b) => RANK[b.level] - RANK[a.level])
      .map((s) => `${s.level.toUpperCase().padEnd(4)}  ${s.label}: ${s.detail}`),
    `${signals.length - raised.length} other signals ok`,
  ];
}

/** What the report must never print, whatever a source returned. */
const LEAKS: readonly [string, RegExp][] = [
  ["an email address", /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ["an IPv4 address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["an IPv6 address", /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){3,7}\b/i],
];

/** The kinds of personal data `text` appears to hold; empty when it is fit to print. */
export const leaksIn = (text: string): string[] =>
  LEAKS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
