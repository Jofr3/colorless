import { describe, expect, it } from "vitest";
import {
  activePin,
  activeVersionOf,
  appOriginOf,
  assetProblem,
  balatroCommitOf,
  type BuildInfo,
  buildMetaOf,
  ciVerdict,
  cleanTreeProblems,
  deployAnnotations,
  deployedVersions,
  envValue,
  healthTagProblem,
  MESSAGE_MAX,
  PIN_TTL_MS,
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
  webDistProblems,
} from "./releaseChecks";

const HEAD = "3d6b1a12eb7102be8def0b5451d238b9064a9277";
const OTHER = "94132127c29c010a02f620e51255863ecf925a8d";
const NOW = Date.parse("2026-11-10T12:00:00Z");

const pin = (commit: string, minutesAgo: number): ReleasePin => ({
  commit,
  startedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  before: {},
  deployed: {},
});

describe("the release pin", () => {
  it("holds for 15 minutes, then no longer counts", () => {
    expect(activePin(pin(HEAD, 14), NOW)?.commit).toBe(HEAD);
    expect(activePin(pin(HEAD, PIN_TTL_MS / 60_000), NOW)).toBeUndefined();
    expect(activePin(undefined, NOW)).toBeUndefined();
    expect(activePin({ ...pin(HEAD, 1), startedAt: "garbage" }, NOW)).toBeUndefined();
  });

  it("refuses another commit's active release, and takes over a failed run of the same commit", () => {
    expect(pinRefusal(pin(OTHER, 3), HEAD, NOW)).toBe(
      "a release of 94132127 started 3 min ago and holds tmp/release.json",
    );
    expect(pinRefusal(pin(HEAD, 3), HEAD, NOW)).toBeUndefined();
    expect(pinRefusal(undefined, HEAD, NOW)).toBeUndefined();
  });

  it("reads back what it wrote, and nothing else", () => {
    const written = { ...pin(HEAD, 1), before: { colorless: "v1" }, bookmark: "b" };
    expect(parsePin(JSON.parse(JSON.stringify(written)))).toEqual(written);
    expect(parsePin({ commit: HEAD })).toBeUndefined();
    expect(parsePin(null)).toBeUndefined();
    expect(parsePin({ ...pin(HEAD, 1), deployed: { a: 1, b: "v2" } })?.deployed).toEqual({
      b: "v2",
    });
  });
});

describe("clean-tree", () => {
  const clean = { changes: "", head: HEAD, remoteMain: HEAD, pinned: undefined };

  it("passes a clean HEAD that is the remote's main", () => {
    expect(cleanTreeProblems(clean)).toEqual([]);
    expect(cleanTreeProblems({ ...clean, pinned: HEAD })).toEqual([]);
  });

  it("names uncommitted changes", () => {
    expect(cleanTreeProblems({ ...clean, changes: " M a.ts\n?? b.ts" })).toEqual([
      "  uncommitted changes:",
      "     M a.ts",
      "    ?? b.ts",
    ]);
  });

  it("compares with the remote's main, so a merge on GitHub is not missed (DEPM1)", () => {
    expect(cleanTreeProblems({ ...clean, remoteMain: OTHER })).toEqual([
      "  HEAD 3d6b1a12 is not remote main 94132127: pull (or push) and release again",
    ]);
    expect(cleanTreeProblems({ ...clean, remoteMain: undefined })).toHaveLength(1);
  });

  it("refuses a HEAD that moved after the release pinned its commit (DEP4)", () => {
    expect(cleanTreeProblems({ ...clean, pinned: OTHER })).toEqual([
      "  HEAD 3d6b1a12 is not 94132127, the commit this release checked (tmp/release.json): a commit landed mid-release",
    ]);
  });

  it("reads main's commit from git ls-remote", () => {
    expect(remoteMainOf(`${HEAD}\trefs/heads/main\n`)).toBe(HEAD);
    expect(remoteMainOf(`${HEAD}\trefs/heads/main-old\n`)).toBeUndefined();
    expect(remoteMainOf("")).toBeUndefined();
  });
});

describe("wrangler deploy labels", () => {
  it("tags the version with the short sha and the subject, cut to Cloudflare's 100 characters", () => {
    expect(deployAnnotations(HEAD, "Fix a thing")).toEqual([
      "--tag",
      "3d6b1a12",
      "--message",
      "Fix a thing",
    ]);
    const message = deployAnnotations(HEAD, "x".repeat(250))[3] ?? "";
    expect(message).toHaveLength(MESSAGE_MAX);
    expect(message.endsWith("…")).toBe(true);
  });

  it("reads the deployed version from wrangler's output file", () => {
    const ndjson = [
      '{"type":"wrangler-session","version":1}',
      "not json",
      '{"type":"deploy","version":1,"worker_name":"colorless-api","version_id":"v-new"}',
      "",
    ].join("\n");
    expect(deployedVersions(ndjson)).toEqual([{ worker: "colorless-api", versionId: "v-new" }]);
    expect(deployedVersions("")).toEqual([]);
  });

  it("reads the running version from wrangler deployments status", () => {
    expect(activeVersionOf({ versions: [{ version_id: "v1", percentage: 100 }] })).toBe("v1");
    expect(
      activeVersionOf({
        versions: [
          { version_id: "v1", percentage: 50 },
          { version_id: "v2", percentage: 50 },
        ],
      }),
    ).toBeUndefined();
    expect(activeVersionOf("nope")).toBeUndefined();
  });
});

describe("health", () => {
  const body = (tag: string) => ({
    ok: true,
    service: "colorless-api",
    time: "2026-11-10T12:00:00.000Z",
    version: { id: "v-new", tag },
  });

  it("waits for the version tagged with the released commit", () => {
    expect(healthTagProblem(body("3d6b1a12"), "3d6b1a12")).toBeUndefined();
    expect(healthTagProblem(body("94132127"), "3d6b1a12")).toBe(
      'the running version v-new is tagged "94132127", not 3d6b1a12',
    );
    expect(healthTagProblem(body(""), "*")).toBeUndefined();
    expect(healthTagProblem({ ok: true, service: "colorless-api" }, "3d6b1a12")).toMatch(
      /no version/,
    );
    expect(healthTagProblem(undefined, "*")).toBe("not a /health body");
  });

  it("checks each probe's status and that it answered JSON", () => {
    const probe = { path: "/auth/me", status: 401 };
    expect(probeProblem(probe, 401, "application/json; charset=UTF-8")).toBeUndefined();
    expect(probeProblem(probe, 500, "application/json")).toBe("GET /auth/me answered 500, not 401");
    expect(probeProblem(probe, 401, "text/html")).toBe("GET /auth/me answered text/html, not JSON");
  });
});

describe("web-dist", () => {
  const info: BuildInfo = {
    commit: HEAD,
    dirty: false,
    apiOrigin: "https://colorless-api.example.dev",
    siteOrigin: "https://colorless.example.dev",
    loveStrict: true,
  };
  const expected = {
    head: HEAD,
    apiOrigin: "https://colorless-api.example.dev",
    siteOrigin: "https://colorless.example.dev",
    appOrigin: "https://colorless.example.dev",
  };

  it("passes a clean production build of HEAD", () => {
    expect(webDistProblems(info, expected)).toEqual([]);
  });

  it("refuses a dist built at another commit, so a bare deploy:web cannot ship a stale build", () => {
    expect(webDistProblems({ ...info, commit: OTHER }, expected)).toEqual([
      "dist/ was built at 94132127, not HEAD 3d6b1a12",
    ]);
    expect(webDistProblems(undefined, expected)).toEqual([
      "dist/build-info.json is missing or unreadable: dist/ is not a build of this tree",
    ]);
  });

  it("refuses a dirty, lenient or mis-pointed build", () => {
    expect(webDistProblems({ ...info, dirty: true }, expected)).toEqual([
      "dist/ was built from a tree with uncommitted changes",
    ]);
    expect(webDistProblems({ ...info, loveStrict: false }, expected)).toHaveLength(1);
    expect(webDistProblems({ ...info, apiOrigin: "http://127.0.0.1:9" }, expected)).toEqual([
      "dist/ calls the API at http://127.0.0.1:9, not .env.production's https://colorless-api.example.dev",
    ]);
    expect(
      webDistProblems({ ...info, siteOrigin: "http://localhost:5175" }, expected),
    ).toHaveLength(1);
    expect(webDistProblems(info, { ...expected, appOrigin: "https://elsewhere.dev" })).toEqual([
      "apps/api/wrangler.jsonc APP_ORIGIN https://elsewhere.dev is not .env.production's VITE_SITE_ORIGIN https://colorless.example.dev",
    ]);
  });

  it("reads build-info.json, .env.production and APP_ORIGIN", () => {
    expect(parseBuildInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
    expect(parseBuildInfo({ ...info, commit: null })?.commit).toBeNull();
    expect(parseBuildInfo({ ...info, dirty: "no" })).toBeUndefined();
    const env = "# c\nVITE_API_ORIGIN=https://a.dev/\nVITE_SITE_ORIGIN=https://s.dev\n";
    expect(envValue(env, "VITE_API_ORIGIN")).toBe("https://a.dev");
    expect(envValue(env, "VITE_SITE_ORIGIN")).toBe("https://s.dev");
    expect(envValue(env, "MISSING")).toBeUndefined();
    const config =
      '{\n  "vars": {\n    // "APP_ORIGIN": "http://old"\n    "APP_ORIGIN": "https://s.dev"\n  }\n}';
    expect(appOriginOf(config)).toBe("https://s.dev");
    expect(appOriginOf('{ // "APP_ORIGIN": "http://old"\n}')).toBeUndefined();
  });
});

describe("web-health", () => {
  const html = [
    "<head>",
    `    <meta name="build" content="${HEAD}" />`,
    '<link rel="stylesheet" href="/love/host.css?v=d82c857b0f07">',
    '<link rel="icon" href="/favicon.svg">',
    '<script type="module" src="/assets/index-BxXEd8Kk.js"></script>',
    '<a href="/sandbox">',
    '<script src="/love/game.js?v=75ea83960158"></script>',
    '<script src="/love/game.js?v=75ea83960158"></script>',
  ].join("\n");

  it("reads the build commit and the /assets/ and /love/ files of the page", () => {
    expect(buildMetaOf(html)).toBe(HEAD);
    expect(buildMetaOf("<head>")).toBeUndefined();
    expect(pageReferences(html)).toEqual([
      "/assets/index-BxXEd8Kk.js",
      "/love/game.js",
      "/love/host.css",
    ]);
  });

  it("takes a script or style served as text/html for the SPA fallback of a missing file", () => {
    expect(assetProblem("/assets/a.js", 200, "text/javascript")).toBeUndefined();
    expect(assetProblem("/assets/a.js", 200, "text/html")).toMatch(/missing/);
    expect(assetProblem("/love/host.css", 200, "text/html; charset=utf-8")).toMatch(/missing/);
    expect(assetProblem("/love/NOTICES.txt", 200, "text/html")).toBeUndefined();
    expect(assetProblem("/love/love.js", 404, null)).toBe("/love/love.js answered 404");
  });
});

describe("CI's result for a commit", () => {
  let id = 0;
  const run = (name: string, status: string, conclusion: string | null) => ({
    id: ++id,
    name,
    status,
    conclusion,
  });
  const runs = (...list: ReturnType<typeof run>[]) => ({
    total_count: list.length,
    check_runs: list,
  });
  const allGreen = () => [
    run("static", "completed", "success"),
    run("lua", "completed", "success"),
    run("test", "completed", "success"),
    run("mutants", "completed", "success"),
  ];

  it("is green when every job passed, ignoring check runs of other workflows", () => {
    expect(ciVerdict(runs(...allGreen(), run("Dependabot", "completed", "failure")))).toEqual({
      verdict: "green",
      jobs: ["static success", "lua success", "test success", "mutants success"],
    });
  });

  it("is red when any job failed, even while others still run", () => {
    const list = allGreen().map((r) =>
      r.name === "mutants" ? run("mutants", "completed", "failure") : r,
    );
    expect(ciVerdict(runs(...list)).verdict).toBe("red");
    expect(
      ciVerdict(runs(run("static", "completed", "cancelled"), run("lua", "in_progress", null)))
        .verdict,
    ).toBe("red");
  });

  it("is pending while a job runs, incomplete when one never ran, none before CI reports", () => {
    expect(
      ciVerdict(runs(run("static", "completed", "success"), run("lua", "queued", null))).verdict,
    ).toBe("pending");
    const partial = ciVerdict(runs(run("static", "completed", "success")));
    expect(partial).toEqual({
      verdict: "incomplete",
      jobs: ["static success", "lua absent", "test absent", "mutants absent"],
    });
    expect(ciVerdict(runs()).verdict).toBe("none");
    expect(ciVerdict("garbage").verdict).toBe("none");
  });

  it("reads a re-run's result, not the run it replaced", () => {
    const failed = run("test", "completed", "failure");
    const rerun = run("test", "completed", "success");
    const others = allGreen().filter((r) => r.name !== "test");
    expect(ciVerdict(runs(rerun, ...others, failed)).verdict).toBe("green");
  });
});

describe("the release record", () => {
  it("names the tag by the UTC minute the release finished", () => {
    expect(releaseTagName(new Date("2026-11-10T09:05:59Z"))).toBe("release-20261110-0905");
  });

  it("finds the previous release tag among other tags", () => {
    expect(
      previousReleaseTag(["v1", "release-20261110-0905", "release-20261109-2355", "", "release-x"]),
    ).toBe("release-20261110-0905");
    expect(previousReleaseTag([""])).toBeUndefined();
  });

  it("writes one log line with the commit, both Workers' versions, the bookmark and the Lua source", () => {
    const manifest = { inputs: { balatroSource: { git: { commit: "f01aba9f" } } } };
    expect(balatroCommitOf(manifest)).toBe("f01aba9f");
    expect(balatroCommitOf({})).toBeUndefined();
    const line = releaseLogLine({
      at: new Date("2026-11-10T09:05:00Z"),
      tag: "release-20261110-0905",
      pin: {
        commit: HEAD,
        startedAt: "2026-11-10T09:02:00Z",
        before: { "colorless-api": "a1", colorless: "w1" },
        deployed: { "colorless-api": "a2" },
        bookmark: "bm",
      },
      workers: ["colorless-api", "colorless"],
      balatro: "f01aba9f",
    });
    expect(line).toBe(
      `2026-11-10T09:05:00.000Z release-20261110-0905 commit=${HEAD} colorless-api=a1->a2 colorless=w1->? bookmark=bm balatro-source=f01aba9f`,
    );
  });
});
