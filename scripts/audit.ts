#!/usr/bin/env bun
/**
 * The production advisory audit: `bun audit --prod --audit-level=moderate` with the dated ignore
 * list in scripts/audit-ignore.txt. CI's static job and the release's `audit` gate
 * (apps/api/scripts/release-gate.ts) both run this script, so an advisory ignored for CI is
 * ignored for a release too, and an urgent release is never blocked by an advisory CI already
 * accepts. Exits with bun audit's status.
 *
 *   bun scripts/audit.ts
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fail } from "./lib/cli";
import { REPO_ROOT, repoPath } from "./lib/repo";

export const IGNORE_FILE = "scripts/audit-ignore.txt";

/** An entry older than this many days is printed as a reminder to look again. */
export const REVIEW_AFTER_DAYS = 30;

export type IgnoredAdvisory = { id: string; added: string; reason: string };

const ENTRY = /^(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\S.*)$/;

/** The entries of an ignore file. Throws on a line that is neither a comment, blank, nor
    `<id> <YYYY-MM-DD> <reason>`, so an undated or unexplained ignore never gets in. */
export function parseIgnoreList(text: string): IgnoredAdvisory[] {
  const entries: IgnoredAdvisory[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = ENTRY.exec(line);
    const [, id, added, reason] = match ?? [];
    if (id === undefined || added === undefined || reason === undefined || !validDate(added))
      throw new Error(
        `${IGNORE_FILE}:${index + 1}: expected "<GHSA id> <YYYY-MM-DD> <reason>", got ${JSON.stringify(line)}`,
      );
    entries.push({ id, added, reason });
  }
  return entries;
}

function validDate(day: string): boolean {
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(day);
}

/** The `bun audit` arguments for an ignore list. */
export function auditArgs(entries: readonly IgnoredAdvisory[]): string[] {
  return [
    "audit",
    "--prod",
    "--audit-level=moderate",
    ...entries.map((entry) => `--ignore=${entry.id}`),
  ];
}

/** The entries added more than REVIEW_AFTER_DAYS before `now`. */
export function staleEntries(entries: readonly IgnoredAdvisory[], now: Date): IgnoredAdvisory[] {
  const limit = now.getTime() - REVIEW_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(`${entry.added}T00:00:00Z`) < limit);
}

function main(): void {
  let entries: IgnoredAdvisory[];
  try {
    entries = parseIgnoreList(readFileSync(repoPath(IGNORE_FILE), "utf8"));
  } catch (error) {
    fail(`audit: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const entry of entries)
    console.log(`audit: ignoring ${entry.id} (${entry.added}): ${entry.reason}`);
  for (const entry of staleEntries(entries, new Date()))
    console.log(
      `audit: ${entry.id} has been ignored since ${entry.added}; check whether a fix has landed.`,
    );
  const run = spawnSync(process.execPath, auditArgs(entries), { cwd: REPO_ROOT, stdio: "inherit" });
  if (run.error) fail(`audit: FAIL — bun audit did not run (${run.error.message})`);
  process.exit(run.status ?? 1);
}

if (import.meta.main) main();
