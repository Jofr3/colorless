#!/usr/bin/env bun
/**
 * Fails when a code comment carries a decision, audit, phase or milestone id or a date, which the
 * minimal-comments rule (conventions.md "Code & quality") keeps out of code and tests: that record
 * belongs in docs/decisions.md and git, and the reason a comment gives must stand without it.
 * It reads comments only (TypeScript and JavaScript through the TypeScript scanner, Lua `--` and
 * `--[[ ]]`, YAML `#`), never strings: a test title, a mutant row's `id` and `decision` and a log
 * line are data, and the coverage tests' titles name the decision whose sections they pin.
 */

import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { type Report, runReport } from "./lib/cli";
import { repoPath, repoSourceFiles } from "./lib/repo";

export type Comment = { line: number; text: string };

/** The audit areas whose finding ids (an area, an optional X, a number) have reached comments. */
const AUDIT_AREAS =
  "AD|AEX|API|AR|AU|AUTH|AUX|BLD|BR|BT|CA|CAT|CI|CIM|DECK|DEP|DEPM|DES|DK|EN|ENT|ENV|ERR|FU|" +
  "LB|LC|LOB|LQX|MET|MI|MIX|OBS|OLD|OP|OPS|PERF|PG|PRC|QA|REF|REL|SEC|SM|TRN|UI|USE|VER|WC|WP";

/** Each id form, with the name a failure prints. The database is `D1`, the bucket `R2` and set
    codes are lowercase, so a decision number needs two or more digits; `P1` and `P2` also name the
    seats, so a bare program phase (`P4`) is left to review. */
export const ID_FORMS: readonly { name: string; re: RegExp }[] = [
  { name: "decision number", re: /\bD[0-9]{2,3}[a-z]?\b/ },
  { name: "decision number", re: /\bdecision [0-9]+[a-z]?\b/i },
  { name: "audit phase", re: /\b[A-Z]{2,5}-[A-Z]{1,3}[0-9]{1,2}\b/ },
  { name: "audit finding", re: new RegExp(`\\b(?:${AUDIT_AREAS})X?[0-9]{1,2}\\b`) },
  { name: "card revision", re: /\bB[0-9]{2}\b/ },
  { name: "audit finding", re: /\b(?:audit|finding|revision)s? [A-Z]{1,5}X?[0-9]{1,2}\b/ },
  {
    name: "program phase",
    re: /\bP[0-9]-(?:[0-9]+|M[0-9])\b|\bP[0-9] (?:increment|milestone|task|[0-9][a-z])/,
  },
  { name: "program phase", re: /\bPhase [0-9]\b/ },
  { name: "milestone", re: /\bM[1-9]\b/ },
  { name: "milestone", re: /\b(?:milestone|increment) [0-9]+\b/i },
  { name: "date", re: /\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b/ },
];

/** Line number (from 1) of each offset, from the offsets where lines start. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** One entry per line of each comment, so a hit inside a block comment names its own line. */
function split(lineOf: (offset: number) => number, start: number, body: string): Comment[] {
  const first = lineOf(start);
  return body.split("\n").map((text, i) => ({ line: first + i, text }));
}

/** A `/` after one of these ends an expression (division); anywhere else it opens a regex. */
const ENDS_EXPRESSION = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

const TRIVIA = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.ShebangTrivia,
  ts.SyntaxKind.ConflictMarkerTrivia,
]);

/** The comments of a TypeScript or JavaScript file. Template literals and regex literals are
    skipped as tokens, so a `//` inside one is not a comment. */
export function scriptComments(text: string): Comment[] {
  const lineOf = lineIndex(text);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const out: Comment[] = [];
  /** One entry per open `{`: true when it is a template's `${`. */
  const braces: boolean[] = [];
  let previous = ts.SyntaxKind.Unknown;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      out.push(...split(lineOf, scanner.getTokenStart(), scanner.getTokenText()));
      continue;
    }
    if (TRIVIA.has(kind)) continue;
    if (kind === ts.SyntaxKind.OpenBraceToken) braces.push(false);
    else if (kind === ts.SyntaxKind.TemplateHead) braces.push(true);
    else if (kind === ts.SyntaxKind.CloseBraceToken && braces.pop() === true) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateMiddle) braces.push(true);
    } else if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      !ENDS_EXPRESSION.has(previous)
    ) {
      kind = scanner.reScanSlashToken();
    }
    previous = kind;
  }
  return out;
}

/** Length of a Lua long bracket opening at `at` (`[[`, `[=[`, ...) and its level, or undefined. */
function longBracket(text: string, at: number): { level: number; length: number } | undefined {
  if (text[at] !== "[") return undefined;
  let level = 0;
  while (text[at + 1 + level] === "=") level++;
  return text[at + 1 + level] === "[" ? { level, length: level + 2 } : undefined;
}

/** The comments of a Lua file: `--` to the end of the line and `--[[ ]]` blocks, skipping
    quoted and long-bracket strings. */
export function luaComments(text: string): Comment[] {
  const lineOf = lineIndex(text);
  const out: Comment[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      const open = longBracket(text, i + 2);
      if (open) {
        const close = `]${"=".repeat(open.level)}]`;
        const end = text.indexOf(close, i + 2 + open.length);
        const stop = end === -1 ? text.length : end + close.length;
        out.push(...split(lineOf, i, text.slice(i, stop)));
        i = stop;
      } else {
        const end = text.indexOf("\n", i);
        const stop = end === -1 ? text.length : end;
        out.push(...split(lineOf, i, text.slice(i, stop)));
        i = stop;
      }
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
      i++;
    } else {
      const open = longBracket(text, i);
      if (open) {
        const end = text.indexOf(`]${"=".repeat(open.level)}]`, i + open.length);
        i = end === -1 ? text.length : end + open.length;
      } else i++;
    }
  }
  return out;
}

/** The comments of a YAML file: a `#` at the start of a line or after a space, outside quotes.
    A workflow's shell blocks use the same marker. */
export function hashComments(text: string): Comment[] {
  const out: Comment[] = [];
  text.split("\n").forEach((line, i) => {
    let quote: string | undefined;
    for (let at = 0; at < line.length; at++) {
      const c = line[at];
      if (quote) {
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "#" && (at === 0 || /\s/.test(line[at - 1] ?? ""))) {
        out.push({ line: i + 1, text: line.slice(at) });
        return;
      }
    }
  });
  return out;
}

export function commentsOf(path: string, text: string): Comment[] {
  if (path.endsWith(".lua")) return luaComments(text);
  if (/\.ya?ml$/.test(path)) return hashComments(text);
  return scriptComments(text);
}

export type SourceFile = { path: string; text: string };

export function commentGuardReport(files: readonly SourceFile[]): Report {
  const problems: string[] = [];
  for (const { path, text } of files) {
    for (const comment of commentsOf(path, text)) {
      const form = ID_FORMS.find(({ re }) => re.test(comment.text));
      if (form) problems.push(`  ${path}:${comment.line}: (${form.name}) ${comment.text.trim()}`);
    }
  }
  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        `comment-guard: FAIL — ${problems.length} comment line(s) carry an id or a date:`,
        ...problems,
        "Keep the reason and drop the id, date or history: that record belongs in docs/decisions.md",
        'and git (conventions.md "Code & quality").',
      ],
    };
  }
  return { ok: true, lines: [`${files.length} files' comments carry no id or date`] };
}

/** Generated files whose comments come from elsewhere: wrangler's runtime types quote Cloudflare's
    compatibility dates. */
const GENERATED = new Set(["apps/api/worker-configuration.d.ts"]);

function watchedFiles(): SourceFile[] {
  return repoSourceFiles(["ts", "tsx", "js", "mjs", "cjs", "lua"])
    .concat(repoSourceFiles(["yml", "yaml"]).filter((p) => p.startsWith(".github/")))
    .filter((path) => !GENERATED.has(path))
    .map((path) => ({ path, text: readFileSync(repoPath(path), "utf8") }));
}

if (import.meta.main) runReport("comment-guard", () => commentGuardReport(watchedFiles()));
