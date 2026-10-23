#!/usr/bin/env bun
/**
 * Gate for `scripts/opaque-anatomy.ts` (`bun scripts/opaque-anatomy-gate.ts`); not part of `bun run
 * check`. It asserts relations and structural properties, never pinned class sizes: §A no OPAQUE
 * row has a single-region hit; §B `editRegions` on literal inputs; §C each marker's declared
 * verdict matches its measured built side, and no row is labelled by a co-marker; §D the partition
 * is total and disjoint; §E/§E′ `minRegionHit` is re-derived independently over the live class and
 * a fixed literal grid. Exit 1 names the failed claim.
 */

import {
  ANATOMY,
  BUILT_SENTENCES,
  blockerMarkerOf,
  type EditRegion,
  editRegions,
  MARKER_COUNTS,
  MARKERS,
  minRegionHit,
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
  // Two differences separated by a match are two regions; a single-region probe cannot see this.
  [
    "③ two differences separated by a match are TWO regions",
    editRegions(T("a b c d e"), T("a x c y e")),
    "1→1,1→1",
  ],
  // ④ THE OPPOSITE ERROR. Adjacent edits with nothing matching between them are
  //    ONE region, not two. Over-splitting inflates every k and empties MULTI-2
  //    silently — a narrowing dressed as precision, and § A stays green through it.
  ["④ adjacent edits merge into ONE region", editRegions(T("a b c d"), T("a x y z d")), "2→3"],
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
// A fixed far sentence that a co-marker matches and no blocker does, so the claim holds without a
// live witness: only a labeller that lets a co-marker label returns non-null.
const CO_PIN =
  "If you use this attack when you have exactly 1 Prize card remaining, you win this game.";
const coPinned = blockerMarkerOf({ text: CO_PIN });
check(
  "§C the PINNED far sentence was labelled by a CO-MARKER — only a BLOCKER may label",
  coPinned === null,
  `«${CO_PIN}» labelled ${coPinned === null ? "—" : coPinned.name} (${coPinned?.verdict ?? "—"})`,
);
// The pin's own premise, re-measured so it cannot rot into a tautology: some CO-MARKER
// must really match it (else the claim above passes under the mutant too), and NO blocker
// may (else the claim above is red at a green HEAD).
const coPinMatches = MARKERS.filter((m) => m.rx.test(CO_PIN));
check(
  "§C the pinned co-marker witness's premise broke — no co-marker matches it, or a blocker does",
  coPinMatches.length > 0 && coPinMatches.every((m) => m.verdict === "co-marker"),
  `matched by «${coPinMatches.map((m) => `${m.name}:${m.verdict}`).join(", ") || "nothing"}»`,
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
// A fixed pair whose first target is admitted at k = 2 and second at k = 1, so only a search that
// keeps the smallest returns the second, independent of the live population.
const PIN_TEXT = "a b c d e";
const PIN_TARGETS = ["a x c y e", "a b c d x"] as const;
const pinned = minRegionHit(PIN_TEXT, 4, PIN_TARGETS);
check(
  "§E the search kept a LARGER alignment than the pinned minimum — it is not taking the smallest",
  pinned?.k === 1 && pinned.onto === PIN_TARGETS[1],
  `expected k = 1 onto «${PIN_TARGETS[1]}», got ${pinned === null ? "null" : `k = ${pinned.k} onto «${pinned.onto}»`}`,
);
// The pin's own premise, re-measured so it cannot rot into a tautology: the
// FIRST target must really be admitted with MORE regions than the second, or
// the witness above no longer distinguishes first-hit from smallest-hit.
const pinFirst = editRegions(T(PIN_TEXT), T(PIN_TARGETS[0]));
check(
  "§E the pinned witness's premise broke — its first target is not admitted at a larger k",
  pinFirst.length === 2 && pinFirst.every((x) => x.alen <= 4 && x.blen <= 4),
  `first target reduces to «${shape(pinFirst)}»`,
);
check(
  "§E the grid is not the full (OPAQUE × BUILT) product",
  pairs === OPAQUE.length * BUILT_SENTENCES.length,
  `${pairs} pairs against ${OPAQUE.length} × ${BUILT_SENTENCES.length} = ${OPAQUE.length * BUILT_SENTENCES.length}`,
);
// These population checks pass vacuously when OPAQUE is empty; §E′ asks the same claims of a fixed
// grid.
check(
  "§E the bound admitted NOTHING — the probe is dead code",
  OPAQUE.length === 0 || admitted > 0,
  `0 admitted alignments over ${pairs} pairs`,
);
check(
  "§E the bound admitted EVERYTHING — the probe is degenerate",
  OPAQUE.length === 0 || admitted < pairs,
  `${admitted} of ${pairs} pairs admitted; with no effective bound every sentence is one region from every other`,
);
const reached = ANATOMY.filter((a) => a.hit !== null).length;
check(
  "§E the reached half is empty — no row is explained by the single-region blind spot",
  OPAQUE.length === 0 || reached > 0,
  "0 rows carry a bounded multi-region hit",
);
check(
  "§E the far half is empty — every OPAQUE row is a probe artefact, which would be a finding, not a pass",
  OPAQUE.length === 0 || reached < ANATOMY.length,
  `all ${reached} rows carry a hit`,
);

// §E′: the same claims over a fixed 2 × 2 grid. Row 1 is reached onto target 1 at k = 2; row 2 is
// over the bound against both targets, so it is far.
const E2_TARGETS = ["a b c d e", "p q r s t u v w x y"] as const;
const E2_ROWS = ["a x c y e", "k l m n o p q r s t u v"] as const;
let e2Pairs = 0;
let e2Admitted = 0;
let e2Reached = 0;
const e2Disagree: string[] = [];
for (const row of E2_ROWS) {
  const a = row.split(" ");
  let mine: number | null = null;
  for (const onto of E2_TARGETS) {
    e2Pairs++;
    const regions = editRegions(a, onto.split(" "));
    if (regions.length === 0) continue;
    if (regions.some((x) => x.alen > SUBMAX || x.blen > SUBMAX)) continue;
    e2Admitted++;
    if (mine === null || regions.length < mine) mine = regions.length;
  }
  const theirs = minRegionHit(row, SUBMAX, E2_TARGETS)?.k ?? null;
  if (mine !== theirs) e2Disagree.push(`«${row}» gate says ${mine}, minRegionHit says ${theirs}`);
  if (theirs !== null) e2Reached++;
}
check(
  "§E′ the re-derived minimum disagrees with minRegionHit over the literal grid",
  e2Disagree.length === 0,
  `${e2Disagree.length} row(s); first: ${e2Disagree[0] ?? "—"}`,
);
check(
  "§E′ the bound admitted NOTHING over the literal grid — the probe is dead code",
  e2Admitted > 0,
  `0 admitted alignments over ${e2Pairs} pairs`,
);
check(
  "§E′ the bound admitted EVERYTHING over the literal grid — the probe is degenerate",
  e2Admitted < e2Pairs,
  `${e2Admitted} of ${e2Pairs} pairs admitted`,
);
check(
  "§E′ the reached half of the literal grid is empty",
  e2Reached > 0,
  `0 of ${E2_ROWS.length} rows reached`,
);
check(
  "§E′ the far half of the literal grid is empty",
  e2Reached < E2_ROWS.length,
  `all ${e2Reached} rows reached`,
);
// Six tokens rewritten wholesale is one 6→6 region, over the bound of 4, so the search must return
// null.
const E2_BOUND_TEXT = "a b c d e f";
const E2_BOUND_TARGET = "u v w x y z";
const e2Bound = minRegionHit(E2_BOUND_TEXT, 4, [E2_BOUND_TARGET]);
check(
  "§E′ minRegionHit admitted a region over the bound — the bound is not applied",
  e2Bound === null,
  `expected null, got ${e2Bound === null ? "null" : `k = ${e2Bound.k} onto «${e2Bound.onto}»`}`,
);
// The literal's own premise, re-measured so it cannot rot into a tautology: the pair must
// really reduce to ONE region whose size is over the bound.
const e2BoundPremise = editRegions(T(E2_BOUND_TEXT), T(E2_BOUND_TARGET));
check(
  "§E′ the region-bound literal's premise broke — it is not one region over the bound",
  e2BoundPremise.length === 1 && (e2BoundPremise[0]?.alen ?? 0) > 4,
  `reduces to «${shape(e2BoundPremise)}»`,
);

// ─── VERDICT ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`opaque-anatomy-gate: ${failures.length} claim(s) FAILED\n`);
  for (const f of failures) console.error(`  🛑 ${f}\n`);
  process.exit(1);
}
const blockers = MARKER_COUNTS.filter((m) => m.marker.verdict === "blocker").length;
console.log(
  `opaque-anatomy-gate: OK — §A no k=1 row over ${OPAQUE.length} OPAQUE sentences, §B ${B_CASES.length} region-reduction claims hold, §C ${blockers} blocker(s) with an empty built side and ${MARKER_COUNTS.length - blockers} co-marker(s) with a live one, §D ${classes.size} classes covering ${sumS} sentences / ${sumU} printings exactly once, §E ${admitted} admitted of ${pairs} grid pairs and ${reached} reached / ${ANATOMY.length - reached} far, re-derived in agreement, §E′ ${e2Admitted} admitted of ${e2Pairs} literal pairs and ${e2Reached} reached / ${E2_ROWS.length - e2Reached} far, the region bound applied.`,
);
