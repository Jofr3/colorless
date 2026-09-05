#!/usr/bin/env bun
/**
 * THE `OPAQUE`-ANATOMY GATE (D471) — `bun scripts/opaque-anatomy-gate.ts`.
 *
 * WHY THIS EXISTS. D465's rule, stated in `docs/conventions.md` and paid for
 * twice already: **an instrument that measures the repo must be KILLABLE BY THE
 * CORPUS.** `scripts/**` sits outside vitest's include globs and outside
 * `tsc -b`'s project references, so neither `bun run check` nor a whole-corpus
 * sweep can tell a correct classifier from a plausible one; a committed
 * measurement there is checked by nothing but its author having read it. That is
 * how D453's tally survived four days and how `residue-census.ts` carried a
 * span-probe blind spot for six slices. So `scripts/opaque-anatomy.ts` ships
 * with its killer beside it, on D212's `killedByCommand` precedent — the same
 * shape as `scripts/lint-coverage.ts`, `scripts/mutation/recovery-gate.ts`,
 * `scripts/mutation/splice-gate.ts` and `scripts/residue-census-gate.ts`.
 *
 * It is NOT a step of `bun run check`. Exit 0 = every claim holds; exit 1 = a
 * named claim failed, with the measured value beside it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS — five sections, and NONE of them holds a pinned figure of the
 * kind that rotted four times in `residue-census.ts`'s doc block. Every section
 * is either a RELATION between two computations or a structural property.
 *
 * § A — THE CROSS-CHECK AGAINST THE SHIPPED PROBE. Over the `OPAQUE` class,
 *   `minRegionHit` must never return `k = 1`. A single bounded edit region is
 *   exactly what `residue-census.ts`'s `substProbe` computes (its maximal
 *   common prefix and suffix bound that region), and a single PURE-DELETION
 *   region is what `spanProbe` computes — so any `k = 1` row would be a row the
 *   census should have classified `SUBST-n` or `PHRASE-n` and did not. This
 *   section holds no number: it compares two instruments.
 *   ⚠️ **IF IT EVER FAILS, CHECK THE SHAPE BEFORE BLAMING THIS FILE.** There is
 *   exactly one single-region shape neither shipped probe covers: a PURE
 *   INSERTION (`alen === 0`) — `substProbe` skips `fromLen === 0` and `spanProbe`
 *   only deletes. That population is EMPTY at this head, measured. A `k = 1`
 *   failure whose region has `alen === 0` is therefore a genuine finding about
 *   `residue-census.ts`'s reach and not a defect here.
 *
 * § B — `editRegions`, AS A PURE FUNCTION, ON LITERAL INPUTS. Each case is one
 *   axis of the region reduction, and each is the killer of a mutation row. The
 *   two that matter most are opposite errors: regions that fail to SEPARATE
 *   across a match (everything collapses to one, and § A goes red for the wrong
 *   reason), and regions that fail to MERGE across adjacent edits (counts
 *   inflate and `MULTI-2` empties silently).
 *
 * § C — THE MARKER VERDICTS ARE CHECKED, NOT DECLARED. Every marker the
 *   instrument declares a `blocker` must really have a ZERO built side, and
 *   every `co-marker` must really have a POSITIVE one. This is the section that
 *   makes the partition falsifiable by the corpus rather than by argument: the
 *   day a slice builds an attack-copy sentence, `COPY-ATTACK`'s built side goes
 *   positive and this gate goes RED and names it. It also asserts that no row is
 *   ever LABELLED by a `co-marker`, which is the whole discipline the second
 *   axis rests on.
 *
 * § D — THE PARTITION IS TOTAL AND DISJOINT. Every `OPAQUE` row gets exactly one
 *   class; the class sentence-counts and printing-counts sum to the class's own.
 *   Derived from the instrument's own subject, so it cannot go stale.
 *
 * § E — `minRegionHit` IS RE-DERIVED INDEPENDENTLY, AND THE GRID IS TOTALLED.
 *   The gate recomputes, from `editRegions` alone, the minimum bounded region
 *   count for every row and requires agreement with `ANATOMY` — which catches a
 *   search-loop defect (`best === null` in place of `regions.length < best.k`,
 *   a `break` for a `continue`) that § A cannot see because it inflates k rather
 *   than deflating it. It also totals the whole (row × built) grid, so a silent
 *   narrowing shows up as a COUNT rather than as an absence (D465's third
 *   property), and it pins non-degeneracy in BOTH directions: neither the
 *   reached half nor the far half may be empty.
 *
 * ⚠️ WHAT IT DOES NOT ASSERT, STATED (D419/D455). It pins **no class sizes** —
 * `MULTI-2 = 11` is exactly the kind of figure a future build is supposed to
 * move, and pinning it here would make this gate the thing that goes red when
 * the repo improves. It says nothing about whether the MARKERS are the right
 * markers; § C only checks that each one's declared verdict matches its measured
 * control. And it says nothing about `builds()`, which is
 * `scripts/residue-census-gate.ts` § A's job.
 */

import {
  ANATOMY,
  BUILT_SENTENCES,
  type EditRegion,
  editRegions,
  MARKER_COUNTS,
  OPAQUE,
} from "./opaque-anatomy";

const SUBMAX = Number(process.env.SUBMAX ?? 4);
const failures: string[] = [];

function check(claim: string, ok: boolean, detail: string): void {
  if (ok) return;
  failures.push(`${claim}\n      ${detail}`);
}

// ─── § A. THE CROSS-CHECK AGAINST THE SHIPPED PROBE ──────────────────────────
const singleRegion = ANATOMY.filter((a) => a.hit !== null && a.hit.k === 1);
check(
  "§A a k=1 row appeared — this instrument and residue-census.ts disagree",
  singleRegion.length === 0,
  singleRegion.length === 0
    ? ""
    : `${singleRegion.length} row(s); first: «${singleRegion[0]?.text}» → «${singleRegion[0]?.hit?.onto}» regions ${JSON.stringify(singleRegion[0]?.hit?.regions)}. If that region has alen === 0 it is a PURE INSERTION and the finding is about residue-census.ts, not about this file.`,
);
// The complement of the same claim: k must be >= 2 wherever a hit exists, and a
// hit that exists at all must be admitted by the bound. A `k = 0` would mean an
// OPAQUE sentence is byte-identical to a built one, which `builds()` forbids.
const zeroRegion = ANATOMY.filter((a) => a.hit !== null && a.hit.k === 0);
check(
  "§A a k=0 row appeared — an OPAQUE sentence equals a BUILT one",
  zeroRegion.length === 0,
  `${zeroRegion.length} row(s); first: «${zeroRegion[0]?.text ?? "—"}»`,
);

// ─── § B. `editRegions`, PURE, ON LITERAL INPUTS ─────────────────────────────
const T = (s: string) => s.split(" ");
const shape = (r: readonly EditRegion[]) => r.map((x) => `${x.alen}→${x.blen}`).join(",");
const B_CASES: readonly (readonly [string, EditRegion[], string])[] = [
  // ① IDENTICAL SEQUENCES PRODUCE NO REGION. Without this the count is offset by
  //    one everywhere and § A's k=1 claim tests the wrong thing.
  ["① identical token sequences produce zero regions", editRegions(T("a b c"), T("a b c")), ""],
  // ② ONE SUBSTITUTION IS ONE REGION, sized 1 on each side.
  ["② a single substituted token is one 1→1 region", editRegions(T("a b c"), T("a x c")), "1→1"],
  // ③ 🛑 THE CASE THIS WHOLE INSTRUMENT EXISTS FOR. Two differences SEPARATED by
  //    a match are TWO regions. A single-region probe — every probe in
  //    `residue-census.ts` — cannot see this however small each half is, and
  //    that is 33 of the 78 OPAQUE rows.
  [
    "③ two differences separated by a match are TWO regions",
    editRegions(T("a b c d e"), T("a x c y e")),
    "1→1,1→1",
  ],
  // ④ THE OPPOSITE ERROR. Adjacent edits with nothing matching between them are
  //    ONE region, not two. Over-splitting inflates every k and empties MULTI-2
  //    silently — a narrowing dressed as precision, and § A stays green through it.
  [
    "④ adjacent edits merge into ONE region",
    editRegions(T("a b c d"), T("a x y z d")),
    "2→3",
  ],
  // ⑤ A PURE DELETION IS A REGION WITH blen === 0, and a pure insertion the
  //    mirror. The bound is applied to BOTH sides, so a region that is empty on
  //    one side must still be counted or the size check has nothing to read.
  ["⑤ a pure tail deletion is one region with blen 0", editRegions(T("a b c d"), T("a b")), "2→0"],
  ["⑤ a pure insertion is one region with alen 0", editRegions(T("a b"), T("a b c d")), "0→2"],
];
for (const [label, got, want] of B_CASES) {
  check(`§B ${label}`, shape(got) === want, `expected «${want}», got «${shape(got)}»`);
}

// ─── § C. THE MARKER VERDICTS ARE CHECKED, NOT DECLARED ──────────────────────
for (const mc of MARKER_COUNTS) {
  if (mc.marker.verdict === "blocker") {
    check(
      `§C ${mc.marker.name} is declared a BLOCKER and the corpus BUILDS a sentence carrying it`,
      mc.built[0] === 0,
      `built side is ${mc.built[0]} sentence(s) / ${mc.built[1]} printing(s) — the marker is served somewhere, so it is a CO-MARKER and must be re-declared, not silently kept`,
    );
  } else {
    check(
      `§C ${mc.marker.name} is declared a CO-MARKER and its built side is EMPTY`,
      mc.built[0] > 0,
      "built side is 0 — either it has become a genuine blocker (re-declare it) or the control has been narrowed to nothing",
    );
  }
  // A marker nothing matches on either side is dead weight, and a dead marker
  // in a table of live ones reads as evidence. Both sides may not be empty.
  check(
    `§C ${mc.marker.name} matches nothing anywhere — it is a dead marker`,
    mc.residue[0] + mc.built[0] > 0,
    "zero hits over the whole legal column",
  );
}
const coLabelled = ANATOMY.filter((a) => a.marker !== null && a.marker.verdict !== "blocker");
check(
  "§C a CO-MARKER labelled a row — only a BLOCKER may label",
  coLabelled.length === 0,
  `${coLabelled.length} row(s); first: «${coLabelled[0]?.text ?? "—"}» labelled ${coLabelled[0]?.cls ?? "—"}`,
);

// ─── § D. THE PARTITION IS TOTAL AND DISJOINT ────────────────────────────────
check(
  "§D the partition does not cover the OPAQUE class exactly once",
  ANATOMY.length === OPAQUE.length,
  `${ANATOMY.length} labelled rows against ${OPAQUE.length} OPAQUE rows`,
);
const classes = new Map<string, [number, number]>();
for (const a of ANATOMY) {
  const slot = classes.get(a.cls) ?? [0, 0];
  slot[0]++;
  slot[1] += a.units;
  classes.set(a.cls, slot);
}
const sumS = [...classes.values()].reduce((s, v) => s + v[0], 0);
const sumU = [...classes.values()].reduce((s, v) => s + v[1], 0);
check(
  "§D the class table's sentence total does not equal the class it partitions",
  sumS === OPAQUE.length,
  `classes sum to ${sumS}, OPAQUE is ${OPAQUE.length}`,
);
check(
  "§D the class table's printing total does not equal the class it partitions",
  sumU === OPAQUE.reduce((s, r) => s + r.units, 0),
  `classes sum to ${sumU}, OPAQUE is ${OPAQUE.reduce((s, r) => s + r.units, 0)}`,
);
// Exactly one of the two axes may fire on a row: a hit means axis ① claimed it,
// and axis ② is not consulted. Both non-null would mean the ordering broke.
const doubled = ANATOMY.filter((a) => a.hit !== null && a.marker !== null);
check(
  "§D a row carries BOTH a region hit and a marker label — the axis ordering broke",
  doubled.length === 0,
  `${doubled.length} row(s); first: «${doubled[0]?.text ?? "—"}»`,
);

// ─── § E. `minRegionHit` RE-DERIVED, AND THE GRID TOTALLED ───────────────────
/** Independent of `minRegionHit`: the same question asked with a plain loop, so
    a search-loop defect that INFLATES k has somewhere to die. § A only sees the
    deflating direction. */
let pairs = 0;
let admitted = 0;
const disagree: string[] = [];
for (const r of OPAQUE) {
  const a = r.text.split(" ");
  let mine: number | null = null;
  for (const onto of BUILT_SENTENCES) {
    pairs++;
    const regions = editRegions(a, onto.split(" "));
    if (regions.length === 0) continue;
    if (regions.some((x) => x.alen > SUBMAX || x.blen > SUBMAX)) continue;
    admitted++;
    if (mine === null || regions.length < mine) mine = regions.length;
  }
  const theirs = ANATOMY.find((x) => x.text === r.text)?.hit?.k ?? null;
  if (mine !== theirs) disagree.push(`«${r.text}» gate says ${mine}, instrument says ${theirs}`);
}
check(
  "§E the re-derived minimum region count disagrees with the instrument's",
  disagree.length === 0,
  `${disagree.length} row(s); first: ${disagree[0] ?? "—"}`,
);
check(
  "§E the grid is not the full (OPAQUE × BUILT) product",
  pairs === OPAQUE.length * BUILT_SENTENCES.length,
  `${pairs} pairs against ${OPAQUE.length} × ${BUILT_SENTENCES.length} = ${OPAQUE.length * BUILT_SENTENCES.length}`,
);
check(
  "§E the bound admitted NOTHING — the probe is dead code",
  admitted > 0,
  `0 admitted alignments over ${pairs} pairs`,
);
check(
  "§E the bound admitted EVERYTHING — the probe is degenerate",
  admitted < pairs,
  `${admitted} of ${pairs} pairs admitted; with no effective bound every sentence is one region from every other`,
);
const reached = ANATOMY.filter((a) => a.hit !== null).length;
check(
  "§E the reached half is empty — no row is explained by the single-region blind spot",
  reached > 0,
  "0 rows carry a bounded multi-region hit",
);
check(
  "§E the far half is empty — every OPAQUE row is a probe artefact, which would be a finding, not a pass",
  reached < ANATOMY.length,
  `all ${reached} rows carry a hit`,
);

// ─── VERDICT ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`opaque-anatomy-gate: ${failures.length} claim(s) FAILED\n`);
  for (const f of failures) console.error(`  🛑 ${f}\n`);
  process.exit(1);
}
const blockers = MARKER_COUNTS.filter((m) => m.marker.verdict === "blocker").length;
console.log(
  `opaque-anatomy-gate: OK — §A no k=1 row over ${OPAQUE.length} OPAQUE sentences, §B ${B_CASES.length} region-reduction claims hold, §C ${blockers} blocker(s) with an empty built side and ${MARKER_COUNTS.length - blockers} co-marker(s) with a live one, §D ${classes.size} classes covering ${sumS} sentences / ${sumU} printings exactly once, §E ${admitted} admitted of ${pairs} grid pairs and ${reached} reached / ${ANATOMY.length - reached} far, re-derived in agreement.`,
);
