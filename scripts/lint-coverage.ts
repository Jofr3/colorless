#!/usr/bin/env bun
/**
 * `bun run lint:coverage`: fails if any source file is invisible to Biome. It passes every tracked
 * script file to Biome in one run and compares the checked-file count, since Biome exits 0 on paths
 * it skips. Files over `files.maxSize` are checked against `biome.json` directly, because Biome
 * counts but refuses them. JSON files are not covered.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

/** Extensions Biome lints that hold hand-written source in this repo. */
const EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

/** Cap the per-file drill-down so a wholly-empty `include` prints a page, not a book. */
const MAX_NAMED = 25;

const BIOME = existsSync("node_modules/.bin/biome") ? "node_modules/.bin/biome" : "biome";

/** Biome's own default for `files.maxSize` when the config does not set one. */
const BIOME_DEFAULT_MAX_SIZE = 1024 * 1024;

/**
 * The byte cap above which Biome refuses a file outright — read from the config
 * rather than hard-coded, so raising `files.maxSize` raises this in the same
 * edit and the two can never disagree.
 */
function maxFileSize(): number {
  const raw = readFileSync("biome.json", "utf8");
  const cfg = JSON.parse(raw) as { files?: { maxSize?: number } };
  return cfg.files?.maxSize ?? BIOME_DEFAULT_MAX_SIZE;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Every file Biome is expected to see: tracked files plus untracked ones that
 * `.gitignore` does not cover (so `tmp/`, `dist/` and friends stay out), minus
 * anything deleted from the working tree but still in the index.
 */
function sourceFiles(): string[] {
  const patterns = EXTENSIONS.map((e) => `*.${e}`);
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...patterns],
    { encoding: "utf8" },
  );
  if (git.status !== 0) fail(`lint-coverage: git ls-files failed:\n${git.stderr}`);
  const seen = new Set(git.stdout.split("\0").filter(Boolean));
  return [...seen].filter((f) => existsSync(f)).sort();
}

/**
 * How many of `files` Biome actually processed. Reads the count off the summary
 * line and IGNORES the exit code: a lint error is not a coverage failure, and
 * "no files were processed" is an error exit with no summary line at all.
 */
function checkedCount(files: string[]): number {
  if (files.length === 0) return 0;
  const r = spawnSync(BIOME, ["lint", "--max-diagnostics=0", ...files], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/Checked (\d+) files? in/);
  if (m) return Number(m[1]);
  if (/No files were processed/.test(out)) return 0;
  fail(`lint-coverage: could not read a file count out of Biome:\n${out}`);
}

function dirOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? "." : file.slice(0, i);
}

const files = sourceFiles();
if (files.length === 0) fail("lint-coverage: found no source files at all — that cannot be right.");

// Size first: a refused file is still COUNTED below, so the count can never
// catch this one.
const limit = maxFileSize();
const oversize = files.filter((f) => statSync(f).size > limit).sort();
if (oversize.length > 0) {
  const named = oversize.map((f) => `  ${f} — ${statSync(f).size} bytes`).join("\n");
  fail(
    [
      `lint-coverage: FAIL — ${oversize.length} source file(s) exceed Biome's `,
      `\`files.maxSize\` of ${limit} bytes:\n${named}\n\n`,
      "Biome REFUSES these files and still counts them as checked, so they are\n",
      "linted by NOTHING while every lint step exits 0.\n\n",
      "Fix by raising `files.maxSize` in biome.json, or by splitting the file\n",
      "(NOT by deleting this check).",
    ].join(""),
  );
}

const checked = checkedCount(files);
if (checked === files.length) {
  console.log(`lint-coverage: OK — all ${files.length} source files are covered by Biome.`);
  process.exit(0);
}

// Short. Localise it: per directory first (bounded by the directory count),
// then per file inside only the directories that came up short.
const byDir = new Map<string, string[]>();
for (const f of files) {
  const d = dirOf(f);
  const list = byDir.get(d);
  if (list) list.push(f);
  else byDir.set(d, [f]);
}

const uncovered: string[] = [];
const shortDirs: string[] = [];
for (const [dir, group] of [...byDir].sort()) {
  const got = checkedCount(group);
  if (got === group.length) continue;
  shortDirs.push(`  ${dir}/  — Biome saw ${got} of ${group.length}`);
  if (uncovered.length >= MAX_NAMED) continue;
  for (const f of group) {
    if (uncovered.length >= MAX_NAMED) break;
    if (checkedCount([f]) === 0) uncovered.push(f);
  }
}

const named =
  uncovered.length > 0 ? uncovered.map((f) => `  ${f}`).join("\n") : "  (none isolated)";
const more =
  uncovered.length >= MAX_NAMED ? `\n  … and more (drill-down capped at ${MAX_NAMED}).` : "";

fail(
  [
    `lint-coverage: FAIL — Biome processed ${checked} of ${files.length} source files.\n`,
    `${files.length - checked} file(s) in this repo are linted by NOTHING.\n\n`,
    `Directories that came up short:\n${shortDirs.join("\n")}\n\n`,
    `Files Biome cannot see:\n${named}${more}\n\n`,
    "Fix by widening `files.include` in biome.json (NOT by deleting this check).\n",
    "This is D212: a lint step that exits 0 on an empty file set is not coverage.",
  ].join(""),
);
