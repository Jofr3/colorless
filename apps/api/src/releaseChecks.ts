// The verdicts scripts/release-gate.ts reaches about a release, as pure functions of what it read
// (git, wrangler, gh, the deployed site), so vitest can test them; it sits here beside
// requiredSecrets.ts for that reason, and the Worker imports neither. Build audit ENV1, DEP1,
// DEP4, DEPM1 and CI1.

/** The commit a release names everywhere: wrangler's `--tag`, /health's `version.tag`, the log. */
export const shortSha = (commit: string): string => commit.slice(0, 8);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---- The release pin (tmp/release.json) ----

/** How long a pin holds the release for its commit. A release takes about three minutes after
    `release:gate`; an older pin is a release that died without `abort` and no longer counts. */
export const PIN_TTL_MS = 15 * 60 * 1000;

/** tmp/release.json: the commit `release:gate` checked, pinned for the steps after it, and what
    the release learns on the way, for the release-log line. Worker names map to version ids. */
export type ReleasePin = {
  commit: string;
  startedAt: string;
  before: Record<string, string>;
  deployed: Record<string, string>;
  bookmark?: string;
};

export function parsePin(value: unknown): ReleasePin | undefined {
  if (!isRecord(value) || typeof value.commit !== "string" || typeof value.startedAt !== "string")
    return undefined;
  const ids = (field: unknown) =>
    Object.fromEntries(
      Object.entries(isRecord(field) ? field : {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  return {
    commit: value.commit,
    startedAt: value.startedAt,
    before: ids(value.before),
    deployed: ids(value.deployed),
    ...(typeof value.bookmark === "string" ? { bookmark: value.bookmark } : {}),
  };
}

/** The pin when it still holds the release at `now`, else undefined (none, unreadable or old). */
export function activePin(pin: ReleasePin | undefined, now: number): ReleasePin | undefined {
  if (pin === undefined) return undefined;
  const started = Date.parse(pin.startedAt);
  return !Number.isNaN(started) && now - started < PIN_TTL_MS && started <= now + 60_000
    ? pin
    : undefined;
}

/** Why `release:gate` must not pin `head`, or undefined when it may. An active pin of the same
    commit is an earlier run of this release that failed: running it again is the recovery. */
export function pinRefusal(
  active: ReleasePin | undefined,
  head: string,
  now: number,
): string | undefined {
  if (active === undefined || active.commit === head) return undefined;
  const minutes = Math.max(0, Math.round((now - Date.parse(active.startedAt)) / 60_000));
  return `a release of ${shortSha(active.commit)} started ${minutes} min ago and holds tmp/release.json`;
}

// ---- clean-tree ----

/** What keeps the working tree from being the commit a deploy may ship: uncommitted changes, a
    HEAD that is not the remote's main (read with `git ls-remote`, never the local origin/main ref,
    which a merge on GitHub leaves behind; DEPM1), or a HEAD other than the commit an active
    release pinned (another agent committed mid-release; DEP4). */
export function cleanTreeProblems(input: {
  changes: string;
  head: string;
  remoteMain: string | undefined;
  pinned: string | undefined;
}): string[] {
  const { changes, head, remoteMain, pinned } = input;
  return [
    ...(changes === ""
      ? []
      : ["  uncommitted changes:", ...changes.split("\n").map((line) => `    ${line}`)]),
    ...(remoteMain === undefined
      ? ["  `git ls-remote origin refs/heads/main` named no commit"]
      : remoteMain === head
        ? []
        : [
            `  HEAD ${shortSha(head)} is not remote main ${shortSha(remoteMain)}: pull (or push) and release again`,
          ]),
    ...(pinned === undefined || pinned === head
      ? []
      : [
          `  HEAD ${shortSha(head)} is not ${shortSha(pinned)}, the commit this release checked (tmp/release.json): a commit landed mid-release`,
        ]),
  ];
}

/** The commit `git ls-remote origin refs/heads/main` prints, if any. */
export function remoteMainOf(lsRemote: string): string | undefined {
  return /^([0-9a-f]{40})\trefs\/heads\/main$/m.exec(lsRemote)?.[1];
}

// ---- wrangler deploy ----

/** Cloudflare caps a version message at 100 characters. */
export const MESSAGE_MAX = 100;

/** The `--tag`/`--message` a release passes to `wrangler deploy`: the short sha and the subject. */
export function deployAnnotations(commit: string, subject: string): string[] {
  const message =
    subject.length <= MESSAGE_MAX ? subject : `${subject.slice(0, MESSAGE_MAX - 1).trimEnd()}…`;
  return ["--tag", shortSha(commit), "--message", message];
}

/** The `{worker, versionId}` of each deploy in a WRANGLER_OUTPUT_FILE_PATH file (one JSON object
    per line; wrangler writes `type: "deploy"` with `worker_name` and `version_id`). */
export function deployedVersions(ndjson: string): { worker: string; versionId: string }[] {
  const out: { worker: string; versionId: string }[] = [];
  for (const line of ndjson.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      isRecord(entry) &&
      entry.type === "deploy" &&
      typeof entry.worker_name === "string" &&
      typeof entry.version_id === "string"
    )
      out.push({ worker: entry.worker_name, versionId: entry.version_id });
  }
  return out;
}

/** The version id `wrangler deployments status --json` reports at 100%, if one does. */
export function activeVersionOf(status: unknown): string | undefined {
  if (!isRecord(status) || !Array.isArray(status.versions)) return undefined;
  const full = status.versions.find(
    (v): v is { version_id: string } =>
      isRecord(v) && v.percentage === 100 && typeof v.version_id === "string",
  );
  return full?.version_id;
}

// ---- health ----

/** Whether a GET /health body is the version tagged `expected` (`*` accepts any version). */
export function healthTagProblem(body: unknown, expected: string): string | undefined {
  if (!isRecord(body) || body.ok !== true) return "not a /health body";
  const version = body.version;
  if (!isRecord(version) || typeof version.tag !== "string")
    return "no version in /health (an API from before version_metadata)";
  if (expected === "*" || version.tag === expected) return undefined;
  return `the running version ${String(version.id)} is tagged ${JSON.stringify(version.tag)}, not ${expected}`;
}

/** A read-only GET that exercises real API code: its path and the status it must answer. */
export type Probe = { path: string; status: number };

/** /sets reads D1 (or KV) through the catalog routes; /auth/me runs the session middleware. */
export const API_PROBES: readonly Probe[] = [
  { path: "/sets", status: 200 },
  { path: "/auth/me", status: 401 },
];

/** Why a probe's answer is wrong: another status, or a body that is not JSON. */
export function probeProblem(
  probe: Probe,
  status: number,
  contentType: string | null,
): string | undefined {
  if (status !== probe.status) return `GET ${probe.path} answered ${status}, not ${probe.status}`;
  if (!(contentType ?? "").includes("application/json"))
    return `GET ${probe.path} answered ${contentType ?? "no content type"}, not JSON`;
  return undefined;
}

// ---- web-dist and web-health ----

/** dist/build-info.json, which vite.config.ts's build-info plugin writes. */
export type BuildInfo = {
  commit: string | null;
  dirty: boolean;
  apiOrigin: string;
  siteOrigin: string;
  loveStrict: boolean;
};

export function parseBuildInfo(value: unknown): BuildInfo | undefined {
  if (
    !isRecord(value) ||
    !(typeof value.commit === "string" || value.commit === null) ||
    typeof value.dirty !== "boolean" ||
    typeof value.apiOrigin !== "string" ||
    typeof value.siteOrigin !== "string" ||
    typeof value.loveStrict !== "boolean"
  )
    return undefined;
  return {
    commit: value.commit,
    dirty: value.dirty,
    apiOrigin: value.apiOrigin,
    siteOrigin: value.siteOrigin,
    loveStrict: value.loveStrict,
  };
}

/** `NAME=value` from a dotenv text, if set. */
export function envValue(text: string, name: string): string | undefined {
  const value = new RegExp(`^${name}=(.+)$`, "m").exec(text)?.[1]?.trim();
  return value === undefined || value === "" ? undefined : value.replace(/\/+$/, "");
}

/** `vars.APP_ORIGIN` from apps/api/wrangler.jsonc, read from a line that is not commented out. */
export function appOriginOf(config: string): string | undefined {
  return /^\s*"APP_ORIGIN"\s*:\s*"([^"]+)"/m.exec(config)?.[1]?.replace(/\/+$/, "");
}

/** Why dist/ is not a build of `head` for production: another commit or a dirty tree, a lenient
    Lua build, or origins other than .env.production's, whose site is not the API's APP_ORIGIN. */
export function webDistProblems(
  info: BuildInfo | undefined,
  expected: { head: string; apiOrigin?: string; siteOrigin?: string; appOrigin?: string },
): string[] {
  if (info === undefined)
    return ["dist/build-info.json is missing or unreadable: dist/ is not a build of this tree"];
  const { head, apiOrigin, siteOrigin, appOrigin } = expected;
  return [
    ...(info.commit === head
      ? []
      : [
          `dist/ was built at ${info.commit === null ? "no commit" : shortSha(info.commit)}, not HEAD ${shortSha(head)}`,
        ]),
    ...(info.dirty ? ["dist/ was built from a tree with uncommitted changes"] : []),
    ...(info.loveStrict
      ? []
      : [
          "dist/ was built with LOVE_VERSIONS_OPTIONAL=1, so its /love/ references may be unversioned",
        ]),
    ...(apiOrigin !== undefined && info.apiOrigin === apiOrigin
      ? []
      : [
          `dist/ calls the API at ${info.apiOrigin}, not .env.production's ${apiOrigin ?? "(unset)"}`,
        ]),
    ...(siteOrigin !== undefined && info.siteOrigin === siteOrigin
      ? []
      : [
          `dist/ names the site ${info.siteOrigin}, not .env.production's ${siteOrigin ?? "(unset)"}`,
        ]),
    ...(appOrigin !== undefined && appOrigin === siteOrigin
      ? []
      : [
          `apps/api/wrangler.jsonc APP_ORIGIN ${appOrigin ?? "(unset)"} is not .env.production's VITE_SITE_ORIGIN ${siteOrigin ?? "(unset)"}`,
        ]),
  ];
}

/** The `<meta name="build">` value of a page: the commit it was built at (`-dirty` appended for a
    build of a changed tree). */
export function buildMetaOf(html: string): string | undefined {
  return /<meta name="build" content="([^"]*)"/.exec(html)?.[1];
}

/** The /assets/ and /love/ files a page references, without their `?v=` query. */
export function pageReferences(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/(?:assets|love)\/[^"?#]+)/g))
    if (match[1] !== undefined) paths.add(match[1]);
  return [...paths].sort();
}

/** Why a deployed file's answer is wrong. The SPA fallback answers a missing file with index.html
    and 200, so a script or a style that comes back as text/html is missing too. */
export function assetProblem(
  path: string,
  status: number,
  contentType: string | null,
): string | undefined {
  if (status !== 200) return `${path} answered ${status}`;
  if (/\.(?:m?js|css|wasm)$/.test(path) && (contentType ?? "").startsWith("text/html"))
    return `${path} answered text/html: the file is missing and the SPA fallback served index.html`;
  return undefined;
}

// ---- CI ----

/** The ci.yml jobs whose result the release prints (decision 1b: printed, never blocking). */
export const CI_JOBS = ["static", "lua", "test", "mutants"] as const;

const PASSING = new Set(["success", "neutral", "skipped"]);

export type CiVerdict = "green" | "red" | "pending" | "incomplete" | "none";

/** CI's result for one commit from `gh api repos/…/commits/<sha>/check-runs`: each job's latest
    run (a re-run has a higher id), then one verdict. Red when any job did not pass, pending while
    any runs, incomplete when one never ran, none when CI has not reported at all. */
export function ciVerdict(
  checkRuns: unknown,
  jobs: readonly string[] = CI_JOBS,
): { verdict: CiVerdict; jobs: string[] } {
  const runs =
    isRecord(checkRuns) && Array.isArray(checkRuns.check_runs) ? checkRuns.check_runs : [];
  const latest = new Map<string, { id: number; status: string; conclusion: string | null }>();
  for (const run of runs) {
    if (!isRecord(run) || typeof run.name !== "string" || typeof run.id !== "number") continue;
    const previous = latest.get(run.name);
    if (previous !== undefined && previous.id > run.id) continue;
    latest.set(run.name, {
      id: run.id,
      status: typeof run.status === "string" ? run.status : "unknown",
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    });
  }
  const states = jobs.map((job) => {
    const run = latest.get(job);
    if (run === undefined) return { job, state: "absent" as const };
    if (run.status !== "completed") return { job, state: "running" as const, label: run.status };
    const conclusion = run.conclusion ?? "unknown";
    return {
      job,
      state: PASSING.has(conclusion) ? ("pass" as const) : ("fail" as const),
      label: conclusion,
    };
  });
  const verdict: CiVerdict = states.every((s) => s.state === "absent")
    ? "none"
    : states.some((s) => s.state === "fail")
      ? "red"
      : states.some((s) => s.state === "running")
        ? "pending"
        : states.some((s) => s.state === "absent")
          ? "incomplete"
          : "green";
  return {
    verdict,
    jobs: states.map((s) => `${s.job} ${"label" in s ? s.label : "absent"}`),
  };
}

// ---- The release record ----

/** The git tag of a release that finished at `at`: `release-YYYYMMDD-HHMM`, in UTC. */
export function releaseTagName(at: Date): string {
  const iso = at.toISOString();
  return `release-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
}

/** The newest release tag among `tags` (their names sort by time). */
export function previousReleaseTag(tags: readonly string[]): string | undefined {
  return tags
    .filter((tag) => /^release-\d{8}-\d{4}$/.test(tag))
    .sort()
    .at(-1);
}

/** The balatro-source commit a build packaged, from dist/love/asset-manifest.json. */
export function balatroCommitOf(manifest: unknown): string | undefined {
  const source =
    isRecord(manifest) && isRecord(manifest.inputs) ? manifest.inputs.balatroSource : undefined;
  const git = isRecord(source) ? source.git : undefined;
  return isRecord(git) && typeof git.commit === "string" ? git.commit : undefined;
}

/** One tmp/releases.log line: when, the tag, the commit, each Worker's version before and after,
    the D1 bookmark taken before the migration, and the balatro-source commit in game.data. */
export function releaseLogLine(input: {
  at: Date;
  tag: string;
  pin: ReleasePin;
  workers: readonly string[];
  balatro: string | undefined;
}): string {
  const { at, tag, pin, workers, balatro } = input;
  const versions = workers.map(
    (worker) => `${worker}=${pin.before[worker] ?? "?"}->${pin.deployed[worker] ?? "?"}`,
  );
  return [
    at.toISOString(),
    tag,
    `commit=${pin.commit}`,
    ...versions,
    `bookmark=${pin.bookmark ?? "?"}`,
    `balatro-source=${balatro ?? "?"}`,
  ].join(" ");
}
