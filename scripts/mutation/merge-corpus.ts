#!/usr/bin/env bun
/**
 * Merges three versions of the mutant corpus row by row, keyed by `id`. A row changed on one side
 * takes that side, rows only theirs added follow ours' last row in theirs' order, and the text
 * around the rows merges the same way. An id changed differently on both sides, deleted on one
 * and changed on the other, or added twice with different text is refused.
 *
 * As git's merge driver (`.gitattributes` names it `corpus`), it writes the merge into %A; on a
 * refusal it leaves git's ordinary conflict there and exits 1:
 *
 *   bun scripts/mutation/merge-corpus.ts %O %A %B
 *
 * With no arguments, after a conflicted merge, it reads the three index stages of the checkout it
 * runs in and writes that checkout's corpus. Run `bun run mutants:precheck` after either.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { join } from "node:path";
import { fail } from "../lib/cli";

const CORPUS = "scripts/mutation/mutants.ts";

/** A corpus cut at its rows. Each row's text runs from the end of the previous row (so it holds
    its own leading comments) through its comma; `head` and `tail` are the text around them. */
type Rows = { head: string; tail: string; order: string[]; rows: Map<string, string> };

function rowsOf(text: string, side: string): Rows {
  const sf = ts.createSourceFile(CORPUS, text, ts.ScriptTarget.Latest);
  let list: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "MUTANTS" &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      list = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  const first = list?.elements[0];
  if (list === undefined || first === undefined) throw new Error(`${side}: no MUTANTS rows`);
  const order: string[] = [];
  const rows = new Map<string, string>();
  let end = first.pos;
  for (const el of list.elements) {
    const id = ts.isObjectLiteralExpression(el)
      ? el.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "id",
        )?.initializer
      : undefined;
    if (id === undefined || !ts.isStringLiteralLike(id))
      throw new Error(`${side}: a row has no literal id`);
    if (rows.has(id.text)) throw new Error(`${side}: more than one row carries id ${id.text}`);
    end = text[el.end] === "," ? el.end + 1 : el.end;
    order.push(id.text);
    rows.set(id.text, text.slice(el.pos, end));
  }
  return { head: text.slice(0, first.pos), tail: text.slice(end), order, rows };
}

const CONFLICT = Symbol("conflict");

function threeWay<T>(base: T, ours: T, theirs: T): T | typeof CONFLICT {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;
  return CONFLICT;
}

function conflictOf(id: string, base?: string, ours?: string, theirs?: string): string {
  if (base === undefined) return `${id}: added on both sides with different text`;
  if (ours === undefined || theirs === undefined)
    return `${id}: deleted on one side and changed on the other`;
  return `${id}: changed differently on both sides`;
}

export type CorpusMerge =
  | { ok: true; text: string; added: number }
  | { ok: false; problems: string[] };

export function mergeCorpus(base: string, ours: string, theirs: string): CorpusMerge {
  let b: Rows;
  let o: Rows;
  let t: Rows;
  try {
    [b, o, t] = [rowsOf(base, "base"), rowsOf(ours, "ours"), rowsOf(theirs, "theirs")];
  } catch (error) {
    return { ok: false, problems: [(error as Error).message] };
  }
  const problems: string[] = [];
  const around = (part: "head" | "tail", where: string): string => {
    const merged = threeWay(b[part], o[part], t[part]);
    if (merged !== CONFLICT) return merged;
    problems.push(`the text ${where} the rows changed differently on both sides`);
    return o[part];
  };
  const head = around("head", "before");
  const tail = around("tail", "after");
  const ids = [...o.order, ...t.order.filter((id) => !o.rows.has(id))];
  const kept: string[] = [];
  for (const id of ids) {
    const [bRow, oRow, tRow] = [b.rows.get(id), o.rows.get(id), t.rows.get(id)];
    const row = threeWay(bRow, oRow, tRow);
    if (row === CONFLICT) problems.push(conflictOf(id, bRow, oRow, tRow));
    else if (row !== undefined) kept.push(row);
  }
  if (problems.length > 0) return { ok: false, problems };
  const last = kept.length - 1;
  const body = kept.map((row, i) => (i < last && !row.endsWith(",") ? `${row},` : row)).join("");
  const added = t.order.filter((id) => !b.rows.has(id) && !o.rows.has(id)).length;
  return { ok: true, text: head + body + tail, added };
}

function refused(problems: string[]): void {
  console.error(`merge-corpus: REFUSED — ${CORPUS} needs these rows merged by hand:`);
  for (const problem of problems) console.error(`  ${problem}`);
}

function main(argv: string[]): void {
  if (argv.length === 3) {
    const [basePath = "", oursPath = "", theirsPath = ""] = argv;
    const read = (path: string) => readFileSync(path, "utf8");
    const merge = mergeCorpus(read(basePath), read(oursPath), read(theirsPath));
    if (merge.ok) {
      writeFileSync(oursPath, merge.text);
      return;
    }
    refused(merge.problems);
    const labels = ["-L", "ours", "-L", "base", "-L", "theirs"];
    spawnSync("git", ["merge-file", ...labels, oursPath, basePath, theirsPath]);
    process.exit(1);
  }
  if (argv.length !== 0) fail("usage: bun scripts/mutation/merge-corpus.ts [%O %A %B]");
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
  const stage = (n: number) => git("show", `:${String(n)}:${CORPUS}`);
  const merge = mergeCorpus(stage(1), stage(2), stage(3));
  if (!merge.ok) {
    refused(merge.problems);
    process.exit(1);
  }
  writeFileSync(join(git("rev-parse", "--show-toplevel").trim(), CORPUS), merge.text);
  console.log(
    `merge-corpus: merged ${CORPUS}, ${String(merge.added)} row(s) from theirs. Run \`bun run mutants:precheck\`, then \`git add ${CORPUS}\`.`,
  );
}

if (import.meta.main) main(process.argv.slice(2));
