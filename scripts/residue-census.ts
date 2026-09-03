#!/usr/bin/env bun
/**
 * THE BLOCKER CENSUS (D459) — `bun scripts/residue-census.ts`, no arguments.
 *
 * WHY THIS FILE EXISTS. Targeting has been the weakest part of this run. A
 * handed-forward "cheapest next sentence" list was wrong three slices running
 * (D455 → D457), and one family mis-priced its OWN blocker twice in a row
 * (D457's field, D458's arm) — both times by reading a doc block instead of
 * asking the code. D458 found the cheap disproof: **delete one axis from the
 * printed string and re-ask the readers.** It cost nothing and it was right.
 * D455's standing rule says the rest: **the instrument that produces a coverage
 * figure is committed beside the corpus it measures, and when it disagrees with
 * `docs/`, it wins.** This is that probe, run over the WHOLE residue, committed.
 *
 * WHAT IT ANSWERS, with no arguments: for every sentence in the canonical
 * unbuilt residue, WHICH AXIS BLOCKS IT — established by a deletion or a
 * substitution that changes exactly one thing and then re-asks the census's own
 * build predicate. It prints the class table with both cardinalities and, for
 * every row, the evidence that put it in its class.
 *
 * With one argument (a substring) it prints the full evidence for the matching
 * rows only. That is a convenience for cross-checking a recorded refusal against
 * this instrument; it is not a second question.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PREDICATE, STATED (D419 — a survey is as narrow as the shape it greps for)
 *
 * POPULATION: `legalAttackCorpus()` — the committed `legal_standard = 1` attack
 * column, 640 sentences / 1,732 printings.
 *
 * BUILT, the CANONICAL FOUR-WAY SUBTRACTION, transcribed from the rung in
 * `censusAtHead.test.ts` that derives `residueSentences` — NOT from
 * `!resolvedByAnyReader`, which conventions.md (D422, D444, D457) records as the
 * wrong subtraction three separate times. A sentence is BUILT when ANY of:
 *   ① a live `deriveAttack*` reader claims it whole (`resolvedByAnyReader`);
 *   ② it is one of `REGISTRY_ATTACKS`'s printed sentences — a REGISTRY row
 *     builds it and `censusAtHead`'s `registryUnits` rung asserts that no reader
 *     claims it, so **a reader arm for one of these REDDENS the census** (D457);
 *   ③ D444's GATE SPLITTER strips a timing clause and a reader claims the body;
 *   ④ D409's TRAILING SPLITTER splits it into a head and a claimed tail.
 * RESIDUE = population − BUILT.
 *
 * ⚠️ THE CHECK THAT IT MEASURES THE SAME OBJECT, AND IT IS A RELATION RATHER
 * THAN A NUMBER (D425 — a doc-block figure rots like any other): this script's
 * `raw`, `residue` and residue-printings must equal the three literals
 * `censusAtHead.test.ts` pins in its `residueSentences` rung. They did at
 * D459's head BEFORE this slice's own build (156 / 130 / 182) and they do
 * after it (155 / 129 / 180). **If they ever disagree, one of the two
 * transcriptions of the four-way subtraction has drifted, and this file is the
 * one with no test behind it — read the suite first.**
 *
 * THE PROBES. Each changes EXACTLY ONE THING and then re-asks BUILT.
 *   · SEGMENT REMOVAL. The sentence is cut at depth-0 sentence boundaries (a
 *     `.` or `)` at paren depth 0, followed by whitespace and an upper-case
 *     letter or an open paren — so `etc. have` does not split and a whole
 *     parenthetical rider is its own segment). Exactly one segment is removed
 *     and the remainder is re-asked. **The removed segment is re-asked too**,
 *     which is what makes the row say WHICH HALF derived.
 *   · MINIMAL SPAN DELETION. Every contiguous span of whitespace-separated
 *     tokens, shortest first, leftmost first. The first span whose deletion
 *     BUILDS is reported, with a count of how many spans of that same minimal
 *     length also build.
 *   · SINGLE-SPAN SUBSTITUTION. The residue sentence is aligned against every
 *     BUILT corpus sentence by common prefix and common suffix. When the whole
 *     difference is ONE contiguous region of ≤ SUBMAX tokens on each side, that
 *     is a one-axis substitution onto a sentence this engine already builds, and
 *     the region is the axis. Reported smallest-first.
 *
 * THE CLASSES, in the order a row is tested against them:
 *   COMPOSE      — a segment removal builds AND the removed segment builds on
 *                  its own. Both halves are known; only the JOIN is missing.
 *   COMPOUND-*   — a segment removal builds and the removed segment does not.
 *                  The suffix names WHICH HALF SURVIVED (`head`, `tail`, `mid`)
 *                  and the row prints both, because the surviving half can be a
 *                  rider while the blocked half is the whole mechanism.
 *   SUBST-n      — no segment removal builds, but the sentence differs from a
 *                  BUILT corpus sentence in one contiguous region of n tokens.
 *   PHRASE-n     — no segment removal and no substitution, but deleting one
 *                  contiguous n-token span builds.
 *   OPAQUE       — nothing above fires. No single deletion or substitution this
 *                  instrument can make reaches a built string.
 *
 * 🆕 AND IT PRINTS THE VALUE, NOT ONLY THE VERDICT — which is the finding that
 * made D459's target choice mechanical. Ten residue rows were one-token
 * deletions when this file was written (nine after D459 built the tenth). NINE of them lose the deleted token's information in the derived
 * value (`Basic`, `Benched`, `Ancient`, `Future`, `{L}`, `{F}`, `Iono's`, and a
 * second `Basic` that collapses to `energyType: null`); the tenth, `card`,
 * derives to `{per: 70, count: {kind: "energyOnSelf", energyType: "special"}}`
 * with the filter INTACT. That is the difference between a SPELLING blocker and
 * a SEMANTIC one, it cannot be read off any count, and it is why every probe
 * here reports what the remainder derives TO. ⚠️ The judgement is still a
 * judgement — this instrument does not classify SPELLING vs SEMANTIC for you, it
 * puts the two values side by side so the judgement takes one look instead of a
 * doc block.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT THIS INSTRUMENT CANNOT SEE — read this before quoting a number.
 *
 * · 🛑 **A DELETION THAT LEAVES A BUILDING REMAINDER TELLS YOU THE REMAINDER
 *   BUILDS. IT DOES NOT TELL YOU THE SENTENCE IS ONE AXIS FROM BUILDING.** The
 *   deleted half may need a whole mechanism — a new op, a `CardFilter` member
 *   the type cannot express, or an ingest column that does not exist. `COMPOSE`
 *   is the only class where both halves are known to build; every `COMPOUND-*`
 *   row is a row whose PRICE IS UNKNOWN and whose cheap half has merely been
 *   identified. This is why the class is split at all.
 * · 🛑 **A ONE-TOKEN DELETION CAN CHANGE THE MEANING AND THE READER WILL NOT
 *   MIND.** Deleting `more`, `not`, `up to`, `own` or an owner prefix yields a
 *   string a reader claims and a card that would be WRONG. `PHRASE-1` and
 *   `PHRASE-2` rows must be read as "a reader is one token away from claiming
 *   this", never as "this is nearly built".
 * · 🛑 **CLASS IS ASSIGNED BY THE CHEAPEST PROBE THAT FIRES, NOT BY THE REAL
 *   BLOCKER.** A sentence with a compound structure AND an unrepresentable
 *   filter lands in `COMPOUND-*` on the structure, because the structure probe
 *   is tested first. The class is a lower bound on the work, never an estimate.
 * · **PRINTINGS ARE A FLOOR** (D445): the corpus counts `legal_standard = 1`
 *   printings only; the engine also ships an `expanded` format.
 * · **THE READER SURFACE IS KEYED ON THE `deriveAttack` NAME PREFIX**
 *   (`censusAttackCorpus.ts`'s own stated limit) — a reader named otherwise is
 *   invisible here, exactly as it is to the census.
 * · **THE REGISTRY ARM READS A TEST FILE.** `REGISTRY_ATTACKS` is a hand-kept
 *   `[id, sentence]` list inside `censusAtHead.test.ts`; there is no non-test
 *   module holding the printed sentence behind a registry program, because the
 *   printed text is a CATALOG fact and that suite deliberately has no catalog.
 *   So this script parses that literal out of the source, comment-stripped
 *   (D455: an instrument that scans a declaration must strip comments first —
 *   the literal carries inline prose quoting whole sentences, and a naive sweep
 *   reads 47 strings where there are 32), with a TOTAL check: after the
 *   id/sentence pairs are removed, a surviving `"` is a throw. What it CANNOT
 *   see is a registry program whose row is absent from that list; the converse
 *   guard for that is `attackRegistryIds()` in the suite, not here.
 * · **`splitAttackTrailingClause` COUNTS AS BUILT** because the census counts it
 *   as built. It says a head and a claimed tail exist, not that the whole
 *   sentence is driven end to end.
 * · **IT SAYS NOTHING ABOUT CORRECTNESS.** Every figure here is about which
 *   strings the readers CLAIM. Whether the claim is right is what the suite and
 *   `bun run mutants` are for.
 *
 * WHERE IT SITS. `scripts/**` is outside `tsc -b`'s project references and
 * outside vitest's include globs, and Biome lints it (`files.include` carries
 * `scripts/**` since D212), so `bun run lint:coverage` counts it. ⚠️ It is under
 * `scripts/` rather than `scripts/mutation/` — the work order said "beside
 * `opcoverage.ts`", meaning in its STYLE; the corpus it measures is the printed
 * attack column, not the mutation corpus, and `scripts/mutation/` is the harness
 * that runs mutants.
 *
 * Env overrides, none required: `SUBMAX` (default 4) — the largest substitution
 * region, in tokens on either side, that still counts as one axis.
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

// ─── 2. THE BUILD PREDICATE ──────────────────────────────────────────────────
/** ① reader ② registry ③ gate splitter ④ trailing splitter. The transcription of
    `censusAtHead.test.ts`'s `residueSentences` filter, negated. */
function builds(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  if (REGISTRY.has(text)) return true;
  const gate = splitAttackGateClause(text);
  if (gate !== null && gate.body !== "" && resolvedByAnyReader(gate.body)) return true;
  return splitAttackTrailingClause(text) !== null;
}

/** Which arm claimed it — for the subtraction breakdown, not for the filter. */
function arm(text: string): "reader" | "registry" | "gate" | "trailing" | null {
  if (resolvedByAnyReader(text)) return "reader";
  if (REGISTRY.has(text)) return "registry";
  const gate = splitAttackGateClause(text);
  if (gate !== null && gate.body !== "" && resolvedByAnyReader(gate.body)) return "gate";
  if (splitAttackTrailingClause(text) !== null) return "trailing";
  return null;
}

/** WHAT a string derives TO, not merely THAT it derives. This is the difference
    between a SPELLING widening and a SEMANTIC one, and no count can show it: the
    token a deletion removes is free only if the remainder's derived value already
    carries its information, and that is a judgement a reader makes by looking at
    the value. So the value is printed. ⚠️ Readers other than the `deriveAttack*`
    surface (the two splitters, the registry) have no value to print and say so. */
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

// ─── 3. SEGMENTATION ─────────────────────────────────────────────────────────
/** Depth-0 sentence boundaries. A boundary is a `.` or `)` at paren depth 0,
    followed by whitespace, followed by an upper-case letter or `(`. That keeps
    `etc. have Rule Boxes` whole and makes a trailing `(Don't apply …)` rider its
    own segment. ⚠️ It does NOT see an inline parenthetical
    (`… (both yours and your opponent's) …`) — those are the span probe's job. */
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

type SpanHit = { span: string; at: number; len: number; ties: number; kept: string };

function spanProbe(text: string): SpanHit | null {
  const tok = text.split(" ");
  for (let len = 1; len < tok.length; len++) {
    let first: SpanHit | null = null;
    let ties = 0;
    for (let i = 0; i + len <= tok.length; i++) {
      const kept = [...tok.slice(0, i), ...tok.slice(i + len)].join(" ");
      if (!builds(kept)) continue;
      ties++;
      if (first === null) {
        first = { span: tok.slice(i, i + len).join(" "), at: i, len, ties: 0, kept };
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
      best = { from: a.slice(p, p + fromLen).join(" "), to: b.slice(p, p + toLen).join(" "), onto: b0, size };
    }
  }
  return best;
}

// ─── 5. RUN ──────────────────────────────────────────────────────────────────
const corpus = legalAttackCorpus();
const residue: (readonly [number, string])[] = [];
const byArm = { reader: [0, 0], registry: [0, 0], gate: [0, 0], trailing: [0, 0] };
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
const builtSentences = corpus.filter(([, t]) => builds(t)).map(([, t]) => t);

type Row = {
  units: number;
  text: string;
  cls: string;
  seg: SegmentHit | null;
  span: SpanHit | null;
  sub: SubstHit | null;
};

const rows: Row[] = residue.map(([units, text]) => {
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

if (NEEDLE === null) {
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
    c.startsWith("COMPOSE") ? 0 : c.startsWith("COMPOUND") ? 1 : c.startsWith("SUBST") ? 2 : c.startsWith("PHRASE") ? 3 : 4;
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
} else {
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
    console.log(`${pad}  CUT   ${r.seg.cutBuilds ? `✅ builds (${arm(r.seg.cut)})` : "🛑 does NOT build"}: ${r.seg.cut}`);
  }
  if (r.sub !== null) {
    console.log(`${pad}SUBST ${r.sub.size} token(s): «${r.sub.from}» → «${r.sub.to}»`);
    console.log(`${pad}  onto BUILT (${arm(r.sub.onto)}): ${r.sub.onto}`);
    console.log(`${pad}        ${derivation(r.sub.onto)}`);
  }
  if (r.span !== null) {
    console.log(
      `${pad}SPAN  delete ${r.span.len} token(s) at ${r.span.at} (${r.span.ties} minimal span(s) build): «${r.span.span}»`,
    );
    if (r.seg === null) console.log(`${pad}      ${derivation(r.span.kept)}`);
  }
  if (r.seg === null && r.sub === null && r.span === null) {
    console.log(`${pad}no deletion and no substitution this instrument can make reaches a built string.`);
  }
}
