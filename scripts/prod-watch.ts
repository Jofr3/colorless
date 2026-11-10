#!/usr/bin/env bun
/**
 * Whether production is up, from outside: read-only GETs that need no secret. Run every 6 hours by
 * .github/workflows/prod-watch.yml, whose failure email is the alert, and by hand:
 *   bun scripts/prod-watch.ts [--api <origin>] [--site <origin>]
 * The origins default to .env.production's.
 *
 * Checks, all at once:
 *   - API `/health`: 200 and a /health body with a version tag;
 *   - API `/health/db`: 200, `ok: true` and a migration count (a count other than drizzle/'s is
 *     printed as a note: between a push and its release the two differ, and that is not an outage);
 *   - API `/sets` 200 JSON and `/auth/me` 401 JSON (releaseChecks.ts's API_PROBES);
 *   - web `/`: 200 with a `<meta name="build">` and an /assets/ script, and every /assets/ and
 *     /love/ file it references answering HEAD 200 with a non-HTML type for a script or a style.
 * A check that fails is tried again after each of DELAYS_MS. Production is DOWN when a check's last
 * try met a 5xx, a network error, a timeout or a wrong body. A 4xx is never an alert (it is what
 * rate limiting answers): the check is HELD, printed as a warning, and the run passes. The one
 * exception is a file the page references answering 404: that is the deployed page naming a file
 * its own deployment lacks, the blank-page failure, not a refusal.
 * Prints one line with each check's timing: `PROD DOWN — …` (exit 1) when any check is down, else
 * `PROD HELD — …` when any is held, else `PROD OK — …`.
 */

import { readdirSync, readFileSync } from "node:fs";
import {
  API_PROBES,
  assetProblem,
  buildMetaOf,
  envValue,
  healthTagProblem,
  type Probe,
  pageReferences,
  probeProblem,
} from "../apps/api/src/releaseChecks";
import { repoPath } from "./lib/repo";

/** One try's verdict. `held` is a 4xx: no alert, but no evidence that production is up either. */
export type Outcome =
  | { state: "ok"; detail: string; note?: string }
  | { state: "down"; problem: string }
  | { state: "held"; problem: string };

export const DELAYS_MS: readonly number[] = [15_000, 45_000];
export const FETCH_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The verdict of a status alone, or undefined when it is the expected one. */
export function statusOutcome(
  label: string,
  status: number,
  expected: number,
): Outcome | undefined {
  if (status === expected) return undefined;
  const problem = `${label} answered ${status}, not ${expected}`;
  return status >= 400 && status < 500 ? { state: "held", problem } : { state: "down", problem };
}

export function healthOutcome(status: number, body: unknown): Outcome {
  const wrong = statusOutcome("/health", status, 200);
  if (wrong !== undefined) return wrong;
  const problem = healthTagProblem(body, "*");
  if (problem !== undefined) return { state: "down", problem: `/health: ${problem}` };
  const version = isRecord(body) && isRecord(body.version) ? body.version : {};
  return { state: "ok", detail: `/health ${String(version.tag) || "untagged"}` };
}

/** `migrations` is drizzle/'s file count, when the checkout has the directory. */
export function dbOutcome(status: number, body: unknown, migrations?: number): Outcome {
  const applied = isRecord(body) ? body.migrations : undefined;
  if (status >= 500)
    return {
      state: "down",
      problem: `/health/db answered ${status}${isRecord(body) && body.ok === false ? ": the Worker could not read D1" : ""}`,
    };
  const wrong = statusOutcome("/health/db", status, 200);
  if (wrong !== undefined) return wrong;
  if (!isRecord(body) || body.ok !== true || typeof applied !== "number" || applied < 0)
    return { state: "down", problem: "/health/db: not a /health/db body" };
  return {
    state: "ok",
    detail: `/health/db ${applied} migrations`,
    ...(migrations === undefined || migrations === applied
      ? {}
      : {
          note: `D1 has ${applied} migrations applied and drizzle/ has ${migrations}: a migration waits for its release, or production runs another commit`,
        }),
  };
}

export function apiProbeOutcome(probe: Probe, status: number, contentType: string | null): Outcome {
  const wrong = statusOutcome(probe.path, status, probe.status);
  if (wrong !== undefined) return wrong;
  const problem = probeProblem(probe, status, contentType);
  return problem === undefined
    ? { state: "ok", detail: `${probe.path} ${status}` }
    : { state: "down", problem };
}

/** The page's verdict, and the files to HEAD when it is up. */
export function pageOutcome(status: number, html: string): { outcome: Outcome; files: string[] } {
  const wrong = statusOutcome("web /", status, 200);
  if (wrong !== undefined) return { outcome: wrong, files: [] };
  const build = buildMetaOf(html);
  if (!build)
    return { outcome: { state: "down", problem: 'web /: no <meta name="build">' }, files: [] };
  const files = pageReferences(html);
  if (!files.some((path) => /^\/assets\/.+\.m?js$/.test(path)))
    return { outcome: { state: "down", problem: "web /: references no /assets/ script" }, files };
  return { outcome: { state: "ok", detail: `web ${build.slice(0, 8)}` }, files };
}

export function fileOutcome(path: string, status: number, contentType: string | null): Outcome {
  if (status !== 404) {
    const wrong = statusOutcome(path, status, 200);
    if (wrong !== undefined) return wrong;
  }
  const problem = assetProblem(path, status, contentType);
  return problem === undefined ? { state: "ok", detail: path } : { state: "down", problem };
}

/** The page and its files as one check: down when any part is, else held when any part is. */
export function webOutcome(page: Outcome, files: readonly Outcome[]): Outcome {
  if (page.state !== "ok") return page;
  const parts = [page, ...files];
  const problems = (state: "down" | "held") =>
    parts.flatMap((o) => (o.state === state ? [o.problem] : [])).join("; ");
  if (parts.some((o) => o.state === "down")) return { state: "down", problem: problems("down") };
  if (parts.some((o) => o.state === "held")) return { state: "held", problem: problems("held") };
  return { state: "ok", detail: `${page.detail} + ${files.length} files` };
}

/** A fetch that threw: aborted by its timeout, or no answer at all. */
export function errorOutcome(label: string, error: unknown): Outcome {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return { state: "down", problem: `${label} timed out after ${FETCH_TIMEOUT_MS / 1000} s` };
  return {
    state: "down",
    problem: `${label}: no answer (${error instanceof Error ? error.message : String(error)})`,
  };
}

export type CheckResult = { name: string; outcome: Outcome; tries: number; ms: number };

/** Tries `attempt` until it is ok, once more after each delay; the last try's verdict. A throw
    counts as down. `ms` is the last try's time. */
export async function retried(
  name: string,
  attempt: () => Promise<Outcome>,
  options: {
    delays?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<CheckResult> {
  const delays = options.delays ?? DELAYS_MS;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  let tries = 0;
  for (;;) {
    tries++;
    const start = now();
    let outcome: Outcome;
    try {
      outcome = await attempt();
    } catch (error) {
      outcome = errorOutcome(name, error);
    }
    const ms = Math.round(now() - start);
    const delay = delays[tries - 1];
    if (outcome.state === "ok" || delay === undefined) return { name, outcome, tries, ms };
    await sleep(delay);
  }
}

const triesNote = (r: CheckResult) => (r.tries > 1 ? `, ${r.tries} tries` : "");

/** The one summary line, the held checks and the notes beside it, and the exit code. */
export function verdict(results: readonly CheckResult[]): {
  code: 0 | 1;
  line: string;
  held: string[];
  notes: string[];
} {
  const held = results.flatMap((r) =>
    r.outcome.state === "held"
      ? [`${r.name} held, not counted as down: ${r.outcome.problem}${triesNote(r)}`]
      : [],
  );
  const notes = results.flatMap((r) =>
    r.outcome.state === "ok" && r.outcome.note !== undefined
      ? [`${r.name}: ${r.outcome.note}`]
      : [],
  );
  const down = results.flatMap((r) =>
    r.outcome.state === "down" ? [`${r.outcome.problem} (${r.ms} ms${triesNote(r)})`] : [],
  );
  if (down.length > 0) return { code: 1, line: `PROD DOWN — ${down.join(" · ")}`, held, notes };
  const parts = results.map((r) =>
    r.outcome.state === "ok"
      ? `${r.outcome.detail} ${r.ms} ms${triesNote(r)}`
      : `${r.name} held (${r.ms} ms${triesNote(r)})`,
  );
  const state = held.length > 0 ? "PROD HELD" : "PROD OK";
  return { code: 0, line: `${state} — ${parts.join(" · ")}`, held, notes };
}

// ---- The run ----

async function get(url: string, method = "GET"): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Cache-Control": "no-cache", "User-Agent": "colorless-prod-watch" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

const json = (response: Response): Promise<unknown> => response.json().catch(() => undefined);

function migrationCount(): number | undefined {
  try {
    return readdirSync(repoPath("apps/api/drizzle")).filter((name) => name.endsWith(".sql")).length;
  } catch {
    return undefined;
  }
}

function origins(args: readonly string[]): { api: string; site: string } {
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  let env = "";
  try {
    env = readFileSync(repoPath(".env.production"), "utf8");
  } catch {
    // Both origins may come from the flags.
  }
  const pick = (override: string | undefined, name: string) => {
    const value = override?.replace(/\/+$/, "") || envValue(env, name);
    if (!value) throw new Error(`prod-watch: no ${name} in .env.production, and no override`);
    return value;
  };
  return {
    api: pick(flag("--api"), "VITE_API_ORIGIN"),
    site: pick(flag("--site"), "VITE_SITE_ORIGIN"),
  };
}

export async function watch(
  api: string,
  site: string,
  options: { delays?: readonly number[]; migrations?: number } = {},
): Promise<CheckResult[]> {
  const { migrations = migrationCount(), delays } = options;
  const retry = (name: string, attempt: () => Promise<Outcome>) =>
    retried(name, attempt, { delays });
  return Promise.all([
    retry("/health", async () => {
      const response = await get(`${api}/health`);
      return healthOutcome(response.status, await json(response));
    }),
    retry("/health/db", async () => {
      const response = await get(`${api}/health/db`);
      return dbOutcome(response.status, await json(response), migrations);
    }),
    ...API_PROBES.map((probe) =>
      retry(probe.path, async () => {
        const response = await get(`${api}${probe.path}`);
        await response.body?.cancel();
        return apiProbeOutcome(probe, response.status, response.headers.get("content-type"));
      }),
    ),
    retry("web /", async () => {
      const response = await get(`${site}/`);
      const page = pageOutcome(response.status, await response.text());
      if (page.outcome.state !== "ok") return page.outcome;
      const files = await Promise.all(
        page.files.map(async (path) => {
          try {
            const head = await get(`${site}${path}`, "HEAD");
            return fileOutcome(path, head.status, head.headers.get("content-type"));
          } catch (error) {
            return errorOutcome(path, error);
          }
        }),
      );
      return webOutcome(page.outcome, files);
    }),
  ]);
}

if (import.meta.main) {
  const { api, site } = origins(process.argv.slice(2));
  const result = verdict(await watch(api, site));
  const actions = process.env.GITHUB_ACTIONS === "true";
  for (const line of result.held)
    console.log(actions ? `::warning title=PROD HELD::${line}` : `held: ${line}`);
  for (const line of result.notes)
    console.log(actions ? `::notice title=PROD NOTE::${line}` : `note: ${line}`);
  console.log(`${result.line} [${api}, ${site}]`);
  if (result.code !== 0 && actions) console.log(`::error title=PROD DOWN::${result.line}`);
  process.exit(result.code);
}
