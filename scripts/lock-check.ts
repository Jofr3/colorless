#!/usr/bin/env bun
/**
 * Fails when bun.lock resolves more than one version of the Workers runtime packages: miniflare,
 * workerd and its per-platform binaries. A second copy means the D1 test harness (direct
 * `miniflare`) and `wrangler dev`/deploy (wrangler's own miniflare) run different workerd builds,
 * and every install carries another 120 MB+ binary. Dependabot's wrangler bump #6 did exactly
 * that: it nested `wrangler/miniflare` beside the exact `miniflare` pin. Bump wrangler, miniflare
 * and @cloudflare/workers-types together (dependency audit VER1). A step of `check:static`.
 *
 *   bun scripts/lock-check.ts
 */

import { readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

/** Packages that must resolve to a single version. */
const SINGLE = /^(?:miniflare|workerd|@cloudflare\/workerd-[a-z0-9-]+)$/;

/** One resolved entry of bun.lock's `packages` block: `"<path>": ["<name>@<version>", ...`. */
const ENTRY = /^ {4}"([^"]+)": \["((?:@[^@/"]+\/)?[^@/"]+)@([^"]+)"/;

/** One resolved package of bun.lock: its install path, name and version. */
export type LockEntry = { path: string; name: string; version: string };

/** Every resolved entry of a bun.lock text's `packages` block, workspace links included. */
export function lockEntries(lock: string): LockEntry[] {
  const entries: LockEntry[] = [];
  for (const line of lock.split("\n")) {
    const match = ENTRY.exec(line);
    if (match === null) continue;
    const [, path = "", name = "", version = ""] = match;
    entries.push({ path, name, version });
  }
  return entries;
}

/** The `name -> versions -> lock paths` of every guarded package in a bun.lock text. */
export function runtimeVersions(lock: string): Map<string, Map<string, string[]>> {
  const found = new Map<string, Map<string, string[]>>();
  for (const { path, name, version } of lockEntries(lock)) {
    if (!SINGLE.test(name)) continue;
    const versions = found.get(name) ?? new Map<string, string[]>();
    versions.set(version, [...(versions.get(version) ?? []), path]);
    found.set(name, versions);
  }
  return found;
}

export function lockCheckReport(lock: string): Report {
  const found = runtimeVersions(lock);
  if (!found.has("miniflare") || !found.has("workerd"))
    return {
      ok: false,
      lines: [
        "lock-check: FAIL — bun.lock has no miniflare or workerd entry; the lock format may have",
        "changed, so this check no longer reads it. Update ENTRY in scripts/lock-check.ts.",
      ],
    };
  const duplicated = [...found].filter(([, versions]) => versions.size > 1);
  if (duplicated.length > 0)
    return {
      ok: false,
      lines: [
        "lock-check: FAIL — bun.lock resolves more than one version of the Workers runtime:",
        ...duplicated.map(
          ([name, versions]) =>
            `  ${name}: ${[...versions].map(([v, paths]) => `${v} (${paths.join(", ")})`).join("; ")}`,
        ),
        "Pin apps/api's miniflare to the version wrangler depends on, and bump wrangler, miniflare",
        "and @cloudflare/workers-types together.",
      ],
    };
  const versions = (name: string) => [...(found.get(name)?.keys() ?? [])].join("");
  return {
    ok: true,
    lines: [`one miniflare (${versions("miniflare")}) and one workerd (${versions("workerd")})`],
  };
}

if (import.meta.main)
  runReport("lock-check", () => lockCheckReport(readFileSync(repoPath("bun.lock"), "utf8")));
