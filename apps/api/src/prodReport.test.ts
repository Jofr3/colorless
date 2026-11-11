import { describe, expect, it } from "vitest";
import {
  aggregatesOf,
  availability,
  availabilityLine,
  coreRouteRegex,
  countByRoute,
  cronSignal,
  DAY_MS,
  daySlices,
  databaseIdOf,
  exitCodeOf,
  isHttpAnswer,
  isLimitStatus,
  LATENCY_P95_TARGET_MS,
  latencyLevel,
  latencyLine,
  leaksIn,
  levelOf,
  matchLines,
  missingCorePaths,
  parseArgs,
  QUOTAS,
  quotaDaily,
  quotaRows,
  quotaTable,
  type Route,
  releasePair,
  releaseSignals,
  routeFilters,
  routeOfTrigger,
  routePatterns,
  signalLines,
  singleValue,
  sqlShape,
  table,
  triggerRegex,
  utcDates,
  type VersionStats,
  versionTagOf,
  worstLevel,
} from "./prodReport";

const NOW = Date.parse("2026-11-10T12:30:00Z");

describe("arguments and windows", () => {
  it("defaults to 7 days without the release comparison", () => {
    expect(parseArgs([])).toEqual({ days: 7, release: false });
    expect(parseArgs(["--days", "30", "--release"])).toEqual({ days: 30, release: true });
  });

  it("refuses a window GraphQL does not keep, and unknown flags", () => {
    for (const bad of [["--days", "0"], ["--days", "31"], ["--days", "2.5"], ["--days"], ["-d"]])
      expect(parseArgs(bad)).toHaveProperty("error");
  });

  it("lists the UTC dates ending today", () => {
    expect(utcDates(NOW, 3)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
  });

  it("cuts a window at UTC midnight, partial at both ends", () => {
    const slices = daySlices(NOW - 2 * DAY_MS, NOW);
    expect(slices.map((s) => s.date)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(new Date(slices[0]?.to ?? 0).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(slices[0]?.from).toBe(NOW - 2 * DAY_MS);
    expect(slices.at(-1)?.to).toBe(NOW);
    for (let i = 1; i < slices.length; i++) expect(slices[i]?.from).toBe(slices[i - 1]?.to);
  });
});

describe("levels", () => {
  it("crit at or over the crit, warn at or over the warn", () => {
    const t = { warn: 500, crit: 800 };
    expect([499, 500, 799, 800].map((v) => levelOf(v, t))).toEqual(["ok", "warn", "warn", "crit"]);
    expect(levelOf(1_000_000, { warn: 10 })).toBe("warn");
  });

  it("exits non-zero only on a crit", () => {
    expect(exitCodeOf(["ok", "warn", "warn"])).toBe(0);
    expect(exitCodeOf(["ok", "crit", "warn"])).toBe(1);
    expect(worstLevel([])).toBe("ok");
  });

  it("names every raised signal, crit first, or prints one all-clear line", () => {
    expect(signalLines([{ level: "ok", label: "cron", detail: "ran" }])).toEqual([
      "all clear: 1 signals ok",
    ]);
    expect(
      signalLines([
        { level: "warn", label: "a", detail: "x" },
        { level: "ok", label: "b", detail: "y" },
        { level: "crit", label: "c", detail: "z" },
      ]),
    ).toEqual(["CRIT  c: z", "WARN  a: x", "1 other signals ok"]);
  });
});

describe("quotas", () => {
  const row = (date: string, sum: Record<string, number>, extra: Record<string, string> = {}) => ({
    dimensions: { date, ...extra },
    sum,
  });

  it("sums each day across the account's Workers and databases", () => {
    const daily = quotaDaily({
      requests: [row("2026-11-09", { requests: 100 }), row("2026-11-09", { requests: 57 })],
      d1: [row("2026-11-09", { rowsRead: 46_000, rowsWritten: 10 })],
      kv: [
        row("2026-11-09", { requests: 21 }, { actionType: "read" }),
        row("2026-11-09", { requests: 5 }, { actionType: "write" }),
        row("2026-11-09", { requests: 9 }, { actionType: "rename" }),
      ],
    });
    expect(daily.workersRequests?.get("2026-11-09")).toBe(157);
    expect(daily.d1RowsRead?.get("2026-11-09")).toBe(46_000);
    expect(daily.d1RowsWritten?.get("2026-11-09")).toBe(10);
    expect(daily.kvReads?.get("2026-11-09")).toBe(21);
    expect(daily.kvWrites?.get("2026-11-09")).toBe(5);
    expect(daily.kvLists?.size).toBe(0);
    expect(daily.doRowsWritten).toBeUndefined();
  });

  it("rates each quota by its busiest day, and an unread source as a warn", () => {
    const rows = quotaRows(
      quotaDaily({
        kv: [
          row("2026-11-08", { requests: 820 }, { actionType: "write" }),
          row("2026-11-10", { requests: 3 }, { actionType: "write" }),
        ],
        logs: [{ date: "2026-11-10", count: 97 }],
      }),
      "2026-11-10",
    );
    const of = (label: string) => rows.find((r) => r.quota.label === label);
    expect(of("KV writes")).toMatchObject({
      peak: { date: "2026-11-08", value: 820 },
      today: 3,
      level: "crit",
    });
    expect(of("KV reads")).toMatchObject({ peak: { value: 0 }, level: "ok" });
    expect(of("Workers Logs events")).toMatchObject({ today: 97, level: "ok" });
    expect(of("D1 rows read")).toMatchObject({ level: "warn" });
    expect(of("D1 rows read")?.peak).toBeUndefined();
    expect(quotaTable(rows).find((line) => line.startsWith("D1 rows read"))).toContain(
      "unreadable",
    );
  });

  it("warns at half of every limit and stops at 80%", () => {
    for (const quota of QUOTAS) {
      expect(quota.warn).toBe(quota.limit / 2);
      if (quota.crit !== undefined) expect(quota.crit).toBe(quota.limit * 0.8);
    }
  });
});

describe("routes", () => {
  const routes = routePatterns([
    { method: "ALL", path: "/*" },
    { method: "GET", path: "/cards/:id" },
    { method: "GET", path: "/cards/index" },
    { method: "GET", path: "/cards/index" },
    { method: "GET", path: "/decks/:id" },
    { method: "PATCH", path: "/decks/:id" },
    { method: "GET", path: "/auth/oauth/:provider" },
    { method: "GET", path: "/auth/oauth/:provider/callback" },
  ]);

  it("drops middleware, dedupes, and serves HEAD with every GET", () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /cards/:id",
      "HEAD /cards/:id",
      "GET /cards/index",
      "HEAD /cards/index",
      "GET /decks/:id",
      "HEAD /decks/:id",
      "PATCH /decks/:id",
      "GET /auth/oauth/:provider",
      "HEAD /auth/oauth/:provider",
      "GET /auth/oauth/:provider/callback",
      "HEAD /auth/oauth/:provider/callback",
    ]);
  });

  it("maps a trigger to its pattern, a literal route winning over a parameter", () => {
    const of = (trigger: string) => {
      const r = routeOfTrigger(trigger, routes);
      return r && `${r.method} ${r.path}`;
    };
    expect(of("GET /cards/index")).toBe("GET /cards/index");
    expect(of("HEAD /cards/index")).toBe("HEAD /cards/index");
    expect(of("GET /cards/sv1-4")).toBe("GET /cards/:id");
    expect(of("PATCH /decks/0f3a")).toBe("PATCH /decks/:id");
    expect(of("GET /auth/oauth/google/callback?code=x")).toBe("GET /auth/oauth/:provider/callback");
    expect(of("DELETE /cards/index")).toBeUndefined();
    expect(of("HEAD /nope%0A")).toBeUndefined();
    expect(of("17 4 * * *")).toBeUndefined();
  });

  it("counts unmatched triggers without naming them", () => {
    const { byRoute, unmatched } = countByRoute(
      [
        { trigger: "GET /decks/a", count: 2 },
        { trigger: "GET /decks/b", count: 3 },
        { trigger: "GET /wp-login.php", count: 4 },
      ],
      routes,
    );
    expect([...byRoute.keys()]).toEqual(["GET /decks/:id"]);
    expect(byRoute.get("GET /decks/:id")?.count).toBe(5);
    expect(unmatched).toBe(4);
  });

  it("selects a parameter route less the literal routes its regex also matches", () => {
    const of = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path) as Route;
    expect(routeFilters(of("GET", "/cards/:id"), routes)).toEqual([
      {
        key: "$metadata.trigger",
        operation: "regex",
        type: "string",
        value: "^GET /cards/[^/]+$",
      },
      { key: "$metadata.trigger", operation: "neq", type: "string", value: "GET /cards/index" },
    ]);
    expect(routeFilters(of("GET", "/cards/index"), routes)).toHaveLength(1);
    expect(routeFilters(of("PATCH", "/decks/:id"), routes)).toHaveLength(1);
  });

  it("builds regexes that match the pattern's triggers only", () => {
    const regex = new RegExp(triggerRegex("GET", "/auth/oauth/:provider"));
    expect(regex.test("GET /auth/oauth/google")).toBe(true);
    expect(regex.test("GET /auth/oauth/google/callback")).toBe(false);
    expect(regex.test("POST /auth/oauth/google")).toBe(false);
    const core = new RegExp(coreRouteRegex());
    for (const hit of [
      "GET /decks",
      "PATCH /decks/abc",
      "GET /auth/me",
      "GET /sets",
      "HEAD /cards/index",
    ])
      expect(core.test(hit)).toBe(true);
    for (const miss of ["GET /decks/a/b", "GET /sets/sv1", "GET /assets/cards/a/b", "GET /cards"])
      expect(core.test(miss)).toBe(false);
  });

  it("names a core path the app no longer routes", () => {
    expect(missingCorePaths(routes)).toEqual(["/decks", "/auth/me", "/sets"]);
  });
});

describe("SLOs", () => {
  it("leaves WebSocket sessions out: status 0 in GraphQL, 101 in Workers Logs", () => {
    expect([0, 101, 200, 304, 502].map(isHttpAnswer)).toEqual([false, false, true, true, true]);
  });

  it("measures availability over HTTP answers, counting every 5xx", () => {
    const a = availability([
      { status: 0, requests: 29 },
      { status: 101, requests: 3 },
      { status: 200, requests: 990 },
      { status: 404, requests: 5 },
      { status: 500, requests: 1 },
      { status: 502, requests: 4 },
    ]);
    expect(a).toMatchObject({ requests: 1000, errors: 5, budget: 5, level: "ok" });
    expect(a.share).toBeCloseTo(0.995);
    expect(availabilityLine(a)).toBe(
      "SLO availability (7 d): 99.50% of 1,000 API requests not 5xx (target 99.5%; 5 5xx against a budget of 5) met",
    );
    expect(
      availability([
        { status: 200, requests: 994 },
        { status: 503, requests: 6 },
      ]).level,
    ).toBe("warn");
    expect(availability([]).level).toBe("ok");
  });

  it("misses the latency target at its value, and has nothing to judge with no requests", () => {
    expect(latencyLevel(LATENCY_P95_TARGET_MS - 1)).toBe("ok");
    expect(latencyLevel(LATENCY_P95_TARGET_MS)).toBe("warn");
    expect(latencyLevel(undefined)).toBe("ok");
    expect(latencyLine(1102, 27, 7)).toBe(
      "SLO latency (7 d): p95 wall 1,102 ms over 27 core-route requests (target under 500 ms) MISSED",
    );
    expect(latencyLine(undefined, 0, 3)).toBe(
      "SLO latency (3 d): no core-route requests in Workers Logs",
    );
  });
});

describe("matches", () => {
  it("says so when no match line exists yet", () => {
    expect(matchLines([])).toEqual(["no match lines yet"]);
  });

  it("counts every ending but an abandoned seat as completed, and an unknown cause as other", () => {
    expect(
      matchLines([
        { kind: "match_started", cause: undefined, count: 12 },
        { kind: "match_ended", cause: "prizesTaken", count: 5 },
        { kind: "match_ended", cause: "conceded", count: 1 },
        { kind: "match_ended", cause: "tie", count: 1 },
        { kind: "match_ended", cause: "left", count: 1 },
        { kind: "match_ended", cause: "abandoned", count: 2 },
        { kind: "match_ended", cause: "a typed reason", count: 1 },
      ]),
    ).toEqual([
      "match completion: 9 of 12 started (75%)",
      "ended 11: prizesTaken 5, conceded 1, tie 1, left 1, abandoned 2, other 1; not ended (still playing, retired or wiped) 1",
    ]);
  });

  it("reports ended matches whose start fell outside the window", () => {
    expect(matchLines([{ kind: "match_ended", cause: "deckOut", count: 2 }])[0]).toBe(
      "match completion: 2 completed, but no match_started line in the window",
    );
  });
});

describe("cron and limits", () => {
  const run = (date: string, status = "success") => ({ date, status, requests: 1 });

  it("is crit when yesterday has no run or a failed one, warn for an older failure", () => {
    expect(cronSignal([run("2026-11-08"), run("2026-11-10")], "2026-11-09").level).toBe("crit");
    expect(cronSignal([run("2026-11-09", "scriptThrewException")], "2026-11-09").level).toBe(
      "crit",
    );
    expect(cronSignal([run("2026-11-08", "exceededCpu"), run("2026-11-09")], "2026-11-09")).toEqual(
      { level: "warn", label: "cron", detail: "runs that did not succeed on 2026-11-08" },
    );
    expect(cronSignal([run("2026-11-09")], "2026-11-09").level).toBe("ok");
  });

  it("knows the statuses that mean a limit stopped the Worker", () => {
    expect(["exceededCpu", "exceededMemory", "exceededResources"].every(isLimitStatus)).toBe(true);
    expect(["success", "clientDisconnected", "scriptThrewException"].some(isLimitStatus)).toBe(
      false,
    );
  });
});

describe("the release comparison", () => {
  const version = (over: Partial<VersionStats>): VersionStats => ({
    id: "99fbfdba-9bd6-4bae-a01b-5f223c6c6c3b",
    requests: 30,
    errors5xx: 0,
    wallP95: 100,
    lines: {},
    ...over,
  });

  it("flags any new 5xx and any watched line, whatever the traffic", () => {
    const signals = releaseSignals(
      version({ requests: 4, errors5xx: 1, lines: { "lobby match_retired": 2 } }),
      version({}),
    );
    expect(signals.map((s) => [s.level, s.detail])).toEqual([
      ["warn", "1 5xx answers"],
      ["warn", "2 lobby match_retired lines"],
    ]);
  });

  it("compares p95 only when both versions served enough requests", () => {
    expect(releaseSignals(version({ wallP95: 250 }), version({ wallP95: 100 }))[0]?.level).toBe(
      "warn",
    );
    expect(releaseSignals(version({ wallP95: 200 }), version({ wallP95: 100 }))[0]?.level).toBe(
      "ok",
    );
    expect(
      releaseSignals(version({ wallP95: 900 }), version({ wallP95: 100, requests: 8 }))[0]?.level,
    ).toBe("ok");
    expect(releaseSignals(version({ requests: 5, wallP95: 900 }))[0]).toMatchObject({
      level: "ok",
      detail: "nothing new seen in 5 requests (too few to compare latency)",
    });
  });

  it("takes the newest deployment and the version before it", () => {
    const deployment = (at: string, versions: { version_id: string; percentage: number }[]) => ({
      created_on: at,
      versions,
    });
    expect(
      releasePair([
        deployment("2026-11-09T20:55:12Z", [{ version_id: "old", percentage: 100 }]),
        deployment("2026-11-10T09:11:04Z", [
          { version_id: "canary", percentage: 10 },
          { version_id: "new", percentage: 90 },
        ]),
        deployment("2026-11-10T08:32:18Z", [{ version_id: "new", percentage: 100 }]),
      ]),
    ).toEqual({
      next: { id: "new", at: "2026-11-10T09:11:04Z" },
      previous: { id: "old", at: "2026-11-09T20:55:12Z" },
    });
    expect(releasePair(undefined)).toBeUndefined();
  });

  it("takes only a hex tag from a version's details", () => {
    expect(versionTagOf({ annotations: { "workers/tag": "0a8feadf" } })).toBe("0a8feadf");
    expect(versionTagOf({ annotations: { "workers/tag": "someone@example.com" } })).toBeUndefined();
    expect(versionTagOf({})).toBeUndefined();
  });
});

describe("reading Cloudflare's answers", () => {
  it("reads a Workers Logs calculation's groups and single values", () => {
    const result = {
      calculations: [
        {
          aggregates: [
            {
              groups: [
                { key: "evt", value: "lobby" },
                { key: "kind", value: "match_ended" },
              ],
              value: 3,
            },
            { groups: [{ key: "evt", value: "http" }], count: 2 },
          ],
        },
        { aggregates: [{ value: 117.5 }] },
      ],
    };
    expect(aggregatesOf(result)).toEqual([
      { groups: ["lobby", "match_ended"], value: 3 },
      { groups: ["http"], value: 2 },
    ]);
    expect(singleValue(result, 1)).toBe(117.5);
    expect(singleValue(result, 2)).toBeUndefined();
    expect(aggregatesOf(null)).toEqual([]);
  });

  it("reads the database id from a line that is not commented out", () => {
    expect(
      databaseIdOf('  // "database_id": "stale",\n      "database_id": "f84cf768-0fd9",\n'),
    ).toBe("f84cf768-0fd9");
  });
});

describe("what the report prints", () => {
  it("keeps a query's shape and drops its literals", () => {
    expect(sqlShape("SELECT * FROM users WHERE email = 'a@b.co' AND id = 42")).toBe(
      "SELECT * FROM users WHERE email = ? AND id = ?",
    );
    expect(sqlShape('select "id" from "users" where "email" = "x@y.z"')).toBe(
      'select "id" from "users" where "email" = ?',
    );
    expect(sqlShape("SELECT\n  x'00ff', 'it''s'\nFROM t1")).toBe("SELECT ?, ? FROM t1");
    expect(sqlShape("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("pads columns, the first to the left", () => {
    expect(
      table(
        ["route", "n"],
        [
          ["GET /sets", "11"],
          ["GET /a", "5"],
        ],
      ),
    ).toEqual(["route       n", "GET /sets  11", "GET /a      5"]);
  });

  it("finds an address, and passes the report's own dates, times and version ids", () => {
    expect(leaksIn("from 203.0.113.9")).toEqual(["an IPv4 address"]);
    expect(leaksIn("from 2001:db8::1")).toEqual(["an IPv6 address"]);
    expect(leaksIn("from 2001:0db8:0000:0000:0000:ff00:0042:8329")).toEqual(["an IPv6 address"]);
    expect(leaksIn("player a.b@example.com")).toEqual(["an email address"]);
    expect(
      leaksIn(
        "colorless production report, 2026-11-10 12:29 UTC\nnew 99fbfdba 28 0 (0.0%) 117 ms\nSELECT ? FROM t\nCPU p50 6 ms, 1,102 ms",
      ),
    ).toEqual([]);
  });
});
