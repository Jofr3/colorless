#!/usr/bin/env bun
/**
 * Op-coverage instrument (`bun scripts/mutation/opcoverage.ts`): for each `EffectOp` kind, counts
 * corpus rows quoting its producer region (effects.ts, registry.ts) and its implementation region
 * (interpreter.ts case arms plus helpers with fan-in ≤ FANIN), and reports seat-line coverage. It
 * cannot see implementations outside interpreter.ts, resume-side code such as `continuationOps`, or
 * whether a row is any good. Env: `FANIN` (default 4), `LEV` (default 2).
 */

import { readFileSync } from "node:fs";
import { type Mutant, MUTANTS } from "./mutants";

const FANIN = Number(process.env.FANIN ?? 4);
const LEV = Number(process.env.LEV ?? 2);

const EFFECTS = "packages/engine/src/effects.ts";
const REGISTRY = "packages/engine/src/registry.ts";
const INTERP = "packages/engine/src/interpreter.ts";

const sourceCache = new Map<string, string>();
function source(file: string): string {
  const hit = sourceCache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, "utf8");
  sourceCache.set(file, text);
  return text;
}

/** Byte offset of the first character of each 0-based line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

// ─── 1. THE KINDS ────────────────────────────────────────────────────────────
// Derived from the union itself. No line numbers: find the `export type
// EffectOp =` header, then read until the first line that starts a NEW
// top-level declaration (column-0 content), which is the union's terminator.
function effectOpKinds(): { kinds: string[]; declarations: number } {
  const lines = source(EFFECTS).split("\n");
  const head = lines.findIndex((l) => l.startsWith("export type EffectOp ="));
  if (head < 0) throw new Error("opcoverage: `export type EffectOp =` not found in effects.ts");
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  // Strip comments first: the union's doc blocks mention op shapes that do not exist.
  const body = lines
    .slice(head + 1, end)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const kinds = new Set<string>();
  let declarations = 0;
  for (const m of body.matchAll(/\bop: "([A-Za-z0-9_]+)"/g)) {
    const kind = m[1];
    if (kind === undefined) continue;
    declarations++;
    kinds.add(kind);
  }
  if (kinds.size === 0) throw new Error("opcoverage: the EffectOp union yielded no kinds");
  return { kinds: [...kinds].sort(), declarations };
}

const { kinds: KINDS, declarations: DECLARATIONS } = effectOpKinds();

// ─── 2. TOP-LEVEL FUNCTIONS OF interpreter.ts, AND WHO CALLS WHOM ────────────
type Fn = { name: string; start: number; end: number; body: string };

const interpLines = source(INTERP).split("\n");
const interpStarts = lineStarts(source(INTERP));

function topLevelFunctions(lines: string[]): Fn[] {
  const out: Fn[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m =
      line.match(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/) ??
      line.match(/^(?:export )?const ([A-Za-z0-9_]+) = \(/);
    const name = m?.[1];
    if (name === undefined) continue;
    // A top-level body closes on the first column-0 `}`.
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}/.test(lines[j] ?? "")) {
        end = j;
        break;
      }
    }
    out.push({ name, start: i, end, body: lines.slice(i, end + 1).join("\n") });
  }
  return out;
}

const FNS = topLevelFunctions(interpLines);
const FN_BY_NAME = new Map(FNS.map((f) => [f.name, f]));
const CALLEES = new Map<string, string[]>();
for (const f of FNS) {
  CALLEES.set(
    f.name,
    FNS.filter((g) => g.name !== f.name && new RegExp(`\\b${g.name}\\s*\\(`).test(f.body)).map(
      (g) => g.name,
    ),
  );
}

// ─── 3. THE `case "K":` ARMS ─────────────────────────────────────────────────
type Arm = { op: string; start: number; end: number };

function switchArms(lines: string[]): Arm[] {
  const arms: Arm[] = [];
  const heads: number[] = [];
  lines.forEach((l, i) => {
    if (/switch \(op\.op\) \{/.test(l)) heads.push(i);
  });
  for (const head of heads) {
    const indent = (lines[head] ?? "").match(/^ */)?.[0].length ?? 0;
    const caseRe = new RegExp(`^ {${indent + 2}}(case "([A-Za-z0-9_]+)":|default:)`);
    const endRe = new RegExp(`^ {${indent}}\\}`);
    const labels: { line: number; op: string | undefined }[] = [];
    let blockEnd = lines.length - 1;
    for (let i = head + 1; i < lines.length; i++) {
      if (endRe.test(lines[i] ?? "")) {
        blockEnd = i;
        break;
      }
      const m = (lines[i] ?? "").match(caseRe);
      if (m) labels.push({ line: i, op: m[2] });
    }
    // Consecutive labels share one body (fallthrough): group, then give the
    // whole body to every kind in the group.
    for (let k = 0; k < labels.length; k++) {
      let last = k;
      while (
        last + 1 < labels.length &&
        (labels[last + 1]?.line ?? -1) === (labels[last]?.line ?? -1) + 1
      ) {
        last++;
      }
      const start = labels[k]?.line ?? 0;
      const next = labels[last + 1]?.line;
      const end = (next ?? blockEnd) - 1;
      for (let j = k; j <= last; j++) {
        const op = labels[j]?.op;
        if (op !== undefined) arms.push({ op, start, end });
      }
      k = last;
    }
  }
  return arms;
}

const ARMS = switchArms(interpLines);

// ─── 4. TRANSITIVE REACH, FAN-IN, AND THE IMPLEMENTATION LINE SETS ───────────
const REACH = new Map<string, Set<string>>();
for (const k of KINDS) REACH.set(k, new Set<string>());
for (const arm of ARMS) {
  const seen = REACH.get(arm.op);
  if (seen === undefined) continue;
  const body = interpLines.slice(arm.start, arm.end + 1).join("\n");
  const stack = FNS.filter((g) => new RegExp(`\\b${g.name}\\s*\\(`).test(body)).map((g) => g.name);
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    for (const c of CALLEES.get(n) ?? []) if (!seen.has(c)) stack.push(c);
  }
}

const FAN_IN = new Map<string, number>();
for (const f of FNS) {
  FAN_IN.set(f.name, KINDS.filter((k) => REACH.get(k)?.has(f.name) === true).length);
}

/** Implementation region as a set of 0-based line numbers in `interpreter.ts`. */
const IMPL_LINES = new Map<string, Set<number>>();
for (const k of KINDS) IMPL_LINES.set(k, new Set<number>());
for (const arm of ARMS) {
  const set = IMPL_LINES.get(arm.op);
  if (set === undefined) continue;
  for (let i = arm.start; i <= arm.end; i++) set.add(i);
}
for (const k of KINDS) {
  const set = IMPL_LINES.get(k);
  if (set === undefined) continue;
  for (const name of REACH.get(k) ?? []) {
    if ((FAN_IN.get(name) ?? Number.POSITIVE_INFINITY) > FANIN) continue;
    const f = FN_BY_NAME.get(name);
    if (f === undefined) continue;
    for (let i = f.start; i <= f.end; i++) set.add(i);
  }
}

// ─── 5. PRODUCER REGIONS ─────────────────────────────────────────────────────
type Span = { from: number; to: number; kind: string };

function producerSpans(file: string): Span[] {
  const text = source(file);
  const out: Span[] = [];
  const re = /\bop: "([A-Za-z0-9_]+)"/g;
  let m = re.exec(text);
  while (m !== null) {
    const kind = m[1];
    if (kind !== undefined && KINDS.includes(kind)) {
      let pos = m.index;
      let open = -1;
      for (let lev = 0; lev < LEV; lev++) {
        let depth = 0;
        open = -1;
        for (let i = pos; i >= 0; i--) {
          const c = text[i];
          if (c === "}") depth++;
          else if (c === "{") {
            if (depth === 0) {
              open = i;
              break;
            }
            depth--;
          }
        }
        if (open < 0) break;
        pos = open - 1;
      }
      if (open >= 0) {
        let depth = 0;
        let close = -1;
        for (let i = open; i < text.length; i++) {
          const c = text[i];
          if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) {
              close = i + 1;
              break;
            }
          }
        }
        if (close >= 0) out.push({ from: open, to: close, kind });
      }
    }
    m = re.exec(text);
  }
  return out;
}

const PRODUCERS = new Map<string, Span[]>([
  [EFFECTS, producerSpans(EFFECTS)],
  [REGISTRY, producerSpans(REGISTRY)],
]);

// ─── 6. ATTRIBUTE THE CORPUS ─────────────────────────────────────────────────
/** The 0-based line span a row's `find` occupies, or undefined when absent. */
function findLineSpan(row: Mutant): { first: number; last: number } | undefined {
  if (row.file !== INTERP) return undefined;
  const at = source(INTERP).indexOf(row.find);
  if (at < 0) return undefined;
  const stop = at + row.find.length;
  let first = 0;
  while (first + 1 < interpStarts.length && (interpStarts[first + 1] ?? 0) <= at) first++;
  let last = first;
  while (last + 1 < interpStarts.length && (interpStarts[last + 1] ?? 0) < stop) last++;
  return { first, last };
}

const PROD_ROWS = new Map<string, Set<string>>();
const IMPL_ROWS = new Map<string, Set<string>>();
const QUOTED_LINES = new Map<string, Set<number>>();
for (const k of KINDS) {
  PROD_ROWS.set(k, new Set<string>());
  IMPL_ROWS.set(k, new Set<string>());
  QUOTED_LINES.set(k, new Set<number>());
}

let absent = 0;
for (const row of MUTANTS) {
  const span = findLineSpan(row);
  if (row.file === INTERP && span !== undefined) {
    for (const k of KINDS) {
      const region = IMPL_LINES.get(k);
      const quoted = QUOTED_LINES.get(k);
      if (region === undefined || quoted === undefined) continue;
      for (let i = span.first; i <= span.last; i++) {
        if (!region.has(i)) continue;
        IMPL_ROWS.get(k)?.add(row.id);
        quoted.add(i);
      }
    }
  }
  const spans = PRODUCERS.get(row.file);
  if (spans !== undefined) {
    const at = source(row.file).indexOf(row.find);
    if (at < 0) absent++;
    else {
      const stop = at + row.find.length;
      for (const s of spans) if (at < s.to && stop > s.from) PROD_ROWS.get(s.kind)?.add(row.id);
    }
  } else if (row.file === INTERP && span === undefined) absent++;
}

// ─── 7. REPORT ───────────────────────────────────────────────────────────────
const CODE = (l: string) => l.trim() !== "" && !/^\s*(\/\/|\/\*|\*)/.test(l);
const SEAT = /otherSeat\(|\bctx\.seat\b|\bstate\.players\[/;
const DECISION =
  /\bif \(|\?[^.:]*:|\?\?|\bMath\.(max|min)\(|\bcase "|\breturn state;|events\.push\(|otherSeat\(/;

console.log(
  `corpus=${MUTANTS.length}  kinds=${KINDS.length} (from ${DECLARATIONS} discriminator` +
    ` declarations — ${DECLARATIONS - KINDS.length} kind(s) declared twice)  FANIN=${FANIN}  LEV=${LEV}`,
);
if (absent > 0) {
  console.log(
    `⚠ ${absent} row(s) whose \`find\` does not occur — run scripts/mutation/precheck.ts`,
  );
}

let prodPairs = 0;
let implPairs = 0;
for (const k of KINDS) {
  prodPairs += PROD_ROWS.get(k)?.size ?? 0;
  implPairs += IMPL_ROWS.get(k)?.size ?? 0;
}
console.log(`producer-side row·kind pairs: ${prodPairs}   implementation-side: ${implPairs}`);

const prodOnly: string[] = [];
const implOnly: string[] = [];
const neither: string[] = [];
for (const k of KINDS) {
  const p = PROD_ROWS.get(k)?.size ?? 0;
  const i = IMPL_ROWS.get(k)?.size ?? 0;
  if (p > 0 && i === 0) prodOnly.push(k);
  if (i > 0 && p === 0) implOnly.push(k);
  if (p === 0 && i === 0) neither.push(k);
}
/**
 * The three gates `runProgram`'s queue loop splices before `stepOp`; producer-only by predicate,
 * since their real work is in the loop. `optional` is not one of them; its splice is in
 * `continuationOps`.
 */
const SPLICED = ["coinFlipGate", "conditionGate", "recordGate"];
const prodOnlyReal = prodOnly.filter((k) => !SPLICED.includes(k));
console.log(`producer-ONLY: ${prodOnly.length} ${JSON.stringify(prodOnly)}`);
console.log(
  `  … minus the ${SPLICED.length} runProgram-spliced gates (a predicate artefact, not a` +
    ` gap — see SPLICED): ${prodOnlyReal.length} ${JSON.stringify(prodOnlyReal)}`,
);
console.log(`implementation-ONLY: ${implOnly.length} ${JSON.stringify(implOnly)}`);
console.log(`NEITHER seat: ${neither.length} ${JSON.stringify(neither)}`);

let seatTotal = 0;
let seatCovered = 0;
const seatRows: string[] = [];
let dpTotal = 0;
for (const k of KINDS) {
  const region = IMPL_LINES.get(k) ?? new Set<number>();
  const quoted = QUOTED_LINES.get(k) ?? new Set<number>();
  let total = 0;
  let covered = 0;
  for (const i of region) {
    const line = interpLines[i] ?? "";
    if (!CODE(line)) continue;
    if (DECISION.test(line)) dpTotal++;
    if (!SEAT.test(line)) continue;
    total++;
    if (quoted.has(i)) covered++;
  }
  seatTotal += total;
  seatCovered += covered;
  if (total > 0) {
    seatRows.push(`  ${k.padEnd(28)} ${covered}/${total}  ${(covered / total).toFixed(2)}`);
  }
}
console.log("\n=== SEAT-LINE COVERAGE (the stopping rule) ===");
for (const r of seatRows.sort()) console.log(r);
console.log(`SEAT LINES: ${seatCovered}/${seatTotal} = ${(seatCovered / seatTotal).toFixed(3)}`);
const dpRatio = (implPairs / dpTotal).toFixed(3);
const dpCaveat = "a long `find` scores every line it crosses";
console.log(`DECISION POINTS: ${implPairs}/${dpTotal} = ${dpRatio}  (weaker — ${dpCaveat})`);
