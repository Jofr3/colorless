#!/usr/bin/env bun
/**
 * The monthly dependency report (docs/conventions.md, "Dependencies"; dependency audit PRC8). It
 * prints, in order: `bun outdated -r`; the full `bun audit` and CI's `--prod` gate; lock-check's
 * verdict; every bun.lock package the registry marks deprecated; the toolchain pins against the
 * local bun and node; dependencies declared in two workspaces with different specs; the two
 * `compatibility_date`s and their age; and the advisories and release-notes pages of the packages
 * that ship in the Worker, which GitHub's database can lag (hono's of 2026-11-01).
 *
 * A report, never a gate: it exits 0 whatever it finds, and needs the network, so it is not in
 * `check:static` and `release` does not run it.
 *
 *   bun run deps:check
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRecord, parseJson } from "./lib/cli";
import { REPO_ROOT, repoPath } from "./lib/repo";
import { type LockEntry, lockCheckReport, lockEntries } from "./lock-check";
import { SHIPPED, shippedDependencies } from "./worker-bundle";

const REGISTRY = "https://registry.npmjs.org";

/** Every workspace manifest, root first (the root's `workspaces` are these three). */
const MANIFESTS = ["package.json", ...SHIPPED.map(manifest)];

/** Both Workers' configs; their `compatibility_date`s move together (PRC11). */
const WRANGLER_CONFIGS = ["wrangler.jsonc", "apps/api/wrangler.jsonc"];

/** A `compatibility_date` older than this is due a move, as the quarterly floor says. */
export const COMPAT_MAX_AGE_DAYS = 92;

const DEP_BLOCKS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

function manifest(dir: string): string {
  return `${dir}/package.json`;
}

/** The distinct npm packages bun.lock resolves, as `name@version`; workspace links are skipped. */
export function lockPackages(entries: readonly LockEntry[]): { name: string; version: string }[] {
  const seen = new Map<string, { name: string; version: string }>();
  for (const { name, version } of entries)
    if (!version.startsWith("workspace:")) seen.set(`${name}@${version}`, { name, version });
  return [...seen.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

/** A registry packument, reduced to what the deprecation scan reads. */
export type Packument = { versions?: Record<string, { deprecated?: unknown } | undefined> };

export type Deprecation = { name: string; version: string; message: string };

/**
 * The locked versions the registry deprecates, and those it no longer lists (unpublished). A
 * package whose packument could not be fetched is `unknown`, never silently clean.
 */
export function deprecations(
  packages: readonly { name: string; version: string }[],
  packuments: ReadonlyMap<string, Packument | undefined>,
): { deprecated: Deprecation[]; missing: string[]; unknown: string[] } {
  const deprecated: Deprecation[] = [];
  const missing: string[] = [];
  const unknown = new Set<string>();
  for (const { name, version } of packages) {
    const packument = packuments.get(name);
    if (packument?.versions === undefined) {
      unknown.add(name);
      continue;
    }
    const entry = packument.versions[version];
    if (entry === undefined) missing.push(`${name}@${version}`);
    else if (typeof entry.deprecated === "string" && entry.deprecated !== "")
      deprecated.push({ name, version, message: entry.deprecated });
  }
  return { deprecated, missing, unknown: [...unknown].sort() };
}

/**
 * Names declared in more than one manifest with different specs (PRC7: a dependency declared in
 * two workspaces carries the same spec), each with every `manifest: spec` pair. Workspace links
 * are skipped.
 */
export function specConflicts(
  manifests: readonly { path: string; manifest: unknown }[],
): { name: string; specs: string[] }[] {
  const byName = new Map<string, Map<string, string>>();
  for (const { path, manifest } of manifests) {
    if (!isRecord(manifest)) continue;
    for (const block of DEP_BLOCKS) {
      const deps = manifest[block];
      if (!isRecord(deps)) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== "string" || spec.startsWith("workspace:")) continue;
        const specs = byName.get(name) ?? new Map<string, string>();
        specs.set(`${path} ${block}`, spec);
        byName.set(name, specs);
      }
    }
  }
  return [...byName]
    .filter(([, specs]) => new Set(specs.values()).size > 1)
    .map(([name, specs]) => ({
      name,
      specs: [...specs].map(([where, spec]) => `${where}: ${spec}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The `compatibility_date` a wrangler.jsonc text sets, if any. */
export function compatibilityDate(text: string): string | undefined {
  return /"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(text)?.[1];
}

/** Whole days from a `YYYY-MM-DD` date to `now`. */
export function ageInDays(date: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

/** Whether both Workers' dates agree and are under the quarterly floor, with one line each. */
export function compatibilityReport(
  dates: readonly { path: string; date: string | undefined }[],
  now: Date,
): { ok: boolean; lines: string[] } {
  const unset = dates.filter((d) => d.date === undefined).map((d) => d.path);
  if (unset.length > 0)
    return { ok: false, lines: [`no compatibility_date found in ${unset.join(", ")}`] };
  const distinct = [...new Set(dates.map((d) => d.date as string))];
  if (distinct.length > 1)
    return {
      ok: false,
      lines: [
        `the Workers disagree: ${dates.map((d) => `${d.path} ${d.date}`).join(", ")}; move them together`,
      ],
    };
  const date = distinct[0] ?? "";
  const age = ageInDays(date, now);
  const due = age > COMPAT_MAX_AGE_DAYS;
  const verdict = due ? `: due a move (at least every ${COMPAT_MAX_AGE_DAYS} days)` : "";
  const where = dates.map((d) => d.path).join(" and ");
  return { ok: !due, lines: [`${date} in ${where}, ${age} days old${verdict}`] };
}

/** Whether `actual` (e.g. `22.23.4`, `v22.23.4`) is the version a pin file names (e.g. `22.23`). */
export function satisfiesPin(pin: string, actual: string): boolean {
  const want = pin.trim().replace(/^v/, "");
  const have = actual.trim().replace(/^v/, "");
  return have === want || have.startsWith(`${want}.`);
}

/** The `https://github.com/<owner>/<repo>` a packument's `repository` field points at, if any. */
export function githubRepo(repository: unknown): string | undefined {
  const raw = isRecord(repository) ? repository.url : repository;
  if (typeof raw !== "string") return undefined;
  const shorthand = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(raw);
  const url = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(raw);
  const [, owner, repo] = shorthand ?? url ?? [];
  return owner === undefined || repo === undefined
    ? undefined
    : `https://github.com/${owner}/${repo.replace(/\.git$/, "")}`;
}

/** The summary line `bun audit` ends with ("42 vulnerabilities (…)", "No vulnerabilities …"). */
export function auditHeadline(output: string): string {
  const lines = output.split("\n").filter((l) => /vulnerabilit/i.test(l));
  const last = lines
    .at(-1)
    ?.replace(/\s*\[[\d.]+m?s\]\s*$/, "")
    .trim();
  return last ?? "no summary line (read the output above)";
}

function readJson(path: string): unknown {
  return parseJson(readFileSync(repoPath(path), "utf8"), path, (_v): _v is unknown => true);
}

function bun(args: string[]): string {
  const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (run.error !== undefined) return `failed to run bun ${args.join(" ")}: ${run.error.message}`;
  return `${run.stdout}${run.stderr}`.trimEnd();
}

async function fetchJson(url: string, accept: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

const packumentUrl = (name: string) => `${REGISTRY}/${name.replace("/", "%2f")}`;

async function packuments(names: readonly string[]): Promise<Map<string, Packument | undefined>> {
  const found = new Map<string, Packument | undefined>();
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      const json = await fetchJson(packumentUrl(name), "application/vnd.npm.install-v1+json");
      found.set(name, isRecord(json) && isRecord(json.versions) ? (json as Packument) : undefined);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return found;
}

function section(title: string, lines: readonly string[]): void {
  console.log(`\n== ${title}`);
  for (const line of lines) console.log(line);
}

async function main(): Promise<void> {
  const attention: string[] = [];
  console.log('deps:check: a report, never a gate (docs/conventions.md, "Dependencies").');

  section("bun outdated -r", [bun(["outdated", "-r"])]);

  const audit = bun(["audit"]);
  section("bun audit (whole tree, dev included)", [audit]);
  const prod = bun(["audit", "--prod", "--audit-level=moderate"]);
  section("bun audit --prod --audit-level=moderate (CI's gate)", [prod]);
  attention.push(`audit: ${auditHeadline(audit)}; prod: ${auditHeadline(prod)}`);

  const lockText = readFileSync(repoPath("bun.lock"), "utf8");
  const lock = lockCheckReport(lockText);
  section("lock-check", lock.ok ? [`OK: ${lock.lines[0]}`] : lock.lines);
  if (!lock.ok) attention.push("lock-check fails");

  const packages = lockPackages(lockEntries(lockText));
  const names = [...new Set(packages.map((p) => p.name))];
  const scan = deprecations(packages, await packuments(names));
  section(`deprecated in bun.lock (${packages.length} packages, ${REGISTRY})`, [
    ...(scan.deprecated.length === 0 ? ["none"] : []),
    ...scan.deprecated.map((d) => `  ${d.name}@${d.version}: ${d.message}`),
    ...scan.missing.map((m) => `  ${m}: no longer listed by the registry (unpublished?)`),
    ...(scan.unknown.length > 0 ? [`  not fetched: ${scan.unknown.join(", ")}`] : []),
  ]);
  if (scan.deprecated.length + scan.missing.length > 0)
    attention.push(
      `${scan.deprecated.length + scan.missing.length} deprecated or missing package(s)`,
    );
  if (scan.unknown.length > 0)
    attention.push(`${scan.unknown.length} package(s) not fetched, so not scanned`);

  const bunPin = readFileSync(repoPath(".bun-version"), "utf8").trim();
  const nodePin = readFileSync(repoPath(".node-version"), "utf8").trim();
  const node = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim() || "none";
  const pins = [
    { tool: "bun", pin: bunPin, actual: process.versions.bun ?? "none" },
    { tool: "node", pin: nodePin, actual: node },
  ];
  const drift = pins.filter((p) => !satisfiesPin(p.pin, p.actual));
  section(
    "toolchain (.bun-version, .node-version)",
    pins.map(
      (p) =>
        `  ${p.tool}: pinned ${p.pin}, running ${p.actual}${drift.includes(p) ? "  <- differs" : ""}`,
    ),
  );
  for (const p of drift) attention.push(`${p.tool} ${p.actual} is not the pinned ${p.pin}`);

  const conflicts = specConflicts(MANIFESTS.map((path) => ({ path, manifest: readJson(path) })));
  section(
    "declared in two workspaces with different specs",
    conflicts.length === 0
      ? ["none"]
      : conflicts.flatMap((c) => [`  ${c.name}:`, ...c.specs.map((s) => `    ${s}`)]),
  );
  if (conflicts.length > 0) attention.push(`${conflicts.length} spec conflict(s)`);

  const compat = compatibilityReport(
    WRANGLER_CONFIGS.map((path) => ({
      path,
      date: compatibilityDate(readFileSync(repoPath(path), "utf8")),
    })),
    new Date(),
  );
  section("compatibility_date", compat.lines);
  if (!compat.ok) attention.push("compatibility_date is due a move");

  const shipped = [...shippedDependencies(SHIPPED.map((dir) => readJson(manifest(dir))))].sort();
  const repos = await Promise.all(
    shipped.map(async (name) => {
      const latest = await fetchJson(`${packumentUrl(name)}/latest`, "application/json");
      return { name, repo: githubRepo(isRecord(latest) ? latest.repository : undefined) };
    }),
  );
  section("before merging, read what GitHub's advisory database may not have yet", [
    "The Worker ships these. Read each one's repository advisories and the release notes",
    "since the locked version (hono's advisories of 2026-11-01 reached neither `bun audit`",
    "nor Dependabot):",
    ...repos.map(({ name, repo }) =>
      repo === undefined
        ? `  ${name}: https://www.npmjs.com/package/${name}`
        : `  ${name}: ${repo}/security/advisories  ${repo}/releases`,
    ),
  ]);

  section("summary", attention.length === 0 ? ["nothing flagged"] : attention.map((a) => `  ${a}`));
}

if (import.meta.main) await main();
