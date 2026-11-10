import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiProbeOutcome,
  type CheckResult,
  dbOutcome,
  errorOutcome,
  fileOutcome,
  healthOutcome,
  type Outcome,
  pageOutcome,
  retried,
  statusOutcome,
  verdict,
  watch,
  webOutcome,
} from "./prod-watch";

const HEALTH = {
  ok: true,
  service: "colorless-api",
  time: "2026-11-10T12:00:00.000Z",
  version: { id: "99fbfdba", tag: "0a8feadf" },
};
const PAGE = [
  '<meta name="build" content="0a8feadfd82ad3f4c02c2a2c4170e24729cd54ed" />',
  '<link rel="stylesheet" href="/love/host.css?v=d82c857b0f07">',
  '<script type="module" src="/assets/index-BxuS1Kre.js"></script>',
  '<script src="/love/game.js?v=f7c73fb44770"></script>',
].join("\n");
const JSON_TYPE = "application/json; charset=UTF-8";
const SETS = { path: "/sets", status: 200 };
const ME = { path: "/auth/me", status: 401 };

const state = (outcome: Outcome) => outcome.state;

describe("statusOutcome", () => {
  it("passes the expected status, holds a 4xx and is down on a 5xx or another status", () => {
    expect(statusOutcome("/health", 200, 200)).toBeUndefined();
    expect(statusOutcome("/auth/me", 401, 401)).toBeUndefined();
    expect(statusOutcome("/health", 429, 200)).toEqual({
      state: "held",
      problem: "/health answered 429, not 200",
    });
    expect(statusOutcome("/health", 404, 200)?.state).toBe("held");
    expect(statusOutcome("/health", 500, 200)?.state).toBe("down");
    expect(statusOutcome("/health", 503, 200)?.state).toBe("down");
    expect(statusOutcome("/auth/me", 200, 401)?.state).toBe("down");
    expect(statusOutcome("/health", 304, 200)?.state).toBe("down");
  });
});

describe("healthOutcome", () => {
  it("is ok with a version tag and names it", () => {
    expect(healthOutcome(200, HEALTH)).toEqual({ state: "ok", detail: "/health 0a8feadf" });
    expect(healthOutcome(200, { ...HEALTH, version: { id: "x", tag: "" } })).toEqual({
      state: "ok",
      detail: "/health untagged",
    });
  });

  it("is down on a 200 that is not a /health body or has no version", () => {
    expect(state(healthOutcome(200, undefined))).toBe("down");
    expect(state(healthOutcome(200, { ok: false }))).toBe("down");
    expect(healthOutcome(200, { ...HEALTH, version: null })).toEqual({
      state: "down",
      problem: "/health: no version in /health (an API from before version_metadata)",
    });
  });

  it("holds a 429 and is down on a 5xx", () => {
    expect(state(healthOutcome(429, undefined))).toBe("held");
    expect(state(healthOutcome(502, undefined))).toBe("down");
  });
});

describe("dbOutcome", () => {
  it("is ok with the migration count, and notes a count other than drizzle/'s", () => {
    expect(dbOutcome(200, { ok: true, migrations: 13 }, 13)).toEqual({
      state: "ok",
      detail: "/health/db 13 migrations",
    });
    expect(dbOutcome(200, { ok: true, migrations: 13 })).toEqual({
      state: "ok",
      detail: "/health/db 13 migrations",
    });
    const ahead = dbOutcome(200, { ok: true, migrations: 13 }, 14);
    expect(ahead.state).toBe("ok");
    expect(ahead.state === "ok" && ahead.note).toMatch(
      /13 migrations applied and drizzle\/ has 14/,
    );
  });

  it("is down on the 503 a failed D1 read answers, and on a wrong body", () => {
    expect(dbOutcome(503, { ok: false }, 13)).toEqual({
      state: "down",
      problem: "/health/db answered 503: the Worker could not read D1",
    });
    expect(dbOutcome(500, undefined, 13)).toEqual({
      state: "down",
      problem: "/health/db answered 500",
    });
    expect(state(dbOutcome(200, { ok: false }, 13))).toBe("down");
    expect(state(dbOutcome(200, { ok: true }, 13))).toBe("down");
    expect(state(dbOutcome(200, { ok: true, migrations: "13" }, 13))).toBe("down");
    expect(state(dbOutcome(200, { ok: true, migrations: -1 }, 13))).toBe("down");
  });

  it("holds a 4xx", () => {
    expect(state(dbOutcome(429, undefined, 13))).toBe("held");
  });
});

describe("apiProbeOutcome", () => {
  it("is ok on the probe's own status as JSON, a 401 included", () => {
    expect(apiProbeOutcome(SETS, 200, JSON_TYPE)).toEqual({ state: "ok", detail: "/sets 200" });
    expect(apiProbeOutcome(ME, 401, JSON_TYPE)).toEqual({ state: "ok", detail: "/auth/me 401" });
  });

  it("is down on a body that is not JSON or a status that is not the probe's", () => {
    expect(apiProbeOutcome(SETS, 200, "text/html")).toEqual({
      state: "down",
      problem: "GET /sets answered text/html, not JSON",
    });
    expect(state(apiProbeOutcome(ME, 200, JSON_TYPE))).toBe("down");
    expect(state(apiProbeOutcome(SETS, 500, JSON_TYPE))).toBe("down");
  });

  it("holds a rate-limited answer", () => {
    expect(state(apiProbeOutcome(SETS, 429, JSON_TYPE))).toBe("held");
    expect(state(apiProbeOutcome(ME, 429, JSON_TYPE))).toBe("held");
  });
});

describe("pageOutcome", () => {
  it("is ok with a build meta and an /assets/ script, and lists the files to check", () => {
    expect(pageOutcome(200, PAGE)).toEqual({
      outcome: { state: "ok", detail: "web 0a8feadf" },
      files: ["/assets/index-BxuS1Kre.js", "/love/game.js", "/love/host.css"],
    });
  });

  it("is down on a page with no build meta or no /assets/ script", () => {
    expect(pageOutcome(200, "<html>Error 1101</html>").outcome).toEqual({
      state: "down",
      problem: 'web /: no <meta name="build">',
    });
    expect(pageOutcome(200, PAGE.replace(/content="[^"]*"/, 'content=""')).outcome.state).toBe(
      "down",
    );
    const styleOnly = PAGE.replace("/assets/index-BxuS1Kre.js", "/love/main.js");
    expect(pageOutcome(200, styleOnly).outcome).toEqual({
      state: "down",
      problem: "web /: references no /assets/ script",
    });
  });

  it("holds a 4xx and is down on a 5xx, with no files to check", () => {
    expect(pageOutcome(429, "")).toEqual({
      outcome: { state: "held", problem: "web / answered 429, not 200" },
      files: [],
    });
    expect(pageOutcome(503, PAGE).outcome.state).toBe("down");
    expect(pageOutcome(503, PAGE).files).toEqual([]);
  });
});

describe("fileOutcome", () => {
  it("is ok on 200 with the file's own type", () => {
    expect(fileOutcome("/assets/a.js", 200, "text/javascript")).toEqual({
      state: "ok",
      detail: "/assets/a.js",
    });
  });

  it("is down on a referenced file the deployment answers 404 or with the SPA's HTML", () => {
    expect(fileOutcome("/assets/a.js", 404, "text/plain")).toEqual({
      state: "down",
      problem: "/assets/a.js answered 404",
    });
    expect(state(fileOutcome("/assets/a.js", 200, "text/html; charset=utf-8"))).toBe("down");
    expect(state(fileOutcome("/love/game.js", 500, "text/plain"))).toBe("down");
  });

  it("holds any other 4xx", () => {
    expect(fileOutcome("/love/game.js", 429, "text/plain")).toEqual({
      state: "held",
      problem: "/love/game.js answered 429, not 200",
    });
  });
});

describe("webOutcome", () => {
  const page: Outcome = { state: "ok", detail: "web 0a8feadf" };
  const ok: Outcome = { state: "ok", detail: "/assets/a.js" };
  const down: Outcome = { state: "down", problem: "/assets/a.js answered 404" };
  const held: Outcome = { state: "held", problem: "/love/game.js answered 429, not 200" };

  it("is ok when the page and every file are, counting the files", () => {
    expect(webOutcome(page, [ok, ok])).toEqual({ state: "ok", detail: "web 0a8feadf + 2 files" });
  });

  it("is down when any file is, even beside a held one, and held when one is held", () => {
    expect(webOutcome(page, [ok, held, down])).toEqual({
      state: "down",
      problem: "/assets/a.js answered 404",
    });
    expect(webOutcome(page, [ok, held])).toEqual(held);
  });

  it("passes on a page that is not ok", () => {
    expect(webOutcome(down, [])).toEqual(down);
  });
});

describe("errorOutcome", () => {
  it("names a timeout and a network failure as down", () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    expect(errorOutcome("/health", timeout)).toEqual({
      state: "down",
      problem: "/health timed out after 10 s",
    });
    expect(errorOutcome("/health", new TypeError("fetch failed"))).toEqual({
      state: "down",
      problem: "/health: no answer (fetch failed)",
    });
  });
});

describe("retried", () => {
  const sequence = (outcomes: (Outcome | Error)[]) => {
    let at = 0;
    return async () => {
      const next = outcomes[Math.min(at++, outcomes.length - 1)];
      if (next instanceof Error) throw next;
      return next as Outcome;
    };
  };
  const ok: Outcome = { state: "ok", detail: "/health 0a8feadf" };
  const down: Outcome = { state: "down", problem: "/health answered 503, not 200" };
  const held: Outcome = { state: "held", problem: "/health answered 429, not 200" };
  const run = async (outcomes: (Outcome | Error)[]) => {
    const slept: number[] = [];
    const result = await retried("/health", sequence(outcomes), {
      delays: [15_000, 45_000],
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { result, slept };
  };

  it("returns the first ok without waiting", async () => {
    const { result, slept } = await run([ok]);
    expect(result).toMatchObject({ name: "/health", outcome: ok, tries: 1 });
    expect(slept).toEqual([]);
  });

  it("tries a down or a held check again after each delay, and stops at an ok", async () => {
    const { result, slept } = await run([down, held, ok]);
    expect(result).toMatchObject({ outcome: ok, tries: 3 });
    expect(slept).toEqual([15_000, 45_000]);
  });

  it("gives up after the last delay with the last try's verdict", async () => {
    expect((await run([down, down, down, ok])).result).toMatchObject({ outcome: down, tries: 3 });
    expect((await run([down, down, held])).result).toMatchObject({ outcome: held, tries: 3 });
  });

  it("counts a throw as down", async () => {
    const { result } = await run([new TypeError("fetch failed")]);
    expect(result.outcome).toEqual({ state: "down", problem: "/health: no answer (fetch failed)" });
    expect(result.tries).toBe(3);
  });

  it("times the last try", async () => {
    const clock = [0, 40, 100, 130, 200, 260];
    const result = await retried("/health", sequence([down, ok]), {
      delays: [1],
      sleep: async () => {},
      now: () => clock.shift() ?? 0,
    });
    expect(result).toMatchObject({ tries: 2, ms: 30 });
  });
});

describe("verdict", () => {
  const result = (name: string, outcome: Outcome, tries = 1): CheckResult => ({
    name,
    outcome,
    tries,
    ms: 120,
  });

  it("is PROD OK with each check's timing when all are ok", () => {
    expect(
      verdict([
        result("/health", { state: "ok", detail: "/health 0a8feadf" }),
        result("web /", { state: "ok", detail: "web 0a8feadf + 6 files" }, 2),
      ]),
    ).toEqual({
      code: 0,
      line: "PROD OK — /health 0a8feadf 120 ms · web 0a8feadf + 6 files 120 ms, 2 tries",
      held: [],
      notes: [],
    });
  });

  it("is PROD DOWN and exit 1 when any check is down, naming only the down ones", () => {
    const v = verdict([
      result("/health", { state: "ok", detail: "/health 0a8feadf" }),
      result("/health/db", { state: "down", problem: "/health/db answered 503" }, 3),
      result("/sets", { state: "held", problem: "/sets answered 429, not 200" }, 3),
    ]);
    expect(v.code).toBe(1);
    expect(v.line).toBe("PROD DOWN — /health/db answered 503 (120 ms, 3 tries)");
    expect(v.held).toEqual([
      "/sets held, not counted as down: /sets answered 429, not 200, 3 tries",
    ]);
  });

  it("is PROD HELD and exit 0 when a check is held and none is down", () => {
    const v = verdict([
      result("/health", { state: "ok", detail: "/health 0a8feadf" }),
      result("/sets", { state: "held", problem: "/sets answered 429, not 200" }, 3),
    ]);
    expect(v.code).toBe(0);
    expect(v.line).toBe("PROD HELD — /health 0a8feadf 120 ms · /sets held (120 ms, 3 tries)");
  });

  it("carries an ok check's note without failing", () => {
    const v = verdict([
      result("/health/db", { state: "ok", detail: "/health/db 13 migrations", note: "differs" }),
    ]);
    expect(v).toMatchObject({ code: 0, notes: ["/health/db: differs"], held: [] });
    expect(v.line.startsWith("PROD OK — ")).toBe(true);
  });
});

describe("watch", () => {
  let server: Server | undefined;
  const stop = async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    running.closeAllConnections();
    await new Promise((resolve) => running.close(resolve));
  };
  afterEach(stop);

  type Route = { status: number; type: string; body: string };
  const serve = async (
    routes: Record<string, Route>,
  ): Promise<{ base: string; seen: string[] }> => {
    const seen: string[] = [];
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      seen.push(`${req.method} ${path}`);
      const route = routes[path] ?? { status: 404, type: "text/plain", body: "missing" };
      res.writeHead(route.status, { "content-type": route.type });
      res.end(req.method === "HEAD" ? undefined : route.body);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, seen };
  };
  const json = (status: number, body: unknown): Route => ({
    status,
    type: JSON_TYPE,
    body: JSON.stringify(body),
  });
  const PRODUCTION: Record<string, Route> = {
    "/health": json(200, HEALTH),
    "/health/db": json(200, { ok: true, migrations: 13 }),
    "/sets": json(200, []),
    "/auth/me": json(401, { error: "unauthorized" }),
    "/": { status: 200, type: "text/html", body: PAGE },
    "/assets/index-BxuS1Kre.js": { status: 200, type: "text/javascript", body: "" },
    "/love/game.js": { status: 200, type: "text/javascript", body: "" },
    "/love/host.css": { status: 200, type: "text/css", body: "" },
  };

  it("reads every API route, the page and each file it references", async () => {
    const { base, seen } = await serve(PRODUCTION);
    const v = verdict(await watch(base, base, { delays: [], migrations: 13 }));
    expect(v.code).toBe(0);
    expect(v.line).toMatch(
      /^PROD OK — \/health 0a8feadf \d+ ms · \/health\/db 13 migrations \d+ ms · \/sets 200 \d+ ms · \/auth\/me 401 \d+ ms · web 0a8feadf \+ 3 files \d+ ms$/,
    );
    expect(seen.sort()).toEqual([
      "GET /",
      "GET /auth/me",
      "GET /health",
      "GET /health/db",
      "GET /sets",
      "HEAD /assets/index-BxuS1Kre.js",
      "HEAD /love/game.js",
      "HEAD /love/host.css",
    ]);
  });

  it("is down when D1 fails or a referenced file is missing, retrying each", async () => {
    const { base, seen } = await serve({
      ...PRODUCTION,
      "/health/db": json(503, { ok: false }),
      "/love/game.js": { status: 404, type: "text/plain", body: "" },
    });
    const v = verdict(await watch(base, base, { delays: [0], migrations: 13 }));
    expect(v.code).toBe(1);
    expect(v.line).toMatch(
      /^PROD DOWN — \/health\/db answered 503: the Worker could not read D1 \(\d+ ms, 2 tries\) · \/love\/game\.js answered 404 \(\d+ ms, 2 tries\)$/,
    );
    expect(seen.filter((line) => line === "GET /health/db")).toHaveLength(2);
  });

  it("is down on a server that does not answer", async () => {
    const { base } = await serve(PRODUCTION);
    await stop();
    const results = await watch(base, base, { delays: [], migrations: 13 });
    expect(results.map((r) => r.outcome.state)).toEqual(["down", "down", "down", "down", "down"]);
  });
});
