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
 *   positive and this gate goes RED and names it. (🆕🆕🆕 D573: IT DID — D573 built four of the
 *   six copy-attack sentences, the built side went 0 / 0 → 4 / 9, this section went RED naming
 *   `COPY-ATTACK`, and the marker was re-declared a `co-marker` with its regex kept whole, D508's
 *   rule. The forecast is kept as the record of a prediction that came true.) It also asserts that no row is
 *   ever LABELLED by a `co-marker`, which is the whole discipline the second
 *   axis rests on.
 *   ⚠️ **THAT LAST CLAIM ALSO NEEDS A WITNESS IN THE POPULATION (D571).** It goes
 *   red only while some live FAR row matches a co-marker, and D571 built one of
 *   the five. So § C also labels a PINNED literal far sentence (the `PRIZE-ZONE`
 *   witness's words) through `blockerMarkerOf`, with its premise re-measured.
 *   (🆕🆕🆕 D575 (D539): D575 built the pinned sentence itself — N's Sigilyph "Victory Symbol" — and one
 *   more `SCHEMA-BANNER` witness; one live far witness, Koraidon `sv08-116`, remains, and the literal
 *   carries the claim regardless.)
 *   (🆕🆕🆕 D579 (D539): ~~"one live far witness … remains"~~ — D579 BUILT Koraidon; none remains, and
 *   the literal carries the claim alone.)
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
 *   ⚠️ **THE RE-DERIVATION NEEDS A WITNESS IN THE POPULATION, AND D569 BUILT IT.**
 *   It only goes red under a first-hit search while some live row's first
 *   admitted alignment is larger than its minimum; after D569 none is. So § E
 *   also runs `minRegionHit` over a PINNED literal pair whose first target is
 *   admitted at k = 2 and whose second is admitted at k = 1 — the
 *   population-independent half of the same claim.
 *   🆕🆕🆕 **D579 — AND THE WHOLE POPULATION IS GONE.** D579 built the last two `OPAQUE`
 *   sentences, so § E's four population claims are vacuous-safe (`OPAQUE.length === 0 || …`)
 *   and § E′ asks the same claims of a FIXED literal grid, plus the region bound asked of
 *   `minRegionHit` directly on a pinned over-bound pair. The gate-witness rows that § E killed
 *   are killed by § E′ at 0 OPAQUE (measured, all sixteen).
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
// 🛑 THE PINNED CO-MARKER WITNESS (D571, the D569 close-out's gate-witness rule). The claim
// above can only kill `D471-co-marker-may-label` while some LIVE far OPAQUE row matches a
// co-marker, and at D570 there were FIVE such rows: three `SCHEMA-BANNER` (Ancient/Future),
// one `PRIZE-ZONE` and one `ANY-NUMBER-OF`. D571 BUILT one of the three (Iron Thorns
// "Destructo-Press"), and a Paradox slice is the likeliest to build the other two. (🆕🆕🆕 D574:
// and D574 BUILT the `ANY-NUMBER-OF` one — Sableye "Damage Collection" — so the live witnesses
// are three: two `SCHEMA-BANNER`, one `PRIZE-ZONE`. This pin is what still holds the row.) (🆕🆕🆕 D575 (D539):
// ~~"three remain"~~ — D575 BUILT the `PRIZE-ZONE` witness (N's Sigilyph "Victory Symbol", the very
// sentence pinned below) and one of the two `SCHEMA-BANNER` ones (Miraidon "C.O.D.E.: Protect"); ONE live
// far witness remains — Koraidon `sv08-116`
// "Unrelenting Onslaught", `SCHEMA-BANNER` — and the pinned literal below still holds the row, unchanged:
// a literal is not built away when its sentence is. The gate-witness probe read 16/16 KILLED after D575.) (🆕🆕🆕 D579 (D539):
// ~~"ONE live far witness remains — Koraidon"~~ — D579 BUILT it; NO live far witness remains and the OPAQUE
// class is EMPTY, so this row rests on the pinned literal ALONE — exactly the case the pin was written for.
// The gate-witness probe read 16/16 KILLED on the D579 bytes.) So the
// label is also asked of a FIXED far sentence no slice can build away: the live
// `PRIZE-ZONE` witness's own words, held here as a literal (🆕🆕🆕 D575 (D539): the sentence is BUILT now — no longer
// "live" — and the literal is exactly why that changes nothing here). A co-marker matches it and no
// blocker does, so only a labeller that lets a co-marker label returns non-null.
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
// 🛑 THE PINNED WITNESS (D569). The re-derivation above can only kill
// `D471-min-region-takes-the-first-hit` while some LIVE `OPAQUE` row has a
// first-admitted alignment larger than its minimum — and the last such row,
// «This attack does 10 more damage for each Ancient card in your discard
// pile.» (first admitted k = 5, minimum k = 2), was BUILT by D569 and left the
// residue. The suite did not weaken; its only witness was consumed by progress.
// So the search is also run over a FIXED pair that no slice can build away: the
// FIRST target is admitted at k = 2, the SECOND at k = 1, and only a search
// that keeps the SMALLEST returns the second. Population-independent, so this
// row's kill no longer rides on what the residue happens to contain.
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
// 🆕🆕🆕 D579 — THE FOUR POPULATION CHECKS BELOW ARE VACUOUS-SAFE (`OPAQUE.length === 0 || …`).
// D579 built the last two `OPAQUE` sentences (Walking Wake `sv06-063` "Undulating Slice" and
// Koraidon `sv08-116` "Unrelenting Onslaught"), so the class is EMPTY at this head: a grid of
// 0 × N pairs admits nothing and reaches nothing, and the four claims would be red on a repo
// that improved — the failure mode this file's own doc block refuses. Each claim still holds
// over a NON-empty population, and what it protected is carried, population-independently, by
// § E′ below (the same four claims over a FIXED literal grid). Measured: at 0 OPAQUE the four
// mutation rows these claims killed (`D471-region-bound-not-applied` above all) are killed by
// § E′ alone.
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

// ─── § E′ (D579). THE SAME CLAIMS OVER A FIXED LITERAL GRID ──────────────────
// 🛑 THE GATE-WITNESS RULE (the D569 close-out), paid BEFORE the build that needed it. § E's
// re-derivation, its grid total and its two non-degeneracy pairs all read the LIVE `OPAQUE`
// class, and D579 empties it — so every mutation row those claims killed would silently
// survive. This section asks the same questions of a FIXED 2 × 2 grid no slice can build away:
// the plain-loop minimum must agree with `minRegionHit` row by row; the bound must admit
// something and not everything; and the reached half and the far half must both be non-empty.
// Row 1 is admitted onto target 1 at k = 2 (③'s two separated 1→1 regions) and is REACHED;
// row 2 is a 12-token sentence that reduces onto target 2 to a 5→0 head plus a 0→3 tail and
// onto target 1 to one 12→5 region — over the bound both ways, so it is FAR.
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
// 🛑 THE REGION BOUND, ASKED OF `minRegionHit` DIRECTLY. Six tokens rewritten wholesale is ONE
// 6→6 region, over the bound of 4, so the search must answer null; a search that never applies
// the bound answers k = 1. This is the claim `D471-region-bound-not-applied` dies on at 0 OPAQUE
// (measured: § E′'s grid above does not reach it on its own), so the literal is load-bearing.
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
