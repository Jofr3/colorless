// Re-anchors mutant rows whose `find` no longer occurs exactly once after a refactor that only
// moved code: reformatting, deleted comments, or a split into another file of the same package.
//
//   bun scripts/mutation/reanchor.ts          # report only
//   bun scripts/mutation/reanchor.ts --write  # rewrite scripts/mutation/mutants.ts
//   bun scripts/mutation/reanchor.ts --write --accept-symbols  # also take reviewed symbol renames
//   bun scripts/mutation/reanchor.ts --retire <file of ids, one per line>
//
// A broken row is matched ignoring whitespace, comments and trailing commas. When exactly one site
// matches (first in the row's own file, then across the package), `find` becomes the exact text
// there, `file` points to it, and comments are dropped from `replace`. A row that records a
// `symbol` only moves to a site inside that same declaration, so it cannot latch onto an identical
// fragment elsewhere. Unmatched rows are listed; precheck.ts stays the strict gate. `--write` also
// fills in a missing `symbol`. An intact row whose text now sits in another declaration is listed,
// since that is either a rename or a twin left behind after the original was rewritten; check
// which, then re-point the row or pass `--accept-symbols`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
// TypeScript 7 (the Go compiler) has no stable compiler API yet, so the parser comes from
// TypeScript 6 under its own name; port to TS 7.1's API when it is stable (DEP-P5).
import ts from "@typescript/typescript6";
import { REPO_ROOT, repoPath, sourceCache } from "../lib/repo";
import { MUTANTS, type Mutant } from "./mutants";
import { currentSymbol, enclosingSymbol } from "./symbol";

const CORPUS = "scripts/mutation/mutants.ts";

const sourceOf = sourceCache();

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Index of a `//` that starts a line comment, or -1. A `//` inside a string on
    the same line (odd number of quotes before it) or glued to a preceding
    character (e.g. `https://`) is not a comment. */
function lineCommentStart(line: string): number {
  for (let at = line.indexOf("//"); at !== -1; at = line.indexOf("//", at + 2)) {
    const before = line.slice(0, at);
    if (before.length > 0 && !/\s$/.test(before)) continue;
    const quotes = (before.match(/["'`]/g) ?? []).length;
    if (quotes % 2 === 0) return at;
  }
  return -1;
}

/** Drops comment lines, block comments and trailing line comments from a code
    fragment. Line-based and conservative: anything ambiguous is kept. */
export function stripComments(fragment: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of fragment.split("\n")) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    if (trimmed.startsWith("//")) continue;
    const at = lineCommentStart(line);
    out.push(at === -1 ? line : line.slice(0, at).trimEnd());
  }
  return out.join("\n");
}

const GAP = String.raw`(?:\s|//[^\n]*|/\*[\s\S]*?\*/)`;
const CLOSERS = new Set([")", "]", "}"]);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex matching `fragment` with any whitespace, comments and optional
    trailing commas between its tokens. */
export function looseMatcher(fragment: string): { regex: RegExp; first: string } | null {
  const atoms: { text: string; spaced: boolean }[] = [];
  const re = /([A-Za-z0-9_$]+|\S)/g;
  let last = 0;
  for (let m = re.exec(fragment); m !== null; m = re.exec(fragment)) {
    atoms.push({ text: m[0], spaced: m.index > last });
    last = m.index + m[0].length;
  }
  if (atoms.length === 0) return null;
  let pattern = "";
  atoms.forEach((atom, i) => {
    const prev = atoms[i - 1];
    if (prev !== undefined) {
      const words = /\w$/.test(prev.text) && /^\w/.test(atom.text);
      pattern += words && atom.spaced ? `${GAP}+` : `${GAP}*`;
    }
    const next = atoms[i + 1];
    if (atom.text === "," && next !== undefined && CLOSERS.has(next.text)) {
      pattern += ",?";
    } else {
      if (CLOSERS.has(atom.text) && prev?.text !== ",") pattern += `(?:,${GAP}*)?`;
      pattern += escapeRegex(atom.text);
    }
  });
  return { regex: new RegExp(pattern, "y"), first: atoms[0]?.text ?? "" };
}

/** Up to two match sites. The sticky regex is tried only where the first token
    occurs, which keeps a 1.5 MB file fast. */
function looseSites(
  text: string,
  matcher: { regex: RegExp; first: string },
): { start: number; end: number }[] {
  const sites: { start: number; end: number }[] = [];
  for (let at = text.indexOf(matcher.first); at !== -1; at = text.indexOf(matcher.first, at + 1)) {
    matcher.regex.lastIndex = at;
    const m = matcher.regex.exec(text);
    if (m === null) continue;
    sites.push({ start: at, end: at + m[0].length });
    if (sites.length > 1) break;
    at += m[0].length - 1;
  }
  return sites;
}

/** Source files a row may have moved to: the non-test TypeScript files of the
    package (or top-level directory) that holds its current file. */
function siblingsOf(file: string): string[] {
  const parts = file.split("/");
  const depth = parts[0] === "packages" || parts[0] === "apps" ? 2 : 1;
  const root = parts.slice(0, depth).join("/");
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", root],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return listed
    .split("\n")
    .filter(
      (f) => /\.(ts|lua|js|mjs)$/.test(f) && !f.includes(".test.") && f !== file && f !== CORPUS,
    );
}

type Fix = { mutant: Mutant; file: string; find: string; replace: string };

/** A rewrite of one row: new anchor fields (absent to keep) and its symbol
    (undefined to drop the property). */
type RowPatch = { file?: string; find?: string; replace?: string; symbol: string | undefined };

function reanchor(mutant: Mutant): Fix | null {
  const code = stripComments(mutant.find);
  const matcher = looseMatcher(code);
  if (matcher === null) return null;
  const replace = stripComments(mutant.replace);
  const fits = (file: string, site: { start: number; end: number }) =>
    mutant.symbol === undefined ||
    enclosingSymbol(file, sourceOf(file), site.start, site.end) === mutant.symbol;
  let own: { start: number; end: number }[] = [];
  try {
    own = looseSites(sourceOf(mutant.file), matcher);
  } catch {
    // The file itself was removed; look for the code elsewhere.
  }
  if (own.length > 1 && mutant.symbol === undefined) return null;
  const candidates = own
    .filter((site) => fits(mutant.file, site))
    .map((site) => ({ file: mutant.file, site }));
  if (candidates.length === 0) {
    for (const file of siblingsOf(mutant.file)) {
      const sites = looseSites(sourceOf(file), matcher).filter((site) => fits(file, site));
      for (const site of sites) candidates.push({ file, site });
      if (candidates.length > 1) return null;
    }
  }
  if (candidates.length !== 1) return null;
  const hit = candidates[0];
  if (hit === undefined || hit.site === undefined) return null;
  const text = sourceOf(hit.file);
  const find = text.slice(hit.site.start, hit.site.end);
  if (occurrences(text, find) !== 1) return null;
  return { mutant, file: hit.file, find, replace };
}

/** Rewrites the anchor fields and `symbol` of each patched row. A new `symbol`
    goes right after `file`. */
function rewriteCorpus(patches: Map<string, RowPatch>): void {
  const text = readFileSync(repoPath(CORPUS), "utf8");
  const sf = ts.createSourceFile(CORPUS, text, ts.ScriptTarget.Latest, true);
  const pending = new Map(patches);
  const edits: { start: number; end: number; text: string }[] = [];
  const afterComma = (at: number) => (text[at] === "," ? at + 1 : at);
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, ts.PropertyAssignment>();
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p);
      }
      const idInit = props.get("id")?.initializer;
      const id = idInit !== undefined && ts.isStringLiteral(idInit) ? idInit.text : undefined;
      const patch = id === undefined ? undefined : pending.get(id);
      if (id !== undefined && patch !== undefined) {
        for (const key of ["file", "find", "replace"] as const) {
          const value = patch[key];
          if (value === undefined) continue;
          const init = props.get(key)?.initializer;
          if (init === undefined) throw new Error(`${id}: no ${key} property`);
          edits.push({ start: init.getStart(sf), end: init.getEnd(), text: JSON.stringify(value) });
        }
        const existing = props.get("symbol");
        if (existing !== undefined && patch.symbol === undefined) {
          edits.push({
            start: existing.getFullStart(),
            end: afterComma(existing.getEnd()),
            text: "",
          });
        } else if (existing !== undefined && patch.symbol !== undefined) {
          const init = existing.initializer;
          edits.push({
            start: init.getStart(sf),
            end: init.getEnd(),
            text: JSON.stringify(patch.symbol),
          });
        } else if (patch.symbol !== undefined) {
          const file = props.get("file");
          if (file === undefined) throw new Error(`${id}: no file property`);
          const lineStart = text.lastIndexOf("\n", file.getStart(sf)) + 1;
          const indent = text.slice(lineStart, file.getStart(sf));
          const at = afterComma(file.getEnd());
          edits.push({
            start: at,
            end: at,
            text: `\n${indent}symbol: ${JSON.stringify(patch.symbol)},`,
          });
        }
        pending.delete(id);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (pending.size > 0)
    throw new Error(`rows not found in ${CORPUS}: ${[...pending.keys()].join(", ")}`);
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  writeFileSync(repoPath(CORPUS), out);
}

/** Deletes whole rows (with their leading comments) from the corpus. Used for
    rows whose code or killing test no longer exists. */
function retireRows(ids: Set<string>): void {
  const text = readFileSync(repoPath(CORPUS), "utf8");
  const sf = ts.createSourceFile(CORPUS, text, ts.ScriptTarget.Latest, true);
  const cuts: { start: number; end: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue;
        const id = el.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "id",
        )?.initializer;
        if (id === undefined || !ts.isStringLiteral(id) || !ids.has(id.text)) continue;
        let end = el.getEnd();
        if (text[end] === ",") end++;
        cuts.push({ start: el.getFullStart(), end });
        ids.delete(id.text);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (ids.size > 0) throw new Error(`rows not found: ${[...ids].join(", ")}`);
  cuts.sort((a, b) => b.start - a.start);
  let out = text;
  for (const c of cuts) out = out.slice(0, c.start) + out.slice(c.end);
  writeFileSync(repoPath(CORPUS), out);
  console.log(`retired ${cuts.length} row(s)`);
}

if (import.meta.main && process.argv.includes("--retire")) {
  const list = process.argv[process.argv.indexOf("--retire") + 1];
  if (list === undefined) throw new Error("--retire needs a file of row ids");
  retireRows(
    new Set(
      readFileSync(list, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  );
} else if (import.meta.main) {
  const broken = MUTANTS.filter((m) => {
    try {
      return occurrences(sourceOf(m.file), m.find) !== 1;
    } catch {
      return true;
    }
  });
  const fixes: Fix[] = [];
  const unresolved: Mutant[] = [];
  for (const m of broken) {
    const fix = reanchor(m);
    if (fix === null) unresolved.push(m);
    else fixes.push(fix);
  }

  console.log(
    `${broken.length} broken row(s): ${fixes.length} re-anchored, ${unresolved.length} unresolved`,
  );
  for (const f of fixes) {
    if (f.file !== f.mutant.file)
      console.log(`  moved ${f.mutant.id}: ${f.mutant.file} -> ${f.file}`);
  }
  for (const m of unresolved) console.log(`  UNRESOLVED ${m.id} (${m.file})`);
  const patches = new Map<string, RowPatch>();
  for (const f of fixes) {
    const text = sourceOf(f.file);
    patches.set(f.mutant.id, {
      file: f.file,
      find: f.find,
      replace: f.replace,
      symbol: currentSymbol({ file: f.file, find: f.find }, text),
    });
  }
  const brokenIds = new Set(broken.map((m) => m.id));
  const acceptSymbols = process.argv.includes("--accept-symbols");
  let backfilled = 0;
  let renamed = 0;
  for (const m of MUTANTS) {
    if (brokenIds.has(m.id)) continue;
    const symbol = currentSymbol(m, sourceOf(m.file));
    if (symbol === m.symbol) continue;
    if (m.symbol === undefined) {
      patches.set(m.id, { symbol });
      backfilled++;
      continue;
    }
    // The text now sits in another declaration: a rename, or a twin left behind
    // after the original was rewritten. Only a reviewed rename is accepted.
    console.log(`  SYMBOL ${m.id}: ${m.symbol} -> ${symbol ?? "(none)"}`);
    if (acceptSymbols) {
      patches.set(m.id, { symbol });
      renamed++;
    }
  }
  if (backfilled > 0) console.log(`${backfilled} row(s) without a symbol`);
  if (process.argv.includes("--write") && patches.size > 0) {
    rewriteCorpus(patches);
    console.log(
      `rewrote ${fixes.length} re-anchored, ${backfilled} backfilled and ${renamed} renamed row(s) in ${CORPUS}`,
    );
  }
}
