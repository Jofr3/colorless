#!/usr/bin/env bun
/**
 * Census of residue sentences (corpus sentences that nothing builds yet) and what blocks each one.
 * Run with `bun scripts/residue-census.ts`.
 */

import { readFileSync } from "node:fs";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "../packages/engine/src/censusAttackCorpus";
import * as effects from "../packages/engine/src/effects";
import { splitAttackGateClause, splitAttackTrailingClause } from "../packages/engine/src/effects";

const SUBMAX = Number(process.env.SUBMAX ?? 4);
const CENSUS = "packages/engine/src/censusAtHead.test.ts";
const NEEDLE = process.argv[2] ?? null;

// ─── 1. THE REGISTRY ARM ─────────────────────────────────────────────────────
function registryAttackSentences(): { sentences: Set<string>; pairs: number } {
  const src = readFileSync(CENSUS, "utf8");
  const head = src.indexOf("const REGISTRY_ATTACKS: readonly (readonly [string, string])[] = [");
  if (head < 0) throw new Error("residue-census: REGISTRY_ATTACKS literal not found");
  const end = src.indexOf("\n];", head);
  if (end < 0) throw new Error("residue-census: REGISTRY_ATTACKS terminator not found");
  const block = src
    .slice(head, end)
    .split("\n")
    .map((l) => l.replace(/\s*\/\/.*$/, ""))
    .join("\n");
  const PAIR = /\[\s*"(sv[a-z0-9.]*-\d+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\]/g;
  const sentences = new Set<string>();
  let pairs = 0;
  let residual = block;
  for (const m of block.matchAll(PAIR)) {
    sentences.add((m[2] ?? "").replace(/\\"/g, '"'));
    residual = residual.replace(m[0], "");
    pairs++;
  }
  if (residual.includes('"')) {
    throw new Error(`residue-census: unparsed string in REGISTRY_ATTACKS: ${residual.trim()}`);
  }
  if (pairs === 0) throw new Error("residue-census: REGISTRY_ATTACKS parsed empty");
  return { sentences, pairs };
}

const { sentences: REGISTRY, pairs: REGISTRY_PAIRS } = registryAttackSentences();

// The build predicate, with four arms: reader, registry, gate splitter, trailing splitter. The gate
// arm also credits a text that is only a gate clause (`splitAttackGateClause` returns an empty
// body).
export function builds(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  if (REGISTRY.has(text)) return true;
  const gate = splitAttackGateClause(text);
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

/** Which arm claimed the sentence, for the subtraction breakdown rather than the filter. */
export function arm(text: string): "reader" | "registry" | "gate" | "trailing" | null {
  if (resolvedByAnyReader(text)) return "reader";
  if (REGISTRY.has(text)) return "registry";
  const gate = splitAttackGateClause(text);
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return "gate";
  if (splitAttackTrailingClause(text) !== null) return "trailing";
  return null;
}

/**
 * Prints what a string derives to, not just whether it derives, so a reader can judge whether a
 * deletion is a spelling or semantic widening. Readers outside the `deriveAttack*` surface have no
 * value to print.
 */
function derivation(text: string): string {
  const claims: string[] = [];
  for (const [name, fn] of Object.entries(effects)) {
    if (!name.startsWith("deriveAttack") || typeof fn !== "function") continue;
    let out: unknown;
    try {
      out = (fn as (t: string) => unknown)(text);
    } catch {
      continue;
    }
    if (out === null || out === undefined) continue;
    claims.push(`${name} → ${JSON.stringify(out)}`);
  }
  if (claims.length === 0) return "(no whole-sentence reader — registry or a splitter)";
  return claims.join("  |  ");
}

// Depth-0 sentence boundaries: a `.` or `)` at paren depth 0, then whitespace, then an upper-case
// letter or `(`. Keeps `etc. have Rule Boxes` whole and splits off a trailing `(Don't apply …)`
// rider. Inline parentheticals are left to the span probe.
function segments(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    if (c !== "." && c !== ")") continue;
    const gap = /^\s+/.exec(text.slice(i + 1));
    if (gap === null) continue;
    const next = text[i + 1 + gap[0].length] ?? "";
    if (!/[A-Z(]/.test(next)) continue;
    out.push(text.slice(start, i + 1));
    start = i + 1 + gap[0].length;
  }
  out.push(text.slice(start));
  return out.filter((s) => s.length > 0);
}

// ─── 4. THE PROBES ───────────────────────────────────────────────────────────
type SegmentHit = { index: number; total: number; kept: string; cut: string; cutBuilds: boolean };

function segmentProbe(text: string): SegmentHit | null {
  const segs = segments(text);
  if (segs.length < 2) return null;
  let best: SegmentHit | null = null;
  for (let k = 0; k < segs.length; k++) {
    const kept = [...segs.slice(0, k), ...segs.slice(k + 1)].join(" ");
    if (!builds(kept)) continue;
    const cut = segs[k] ?? "";
    const hit: SegmentHit = {
      index: k,
      total: segs.length,
      kept,
      cut,
      cutBuilds: builds(cut),
    };
    // Prefer a removal whose CUT half also builds — that is the COMPOSE finding,
    // and it is strictly more informative than a removal that only leaves one.
    if (best === null || (hit.cutBuilds && !best.cutBuilds)) best = hit;
  }
  return best;
}

type SpanHit = {
  span: string;
  at: number;
  len: number;
  ties: number;
  kept: string;
  repaired: boolean;
};

/**
 * Tail repair: `spanProbe` splits and rejoins on spaces, so a deletion reaching the last token also
 * removes the sentence-final period, and the remainder can never build. The repair applies only
 * when the deleted span reaches the last token.
 */
export const TERMINATOR = /[.!?]$/;
export function keptAfterDeletion(
  text: string,
  tok: readonly string[],
  i: number,
  len: number,
): string[] {
  const plain = [...tok.slice(0, i), ...tok.slice(i + len)].join(" ");
  if (i + len !== tok.length || i === 0) return [plain];
  const term = TERMINATOR.exec(text)?.[0] ?? "";
  if (term === "") return [plain];
  const trimmed = plain.replace(/[,;:]$/, "");
  const repaired = /[.!?)]$/.test(trimmed) ? trimmed : trimmed + term;
  return repaired === plain ? [plain] : [plain, repaired];
}

export function spanProbe(text: string): SpanHit | null {
  const tok = text.split(" ");
  for (let len = 1; len < tok.length; len++) {
    let first: SpanHit | null = null;
    let ties = 0;
    for (let i = 0; i + len <= tok.length; i++) {
      const candidates = keptAfterDeletion(text, tok, i, len);
      const hit = candidates.findIndex((c) => builds(c));
      if (hit < 0) continue;
      ties++;
      if (first === null) {
        first = {
          span: tok.slice(i, i + len).join(" "),
          at: i,
          len,
          ties: 0,
          kept: candidates[hit] ?? "",
          repaired: hit > 0,
        };
      }
    }
    if (first !== null) return { ...first, ties };
  }
  return null;
}

type SubstHit = { from: string; to: string; onto: string; size: number };

function substProbe(text: string, built: readonly string[]): SubstHit | null {
  const a = text.split(" ");
  let best: SubstHit | null = null;
  for (const b0 of built) {
    const b = b0.split(" ");
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const fromLen = a.length - p - s;
    const toLen = b.length - p - s;
    if (fromLen === 0 && toLen === 0) continue; // identical — impossible here
    if (fromLen > SUBMAX || toLen > SUBMAX) continue;
    // A pure deletion/insertion is the span probe's finding, not a substitution.
    if (fromLen === 0 || toLen === 0) continue;
    const size = fromLen + toLen;
    if (best === null || size < best.size) {
      best = {
        from: a.slice(p, p + fromLen).join(" "),
        to: b.slice(p, p + toLen).join(" "),
        onto: b0,
        size,
      };
    }
  }
  return best;
}

// ─── 5. RUN ──────────────────────────────────────────────────────────────────
const corpus = legalAttackCorpus();
const residue: (readonly [number, string])[] = [];
// A fixed-length tuple, so reads are not `number | undefined` under `noUncheckedIndexedAccess`.
type ArmTally = [sentences: number, printings: number];
const byArm: Record<"reader" | "registry" | "gate" | "trailing", ArmTally> = {
  reader: [0, 0],
  registry: [0, 0],
  gate: [0, 0],
  trailing: [0, 0],
};
for (const [units, text] of corpus) {
  const a = arm(text);
  if (a === null) {
    residue.push([units, text]);
    continue;
  }
  const slot = byArm[a];
  slot[0]++;
  slot[1] += units;
}
export const builtSentences = corpus.filter(([, t]) => builds(t)).map(([, t]) => t);

export type Row = {
  units: number;
  text: string;
  cls: string;
  seg: SegmentHit | null;
  span: SpanHit | null;
  sub: SubstHit | null;
};

export const rows: Row[] = residue.map(([units, text]) => {
  const seg = segmentProbe(text);
  const span = spanProbe(text);
  const sub = substProbe(text, builtSentences);
  let cls: string;
  // biome: `seg?.cutBuilds` — the `!== null` is redundant because `cutBuilds` is a boolean.
  if (seg?.cutBuilds === true) cls = "COMPOSE";
  else if (seg !== null) {
    const where = seg.index === 0 ? "tail" : seg.index === seg.total - 1 ? "head" : "mid";
    cls = `COMPOUND-${where}`;
  } else if (sub !== null) cls = `SUBST-${sub.size}`;
  else if (span !== null) cls = `PHRASE-${span.len}`;
  else cls = "OPAQUE";
  return { units, text, cls, seg, span, sub };
});

const P = (n: number) => String(n).padStart(3);

if (import.meta.main && NEEDLE === null) {
  console.log("=== THE BLOCKER CENSUS (D459) ===");
  console.log(
    `readers: ${attackReaderSurface().length}   REGISTRY_ATTACKS: ${REGISTRY_PAIRS} pairs / ${REGISTRY.size} distinct sentences   SUBMAX=${SUBMAX}`,
  );
  console.log(
    `\npopulation  ${P(corpus.length)} sentences / ${P(corpus.reduce((s, [n]) => s + n, 0))} printings`,
  );
  for (const k of ["reader", "registry", "gate", "trailing"] as const) {
    const [s, u] = byArm[k];
    console.log(`  − ${k.padEnd(9)} ${P(s ?? 0)}            / ${P(u ?? 0)}`);
  }
  console.log(
    `= RESIDUE    ${P(rows.length)} sentences / ${P(rows.reduce((s, r) => s + r.units, 0))} printings`,
  );

  const classes = [...new Set(rows.map((r) => r.cls))].sort();
  const family = (c: string) =>
    c.startsWith("COMPOSE")
      ? 0
      : c.startsWith("COMPOUND")
        ? 1
        : c.startsWith("SUBST")
          ? 2
          : c.startsWith("PHRASE")
            ? 3
            : 4;
  const size = (c: string) => Number(/-(\d+)$/.exec(c)?.[1] ?? 0);
  classes.sort(
    (a, b) => family(a) - family(b) || size(a) - size(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  console.log("\n=== CLASS TABLE ===");
  console.log("CLASS            sentences  printings");
  for (const c of classes) {
    const hits = rows.filter((r) => r.cls === c);
    console.log(
      `${c.padEnd(16)} ${P(hits.length)}        ${P(hits.reduce((s, r) => s + r.units, 0))}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(16)} ${P(rows.length)}        ${P(rows.reduce((s, r) => s + r.units, 0))}`,
  );
  console.log("\n=== ROWS, BY CLASS ===");
  for (const c of classes) {
    console.log(`\n── ${c} ${"─".repeat(Math.max(0, 60 - c.length))}`);
    for (const r of rows.filter((x) => x.cls === c)) {
      console.log(`${P(r.units)}p  ${r.text}`);
      report(r, "     ");
    }
  }
  // `NEEDLE !== null` is always true here, but TypeScript does not narrow through a negated
  // conjunction, so it is needed for the types.
} else if (import.meta.main && NEEDLE !== null) {
  const hits = rows.filter((r) => r.text.includes(NEEDLE));
  console.log(`=== ${hits.length} residue row(s) matching ${JSON.stringify(NEEDLE)} ===`);
  for (const r of hits) {
    console.log(`\n[${r.cls}] ${r.units}p  ${r.text}`);
    report(r, "  ");
  }
  const nonResidue = corpus.filter(([, t]) => t.includes(NEEDLE) && builds(t));
  console.log(`\n(${nonResidue.length} corpus sentence(s) matching that needle are BUILT:)`);
  for (const [u, t] of nonResidue) console.log(`  ${arm(t)?.padEnd(8)} ${u}p  ${t}`);
}

function report(r: Row, pad: string): void {
  if (r.seg !== null) {
    console.log(`${pad}SEGMENT ${r.seg.index + 1}/${r.seg.total} removed.`);
    console.log(`${pad}  KEPT  ✅ builds (${arm(r.seg.kept)}): ${r.seg.kept}`);
    console.log(`${pad}        ${derivation(r.seg.kept)}`);
    console.log(
      `${pad}  CUT   ${r.seg.cutBuilds ? `✅ builds (${arm(r.seg.cut)})` : "🛑 does NOT build"}: ${r.seg.cut}`,
    );
  }
  if (r.sub !== null) {
    console.log(`${pad}SUBST ${r.sub.size} token(s): «${r.sub.from}» → «${r.sub.to}»`);
    console.log(`${pad}  onto BUILT (${arm(r.sub.onto)}): ${r.sub.onto}`);
    console.log(`${pad}        ${derivation(r.sub.onto)}`);
  }
  if (r.span !== null) {
    console.log(
      `${pad}SPAN  delete ${r.span.len} token(s) at ${r.span.at} (${r.span.ties} minimal span(s) build)${r.span.repaired ? " [TAIL REPAIR]" : ""}: «${r.span.span}»`,
    );
    // A repaired remainder is not just the sentence minus the span, because the terminator moved,
    // so it is printed.
    if (r.span.repaired) console.log(`${pad}      KEPT  ${r.span.kept}`);
    if (r.seg === null) console.log(`${pad}      ${derivation(r.span.kept)}`);
  }
  if (r.seg === null && r.sub === null && r.span === null) {
    console.log(
      `${pad}no deletion and no substitution this instrument can make reaches a built string.`,
    );
  }
}
