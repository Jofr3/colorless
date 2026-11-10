// The checks `bun run release` and the deploys run around their writes, and the release's record.
// Each named step runs in order; the first failure exits 1. After `--`, a `wrangler deploy` runs
// once every step has passed, labelled with the commit (below).
//
//   bun scripts/release-gate.ts pin clean-tree audit ci secrets bookmark versions print-keys
//                                                          # `release:gate`, before the build
//   bun scripts/release-gate.ts migrations clean-tree ci -- wrangler deploy --minify
//                                                          # API `deploy`
//   bun apps/api/scripts/release-gate.ts clean-tree web-dist ci -- wrangler deploy
//                                                          # web `deploy:web`, then `web-health`
//   bun scripts/release-gate.ts health                     # `release:health`, after the API deploy
//   bun scripts/release-gate.ts finish                     # `release:finish`, the last step
//   bun scripts/release-gate.ts abort                      # `release` runs it when a step fails
//
// pin         Pins HEAD in tmp/release.json for the rest of the release, so every later
//             clean-tree requires the commit `check` and the gates saw. Refuses while another
//             commit's release holds a pin younger than 15 minutes (`unlock` drops a dead one); a
//             pin of the same commit is an earlier, failed run of this release and is taken over.
// clean-tree  No uncommitted changes; HEAD is the remote's main (`git ls-remote`, not the local
//             origin/main ref, which a merge on GitHub leaves behind); and HEAD is the pinned commit
//             while a release holds one. Checked again right before each wrangler deploy, because
//             other agents share the checkout and wrangler deploys the working tree.
// audit       `bun scripts/audit.ts`: the production advisory audit CI runs, with the same ignore
//             list (scripts/audit-ignore.txt). Blocking.
// ci          Prints CI's result for HEAD (static, lua, test, mutants) from the GitHub check runs.
//             Never blocking (build audit decision 1b): local `check` already ran the same suites.
// secrets     The production Worker holds every secret in src/requiredSecrets.ts. `wrangler secret
//             list` shows names only.
// bookmark    Records the remote database's Time Travel bookmark (scripts/d1.ts recordBookmark).
// versions    Records each Worker's running version before the release, for the release log.
// print-keys  The local and remote catalogs agree on every card's print_key. The engine's
//             PROGRAM_ALIAS table is generated from the LOCAL catalog (scripts/registry-aliases.ts),
//             so a release built on a stale local ingest ships aliases production does not match.
// migrations  Every file in drizzle/ is applied remotely, and nothing else is: a Worker deployed
//             ahead of its migrations 500s the endpoints that read the new columns (D203).
// web-dist    dist/build-info.json says dist/ is a clean build of HEAD, with the strict /love/
//             versions and .env.production's origins, and the site origin is the API's APP_ORIGIN.
//             A `deploy:web` after new commits must rebuild (`bun run deploy`).
// health      The deployed API's GET /health names the version tagged with the released commit
//             (retried while the new version spreads), GET /health/db counts as many migrations as
//             drizzle/ has files, and two read-only GETs that run real code answer as they should.
//             Reads the origin the web build uses (.env.production VITE_API_ORIGIN); API_ORIGIN
//             overrides it (a local `wrangler dev`), and HEALTH_TAG the tag it waits for (`*` for
//             any, e.g. after a rollback).
// web-health  The deployed page's <meta name="build"> is the released commit, and every /assets/
//             and /love/ file it references answers 200, a script or style not as text/html.
//             SITE_ORIGIN overrides .env.production's VITE_SITE_ORIGIN.
// finish      Appends the release-log line (tmp/releases.log), prints the release notes (commit
//             subjects since the previous release tag), tags HEAD `release-YYYYMMDD-HHMM` (UTC),
//             pushes the tag and drops the pin.
// abort       Drops a pin of HEAD and exits 1, so a failed release does not hold the next one.
// unlock      Drops the pin, whatever it holds.
//
// `-- wrangler deploy <flags>` runs `wrangler deploy <flags> --tag <short sha> --message <subject>`
// in the working directory, records the new version in the pin, and prints it. The sha is passed
// from here and not by a `$(git …)` in package.json: scripts/worker-bundle.ts reads the deploy
// script's flags for its dry run.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dbHealthResponseSchema } from "@colorless/schema";
import {
  API_PROBES,
  activePin,
  activeVersionOf,
  appOriginOf,
  assetProblem,
  balatroCommitOf,
  buildMetaOf,
  ciVerdict,
  cleanTreeProblems,
  deployAnnotations,
  deployedVersions,
  deployTokenEnv,
  envValue,
  healthTagProblem,
  pageReferences,
  parseBuildInfo,
  parsePin,
  pinRefusal,
  previousReleaseTag,
  probeProblem,
  type ReleasePin,
  releaseLogLine,
  releaseTagName,
  remoteMainOf,
  shortSha,
  webDistProblems,
} from "../src/releaseChecks";
import { missingSecrets, REQUIRED_SECRETS } from "../src/requiredSecrets";
import { API_ROOT, type D1Target, d1Query, recordBookmark, wrangler } from "./d1";
import { readText } from "./with-deploy-token";

const REPO_ROOT = join(API_ROOT, "..", "..");
const PIN_FILE = join(REPO_ROOT, "tmp", "release.json");
const RELEASE_LOG = join(REPO_ROOT, "tmp", "releases.log");
const CI_REPO = "Jofr3/colorless";
/** Each Worker by its wrangler.jsonc name, with the directory its config is in. */
const WORKERS = [
  { name: "colorless-api", dir: API_ROOT },
  { name: "colorless", dir: REPO_ROOT },
] as const;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trimEnd();

const migrationFiles = () =>
  readdirSync(join(API_ROOT, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();

const ATTEMPTS = 6;
const RETRY_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The pin ----

function readPin(): ReleasePin | undefined {
  if (!existsSync(PIN_FILE)) return undefined;
  try {
    return parsePin(JSON.parse(readFileSync(PIN_FILE, "utf8")));
  } catch {
    return undefined;
  }
}

const currentPin = () => activePin(readPin(), Date.now());

function savePin(pin: ReleasePin): void {
  mkdirSync(join(PIN_FILE, ".."), { recursive: true });
  writeFileSync(PIN_FILE, `${JSON.stringify(pin, null, 2)}\n`);
}

/** Updates the active pin when it is the release of HEAD; a bare deploy has none to update. */
function updatePin(head: string, change: (pin: ReleasePin) => void): void {
  const pin = currentPin();
  if (pin === undefined || pin.commit !== head) return;
  change(pin);
  savePin(pin);
}

/** Whether this run wrote the pin, so a failure later in the same run drops it again. */
let pinnedHere = false;

// ---- Origins ----

const envProduction = () => readFileSync(join(REPO_ROOT, ".env.production"), "utf8");

function origin(override: string | undefined, name: string): string {
  if (override) return override.replace(/\/+$/, "");
  const value = envValue(envProduction(), name);
  if (!value) throw new Error(`no ${name} in .env.production`);
  return value;
}

async function get(url: string, method = "GET"): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/** Runs `attempt` until it names no problem, up to ATTEMPTS tries RETRY_MS apart; the last
    problem, or undefined. */
async function retried(attempt: () => Promise<string | undefined>): Promise<string | undefined> {
  let problem: string | undefined;
  for (let n = 1; n <= ATTEMPTS; n++) {
    try {
      problem = await attempt();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem === undefined) return undefined;
    if (n < ATTEMPTS) await sleep(RETRY_MS);
  }
  return problem;
}

/** The commit the deployed code must be: the pinned release's, else HEAD. */
const releasedCommit = () => currentPin()?.commit ?? git("rev-parse", "HEAD");

// ---- Steps ----

const STEPS: Record<string, () => void | Promise<void>> = {
  pin: () => {
    const head = git("rev-parse", "HEAD");
    const now = Date.now();
    const active = currentPin();
    const refusal = pinRefusal(active, head, now);
    if (refusal !== undefined)
      throw new Error(
        [
          `pin: FAIL — ${refusal}.`,
          "Wait for it to finish. If it is not running any more (it failed without `abort`), drop it",
          "with `bun apps/api/scripts/release-gate.ts unlock` and release again.",
        ].join("\n"),
      );
    savePin({ commit: head, startedAt: new Date(now).toISOString(), before: {}, deployed: {} });
    pinnedHere = true;
    console.log(
      `pin: OK — ${shortSha(head)} pinned in tmp/release.json${active ? " (taking over an earlier run of this release)" : ""}`,
    );
  },
  "clean-tree": () => {
    const head = git("rev-parse", "HEAD");
    const problems = cleanTreeProblems({
      changes: git("status", "--porcelain"),
      head,
      remoteMain: remoteMainOf(git("ls-remote", "origin", "refs/heads/main")),
      pinned: currentPin()?.commit,
    });
    if (problems.length === 0) {
      console.log(`clean-tree: OK — deploying ${shortSha(head)} (remote main)`);
      return;
    }
    throw new Error(
      [
        "clean-tree: FAIL — a release deploys the working tree, which must be the pushed main it checked:",
        ...problems,
        "Commit, merge into main, push, and release again.",
      ].join("\n"),
    );
  },
  audit: () => {
    const run = spawnSync(process.execPath, ["scripts/audit.ts"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    if (run.status === 0) {
      console.log("audit: OK — no production advisory at moderate or above");
      return;
    }
    throw new Error(
      [
        "audit: FAIL — `bun scripts/audit.ts` found a production advisory (above), the same gate CI runs.",
        "Upgrade the package (`bun update <name>`), or, when no fix exists and the advisory does not",
        "reach the shipped code, add a dated line to scripts/audit-ignore.txt; commit, push, release again.",
      ].join("\n"),
    );
  },
  ci: () => {
    const head = git("rev-parse", "HEAD");
    let runs: unknown;
    try {
      runs = JSON.parse(
        execFileSync("gh", ["api", `repos/${CI_REPO}/commits/${head}/check-runs?per_page=100`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
        }),
      );
    } catch (error) {
      // gh says why on stderr, e.g. "No commit found for SHA" for a commit GitHub has not seen.
      const stderr = (error as { stderr?: unknown }).stderr;
      const said = typeof stderr === "string" ? stderr.trim().split("\n")[0] : undefined;
      const reason =
        said || (error instanceof Error ? error.message.split("\n")[0] : String(error));
      console.log(`ci: UNKNOWN for ${shortSha(head)} — gh api failed (${reason}); not a gate`);
      return;
    }
    const { verdict, jobs } = ciVerdict(runs);
    const summary = verdict === "none" ? "CI has not reported on this commit yet" : jobs.join(", ");
    const advice =
      verdict === "red"
        ? `; not a gate, but read it first: gh run list --commit ${head}`
        : verdict === "green"
          ? ""
          : "; not a gate";
    console.log(`ci: ${verdict.toUpperCase()} for ${shortSha(head)} — ${summary}${advice}`);
  },
  secrets: () => {
    const missing = missingSecrets(wrangler(["secret", "list", "--format", "json"]));
    if (missing.length === 0) {
      console.log(`secrets: OK — ${REQUIRED_SECRETS.join(", ")} are set on the Worker`);
      return;
    }
    const generated = missing.filter((name) => !name.startsWith("GOOGLE_"));
    const google = missing.filter((name) => name.startsWith("GOOGLE_"));
    throw new Error(
      [
        `secrets: FAIL — the production Worker lacks ${missing.join(", ")}.`,
        ...(generated.length === 0
          ? []
          : [
              `Generate ${generated.join(" and ")} (openssl rand -base64 32 each) and store each in the`,
              "password manager FIRST. A lost PASSWORD_PEPPER locks every peppered password account",
              "out; see docs/workstreams/backend-data.md §3.5.",
            ]),
        ...(google.length === 0
          ? []
          : [
              `Copy ${google.join(" and ")} from the Google Auth Platform client (README "Google login").`,
            ]),
        "Then from apps/api:",
        ...missing.map((name) => `  bunx wrangler secret put ${name}`),
        "and release again.",
      ].join("\n"),
    );
  },
  bookmark: () => {
    const bookmark = recordBookmark("release");
    updatePin(git("rev-parse", "HEAD"), (pin) => {
      pin.bookmark = bookmark;
    });
  },
  versions: () => {
    const head = git("rev-parse", "HEAD");
    const before: Record<string, string> = {};
    for (const worker of WORKERS) {
      const status = JSON.parse(wrangler(["deployments", "status", "--json"], worker.dir));
      before[worker.name] = activeVersionOf(status) ?? "?";
    }
    updatePin(head, (pin) => {
      pin.before = before;
    });
    console.log(
      `versions: OK — running before the release: ${WORKERS.map((w) => `${w.name} ${before[w.name]}`).join(", ")}`,
    );
  },
  "print-keys": () => {
    const keys = (target: D1Target) =>
      (d1Query(target, "SELECT id, print_key FROM cards ORDER BY id")[0] ?? []).map(
        (row) => `${String(row.id)} ${String(row.print_key)}`,
      );
    const local = keys("--local");
    const remote = keys("--remote");
    const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");
    if (local.length > 0 && digest(local) === digest(remote)) {
      console.log(`print-keys: OK — ${local.length} cards agree locally and remotely`);
      return;
    }
    const remoteSet = new Set(remote);
    const localSet = new Set(local);
    const onlyLocal = local.filter((line) => !remoteSet.has(line));
    const onlyRemote = remote.filter((line) => !localSet.has(line));
    throw new Error(
      [
        `print-keys: FAIL — local (${local.length} cards) and remote (${remote.length}) differ:`,
        ...onlyLocal.slice(0, 5).map((line) => `  local only:  ${line}`),
        ...onlyRemote.slice(0, 5).map((line) => `  remote only: ${line}`),
        "Re-ingest locally (the sets production has), run `bun scripts/registry-aliases.ts`",
        "from the repo root, commit, and release again.",
      ].join("\n"),
    );
  },
  migrations: () => {
    const files = migrationFiles();
    const applied = (
      d1Query("--remote", "SELECT name FROM d1_migrations ORDER BY id")[0] ?? []
    ).map((row) => String(row.name));
    const pending = files.filter((name) => !applied.includes(name));
    const unknown = applied.filter((name) => !files.includes(name));
    if (pending.length === 0 && unknown.length === 0) {
      console.log(`migrations: OK — all ${files.length} applied remotely`);
      return;
    }
    throw new Error(
      [
        "migrations: FAIL — the remote database does not match drizzle/:",
        ...pending.map((name) => `  not applied remotely: ${name}`),
        ...unknown.map((name) => `  applied remotely but not in drizzle/: ${name}`),
        "Deploy through `bun run release` (it migrates first), or run `bun run db:migrate:remote`.",
        "After a Time Travel restore, a file listed here was rewound: roll the Worker back first",
        "(docs/workstreams/backend-data.md §3.7.3) instead of migrating again.",
      ].join("\n"),
    );
  },
  "web-dist": () => {
    const head = git("rev-parse", "HEAD");
    const infoFile = join(REPO_ROOT, "dist", "build-info.json");
    let info: unknown;
    try {
      info = JSON.parse(readFileSync(infoFile, "utf8"));
    } catch {
      info = undefined;
    }
    const env = envProduction();
    const siteOrigin = envValue(env, "VITE_SITE_ORIGIN");
    const problems = webDistProblems(parseBuildInfo(info), {
      head,
      apiOrigin: envValue(env, "VITE_API_ORIGIN"),
      siteOrigin,
      appOrigin: appOriginOf(readFileSync(join(API_ROOT, "wrangler.jsonc"), "utf8")),
    });
    if (problems.length === 0) {
      console.log(
        `web-dist: OK — dist/ is a clean production build of ${shortSha(head)} for ${siteOrigin}`,
      );
      return;
    }
    throw new Error(
      [
        "web-dist: FAIL — dist/ is not what this commit deploys:",
        ...problems.map((problem) => `  ${problem}`),
        "Rebuild and deploy with `bun run deploy` from the repo root (or release with `bun run release`).",
      ].join("\n"),
    );
  },
  health: async () => {
    const api = origin(process.env.API_ORIGIN, "VITE_API_ORIGIN");
    const tag = process.env.HEALTH_TAG ?? shortSha(releasedCommit());
    const expected = migrationFiles().length;
    const rollback = [
      'A D1 error is logged as evt = "d1" in Workers Logs. To put the previous API back, from',
      "apps/api: `bunx wrangler deployments list`, then `bunx wrangler rollback <version id>`",
      "(tmp/releases.log names the version each release replaced).",
      "See the recovery table in docs/workstreams/backend-data.md §3.7.2.",
    ];
    const versionProblem = await retried(async () => {
      const response = await get(`${api}/health`);
      return healthTagProblem(await response.json().catch(() => undefined), tag);
    });
    if (versionProblem !== undefined)
      throw new Error(
        [
          `health: FAIL — ${api}/health after ${ATTEMPTS} tries: ${versionProblem}.`,
          "The new version did not take over: check `bunx wrangler deployments list` (apps/api).",
          ...rollback,
        ].join("\n"),
      );
    const dbProblem = await retried(async () => {
      const response = await get(`${api}/health/db`);
      const body = dbHealthResponseSchema.safeParse(await response.json().catch(() => undefined));
      if (!body.success) return `HTTP ${response.status}, not a /health/db body`;
      if (!body.data.ok) return `HTTP ${response.status}: the Worker could not read D1`;
      return body.data.migrations === expected
        ? undefined
        : `${body.data.migrations} migrations applied, drizzle/ has ${expected}`;
    });
    if (dbProblem !== undefined)
      throw new Error(
        [
          `health: FAIL — ${api}/health/db after ${ATTEMPTS} tries: ${dbProblem}`,
          "A count that differs from drizzle/: `bun scripts/release-gate.ts migrations` names the files.",
          ...rollback,
        ].join("\n"),
      );
    const probes: string[] = [];
    for (const probe of API_PROBES) {
      const problem = await retried(async () => {
        const response = await get(`${api}${probe.path}`);
        await response.body?.cancel();
        return probeProblem(probe, response.status, response.headers.get("content-type"));
      });
      if (problem !== undefined) probes.push(problem);
    }
    if (probes.length > 0)
      throw new Error(
        [
          `health: FAIL — the new API (${tag}) answers /health but not its routes:`,
          ...probes.map((problem) => `  ${problem}`),
          ...rollback,
        ].join("\n"),
      );
    console.log(
      `health: OK — ${api} runs ${tag === "*" ? "a version" : tag}, reads D1 (${expected} migrations), and answers ${API_PROBES.map((p) => `${p.path} ${p.status}`).join(", ")}`,
    );
  },
  "web-health": async () => {
    const site = origin(process.env.SITE_ORIGIN, "VITE_SITE_ORIGIN");
    const commit = releasedCommit();
    let html = "";
    const pageProblem = await retried(async () => {
      const response = await get(`${site}/`);
      html = await response.text();
      const build = buildMetaOf(html);
      if (response.status !== 200) return `/ answered ${response.status}`;
      return build === commit
        ? undefined
        : `the page's <meta name="build"> is ${build ?? "absent"}, not ${commit}`;
    });
    const references = pageReferences(html);
    const problems = pageProblem === undefined ? [] : [pageProblem];
    if (pageProblem === undefined && !references.some((path) => path.startsWith("/assets/")))
      problems.push("the page references no /assets/ file");
    if (pageProblem === undefined)
      for (const path of references) {
        const response = await get(`${site}${path}`, "HEAD");
        const problem = assetProblem(path, response.status, response.headers.get("content-type"));
        if (problem !== undefined) problems.push(problem);
      }
    if (problems.length === 0) {
      console.log(
        `web-health: OK — ${site} serves ${shortSha(commit)}, and its ${references.length} /assets/ and /love/ files answer`,
      );
      return;
    }
    throw new Error(
      [
        `web-health: FAIL — ${site}:`,
        ...problems.map((problem) => `  ${problem}`),
        "A missing file: rebuild and deploy with `bun run deploy`. A bad build: from the repo root,",
        "`bunx wrangler deployments list`, then `bunx wrangler rollback <version id>` (Worker colorless;",
        "tmp/releases.log names the version the release replaced).",
      ].join("\n"),
    );
  },
  finish: () => {
    const head = git("rev-parse", "HEAD");
    const pin = currentPin();
    if (pin === undefined || pin.commit !== head)
      throw new Error(
        [
          `finish: FAIL — tmp/release.json holds ${pin ? shortSha(pin.commit) : "no release"}, not HEAD ${shortSha(head)}.`,
          "finish records a release that `bun run release` pinned and deployed; nothing was tagged.",
        ].join("\n"),
      );
    const at = new Date();
    const tag = releaseTagName(at);
    const previous = previousReleaseTag(
      git("tag", "--list", "release-*", "--merged", head).split("\n"),
    );
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "dist", "love", "asset-manifest.json"), "utf8"),
      );
    } catch {
      manifest = undefined;
    }
    const line = releaseLogLine({
      at,
      tag,
      pin,
      workers: WORKERS.map((w) => w.name),
      balatro: balatroCommitOf(manifest),
    });
    mkdirSync(join(RELEASE_LOG, ".."), { recursive: true });
    appendFileSync(RELEASE_LOG, `${line}\n`);
    rmSync(PIN_FILE, { force: true });
    console.log(`finish: logged to tmp/releases.log:\n  ${line}`);
    const notes =
      previous === undefined
        ? []
        : git("log", "--format=%s", `${previous}..${head}`).split("\n").filter(Boolean);
    console.log(
      previous === undefined
        ? "Release notes: no earlier release tag; this is the first tagged release."
        : `Release notes (${notes.length} commits since ${previous}):\n${notes.map((s) => `  - ${s}`).join("\n")}`,
    );
    const subject = git("log", "-1", "--format=%s", head);
    try {
      git("tag", "-a", tag, "-m", `Release ${shortSha(head)}: ${subject}\n\n${line}`, head);
      git("push", "origin", `refs/tags/${tag}`);
    } catch (error) {
      throw new Error(
        [
          `finish: FAIL — the release is live and logged, but tagging failed: ${error instanceof Error ? error.message : String(error)}`,
          `Tag it by hand: git tag -a ${tag} -m "Release ${shortSha(head)}" ${head} && git push origin refs/tags/${tag}`,
        ].join("\n"),
      );
    }
    console.log(`finish: OK — tagged ${tag} and pushed it`);
    console.log(
      "After about an hour of use, compare the new API version with the one it replaced: `bun run --cwd apps/api prod:report --release` (read-only).",
    );
  },
  abort: () => {
    const pin = readPin();
    let head = "";
    try {
      head = git("rev-parse", "HEAD");
    } catch {}
    if (pin !== undefined && pin.commit === head) {
      rmSync(PIN_FILE, { force: true });
      console.error(`abort: the release of ${shortSha(head)} failed (above); its pin is dropped.`);
    } else if (pin !== undefined) {
      console.error(
        `abort: the release failed (above). tmp/release.json pins ${shortSha(pin.commit)}, not HEAD, so it stays; \`unlock\` drops it.`,
      );
    } else {
      console.error("abort: the release failed (above).");
    }
    process.exit(1);
  },
  unlock: () => {
    const pin = readPin();
    rmSync(PIN_FILE, { force: true });
    console.log(
      pin ? `unlock: dropped the pin of ${shortSha(pin.commit)}` : "unlock: no pin to drop",
    );
  },
};

/** `wrangler deploy <flags>`, labelled with the commit, after the steps passed. */
function deployLabelled(command: readonly string[]): void {
  const head = git("rev-parse", "HEAD");
  const subject = git("log", "-1", "--format=%s", head);
  mkdirSync(join(REPO_ROOT, "tmp"), { recursive: true });
  const output = join(REPO_ROOT, "tmp", `wrangler-deploy-${process.pid}.ndjson`);
  rmSync(output, { force: true });
  // The ambient CLOUDFLARE_API_TOKEN is read-only; the deploy loads the production-write token
  // (build audit DEP3). Every step before this one only reads, so they keep the ambient token.
  const withToken = deployTokenEnv(process.env, homedir(), readText);
  if ("error" in withToken) throw new Error(withToken.error);
  const run = spawnSync("bunx", [...command, ...deployAnnotations(head, subject)], {
    stdio: "inherit",
    env: { ...withToken.env, WRANGLER_OUTPUT_FILE_PATH: output },
  });
  const deployed = existsSync(output) ? deployedVersions(readFileSync(output, "utf8")) : [];
  rmSync(output, { force: true });
  if (run.status !== 0)
    throw new Error(
      `deploy: FAIL — \`${command.join(" ")}\` exited ${run.status ?? run.error?.message}`,
    );
  for (const { worker, versionId } of deployed) {
    updatePin(head, (pin) => {
      pin.deployed[worker] = versionId;
    });
    console.log(`deploy: ${worker} version ${versionId}, tagged ${shortSha(head)}`);
  }
}

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const requested = dash === -1 ? argv : argv.slice(0, dash);
const command = dash === -1 ? undefined : argv.slice(dash + 1);
const unknownSteps = requested.filter((step) => !(step in STEPS));
const badCommand = command !== undefined && (command[0] !== "wrangler" || command[1] !== "deploy");
if ((requested.length === 0 && command === undefined) || unknownSteps.length > 0 || badCommand) {
  console.error(
    `release-gate: name steps from ${Object.keys(STEPS).join(", ")}, optionally followed by -- wrangler deploy <flags>`,
  );
  process.exit(1);
}
try {
  for (const step of requested) await STEPS[step]?.();
  if (command !== undefined) deployLabelled(command);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (pinnedHere) rmSync(PIN_FILE, { force: true });
  process.exit(1);
}
