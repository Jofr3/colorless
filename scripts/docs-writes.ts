#!/usr/bin/env bun
/**
 * Fails when README, a workstream doc or an apps/api script's printed text gives a Cloudflare
 * production write without the deploy-token wrapper. The ambient CLOUDFLARE_API_TOKEN is read-only,
 * so a bare `wrangler rollback`, `secret put`, `d1 time-travel restore`, `kv key put`, R2 object
 * write, remote `d1 execute` or `d1 migrations apply`, or remote `ingest.ts` fails with an
 * authorization error, usually at the moment it is needed. Each must run through
 * `bun scripts/with-deploy-token.ts` from apps/api (backend-data.md §3.7.2, "Cloudflare tokens").
 * In Markdown an inline code span wrapped over two lines is read as one line. It reads text, so a
 * command assembled from parts (a variable, an argument array) goes unseen.
 */

import { readdirSync, readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const WRITE =
  /wrangler (?:rollback|secret put|d1 time-travel restore|kv key put|r2 object (?:put|delete)|d1 execute [^\n`]*--remote|d1 migrations apply [^\n`]*--remote)|ingest\.ts [^\n`]*--remote/;
/** A line that names the wrapper, the token loader, the throwaway drill database or a dry run
    writes nothing to production without the deploy token. */
const WRAPPED = /with-deploy-token|withToken|deployTokenEnv|colorless-drill|--dry-run/;
const FENCE = /^\s*(?:```|~~~)/;

export type TextFile = { path: string; text: string };

/** The file's lines, with each Markdown inline code span that wraps joined onto the line it starts
    on, numbered from 1 by that first line. */
export function logicalLines({ path, text }: TextFile): { line: number; text: string }[] {
  const lines = text.split("\n");
  if (!path.endsWith(".md")) return lines.map((line, i) => ({ line: i + 1, text: line }));
  const out: { line: number; text: string }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    let joined = lines[i] ?? "";
    const start = i + 1;
    if (FENCE.test(joined)) inFence = !inFence;
    else if (!inFence) {
      while (
        (joined.split("`").length - 1) % 2 === 1 &&
        i + 1 < lines.length &&
        (lines[i + 1] ?? "").trim() !== "" &&
        !FENCE.test(lines[i + 1] ?? "")
      ) {
        i++;
        joined += ` ${(lines[i] ?? "").trim()}`;
      }
    }
    out.push({ line: start, text: joined });
  }
  return out;
}

export function docsWritesReport(files: readonly TextFile[]): Report {
  const problems: string[] = [];
  for (const file of files) {
    for (const { line, text } of logicalLines(file)) {
      if (WRITE.test(text) && !WRAPPED.test(text)) {
        problems.push(`  ${file.path}:${line}: ${text.trim().slice(0, 140)}`);
      }
    }
  }
  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        "docs-writes: FAIL — a production write without the deploy token (the ambient token is read-only):",
        ...problems,
        "Write it as `bun scripts/with-deploy-token.ts <command>` run from apps/api (from the repo",
        "root: `bun apps/api/scripts/with-deploy-token.ts`); see backend-data.md §3.7.2.",
      ],
    };
  }
  return {
    ok: true,
    lines: [`${files.length} files give every production write the deploy token`],
  };
}

function watchedFiles(): TextFile[] {
  const inDir = (dir: string, ext: string) =>
    readdirSync(repoPath(dir))
      .filter((name) => name.endsWith(ext) && !name.endsWith(".test.ts"))
      .sort()
      .map((name) => `${dir}/${name}`);
  return [
    "README.md",
    ...inDir("docs/workstreams", ".md"),
    ...inDir("apps/api/scripts", ".ts"),
  ].map((path) => ({ path, text: readFileSync(repoPath(path), "utf8") }));
}

if (import.meta.main) runReport("docs-writes", () => docsWritesReport(watchedFiles()));
