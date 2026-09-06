#!/usr/bin/env bun
/**
 * THE `OPAQUE` ANATOMY (D471) — `bun scripts/opaque-anatomy.ts`, no arguments.
 *
 * WHY THIS FILE EXISTS. `scripts/residue-census.ts` classes a residue sentence
 * `OPAQUE` when **no deletion and no substitution it can make reaches a built
 * string**. That class is now **78 sentences / 112 printings — 70% of the
 * residue — and it has not moved in FOUR slices** while every reachable class
 * around it drained (D467 → D470). Nobody had asked why, or whether it is one
 * thing or many. The conventions already say what the class is NOT: D463's
 * *"`OPAQUE` means UNCLASSIFIED, never EXPENSIVE"* — a statement about the
 * INSTRUMENT'S REACH, not about the work. This file asks what it IS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWER, IN ONE SENTENCE. `OPAQUE` is two populations, and the larger one
 * is an artefact of a single implementation choice: **all three of
 * `residue-census.ts`'s probes are SINGLE-REGION.** One segment removed, one
 * span deleted, one contiguous substitution. A sentence that differs from a
 * built one at TWO SEPARATED POINTS is unreachable by every one of them, however
 * small each difference is — and that is 33 of the 78 rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO AXES, IN THE ORDER A ROW IS TESTED AGAINST THEM.
 *
 * ① THE k-REGION PROBE (mechanical, derived, no vocabulary of its own).
 *    Align the sentence against every BUILT corpus sentence with a token-level
 *    Levenshtein backtrace and count the MAXIMAL DISJOINT EDIT REGIONS. A region
 *    is a run of substitute/delete/insert operations bounded by matches. Keep
 *    only alignments in which EVERY region is at most `SUBMAX` tokens on each
 *    side — the same bound `residue-census.ts`'s `substProbe` uses — and report
 *    the smallest region COUNT over all built sentences. `MULTI-k` is that k.
 *
 *    🛑 **`k = 1` IS EXACTLY WHAT `substProbe` ALREADY REPORTS, so over the
 *    `OPAQUE` class it MUST BE EMPTY.** That is not a design choice, it is the
 *    cross-check: a single contiguous edit region within `SUBMAX` is bounded by
 *    the maximal common prefix and suffix, which is precisely the alignment
 *    `substProbe` computes, and a single PURE-DELETION region is what `spanProbe`
 *    computes. If a `k = 1` row ever appears here, this instrument and the census
 *    disagree and one of them is wrong. `scripts/opaque-anatomy-gate.ts` §A
 *    asserts it, and holds no number of its own to do so.
 *
 * ② THE MARKER PROBE, WITH A BUILT-SIDE CONTROL (semantic, and the control is
 *    the whole of what makes it honest). A marker is a regex over the printed
 *    sentence. For each one this file reports its population **on both sides of
 *    the build line**, over the whole 640-sentence legal column:
 *      · `BLOCKER`   — zero BUILT sentences carry it. The engine has never
 *                      claimed any sentence with this marker, anywhere.
 *      · `CO-MARKER` — some BUILT sentence carries it. The phrase is served, so
 *                      it is NOT why these rows are opaque, and a brief that
 *                      names it as the reason is wrong.
 *    **Only a `BLOCKER` may label a row.** A `CO-MARKER` is reported and never
 *    used, which is the point: FIVE of the ten markers below were written as
 *    blockers by the author of this file and REFUTED by their own control —
 *    continuing effects, Prize-zone reads, both-sides board scope, card-name
 *    counting and opponent-hand choice all appear in sentences this engine
 *    builds today.
 *
 * ⚠️ **AND THE BIGGEST REFUTATION IS THE ONE THAT LOOKED MOST OBVIOUS.** The
 * single most plausible story about `OPAQUE` — *"it is the continuing-effect
 * seam, and `continuous.ts` cannot express these"* — is FALSE by a wide margin:
 * `CONTINUOUS` carries **49 built sentences / 217 printings**. That is D464's
 * fold defect at family scale — *one row refused by N anchors is N claims, and
 * only one of them may be true* — with the quantifier on the family instead of
 * the row. **Run the marker over the BUILT side before you write the sentence.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT THIS INSTRUMENT CANNOT SEE — read this before quoting a number.
 * (D419's rule, and D467's session log is the model: say it out loud.)
 *
 * · 🛑 **`MULTI-k` IS A LOWER BOUND ON THE WORK AND A BAD ESTIMATE OF IT** —
 *   D459's standing rule for `PHRASE-n`, inherited unchanged and, if anything,
 *   sharper here. Two SMALL regions can be two WHOLE MECHANISMS: *"Discard a
 *   card from your hand. If you do, draw 2 cards."* is `MULTI-3` onto *"Discard
 *   your hand and draw 6 cards."* and the three regions hold a cost, a
 *   conditional and a count. The probe measures the DISTANCE from a built
 *   string, never the price of closing it.
 * · 🛑 **THE NEAREST BUILT SENTENCE IS CHOSEN BY REGION COUNT, NOT BY MEANING.**
 *   Ties are broken by corpus order, and a semantically unrelated neighbour can
 *   win on bytes. The `→` line is evidence for the CLASS, not a work order.
 * · 🛑 **A MARKER IS A REGEX OVER PRINTED TEXT, AND A `BLOCKER` VERDICT IS ONLY
 *   AS WIDE AS ITS ALTERNATION.** `VARIABLE-MAX` is a blocker as spelled; add the
 *   one alternative `any number of` and its built side goes to 5 sentences / 12
 *   printings and it is refuted. That is not a flaw to be hidden — it is why
 *   `ANY-NUMBER-OF` ships beside it as a declared `CO-MARKER`, so the sensitivity
 *   is visible in the output rather than in this paragraph.
 * · 🛑 **`UNEXPLAINED` IS THE HONEST RESIDUAL AND IT IS THE BIGGEST CLASS OF THE
 *   FAR HALF.** 31 sentences / 41 printings carry no marker this instrument
 *   holds. That number is meant to stay visible; the alternative — inventing a
 *   marker per row until the table reads 100% — would produce a partition that
 *   explains nothing and cannot be refuted.
 * · **IT INHERITS EVERY LIMIT OF `residue-census.ts`**: the population is
 *   `legal_standard = 1` only (printings are a FLOOR, D445); the reader surface
 *   is keyed on the `deriveAttack` name prefix; the registry arm reads a test
 *   file; `splitAttackTrailingClause` counts as BUILT. It adds no population and
 *   no build predicate of its own — `builds()` is imported, never re-derived.
 * · **IT SAYS NOTHING ABOUT CORRECTNESS** (D469): every figure here is about
 *   which strings the readers CLAIM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT KILLS, AND WHAT KILLS IT (D465 — an instrument that measures the repo
 * must be killable by the corpus). `scripts/**` sits outside vitest's include
 * globs and outside `tsc -b`'s project references, so a `*.test.ts` importing
 * this file would break the typecheck rather than guard anything. The killer is
 * `scripts/opaque-anatomy-gate.ts`, a `killedByCommand` gate on D212's
 * precedent, and the corpus carries six rows that die through it.
 *
 * Env overrides, none required: `SUBMAX` (default 4) — the largest edit region,
 * in tokens on either side, that still counts as one axis. It is deliberately
 * the same default as `residue-census.ts`'s, because § A's cross-check between
 * the two probes is only meaningful when both use one bound.
 */

import { legalAttackCorpus } from "../packages/engine/src/censusAttackCorpus";
import { builds, rows } from "./residue-census";

const SUBMAX = Number(process.env.SUBMAX ?? 4);

// ─── 1. THE POPULATION ───────────────────────────────────────────────────────
const corpus = legalAttackCorpus();
/** The BUILT side of the legal column — the alignment targets, and the control
    population for every marker. Same predicate as the census; not re-derived. */
export const BUILT_SENTENCES: readonly string[] = corpus
  .filter(([, t]) => builds(t))
  .map(([, t]) => t);
/** The residue, by text — a marker's RESIDUE side is the complement of BUILT
    within the legal column, so it is computed rather than re-filtered. */
const RESIDUE_TEXT = new Set(rows.map((r) => r.text));
/** The subject. `OPAQUE` is `residue-census.ts`'s own class name, read off its
    exported rows so this file cannot drift from the class it anatomises. */
export const OPAQUE = rows.filter((r) => r.cls === "OPAQUE");

// ─── 2. AXIS ① — THE k-REGION PROBE ──────────────────────────────────────────
/** One maximal run of non-matching alignment operations. `alen` counts tokens
    consumed from the residue sentence, `blen` from the built one — so a pure
    deletion has `blen === 0` and a pure insertion `alen === 0`. */
export type EditRegion = { alen: number; blen: number };

/**
 * Token-level Levenshtein with a backtrace, reduced to its MAXIMAL DISJOINT EDIT
 * REGIONS. Two equal token sequences produce zero regions; a sentence differing
 * in one contiguous place produces one; the case this whole file exists for —
 * two separated differences — produces two.
 *
 * ⚠️ ADJACENT EDITS MERGE. A substitution immediately followed by a deletion is
 * ONE region, not two, because nothing matches between them. That is the
 * definition a single-region probe is blind to the complement of, so getting it
 * wrong in the merging direction would silently move rows from `MULTI-2` into a
 * `MULTI-1` that must not exist — which is exactly what § A of the gate watches.
 */
export function editRegions(a: readonly string[], b: readonly string[]): EditRegion[] {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = (d[i - 1]?.[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const del = (d[i - 1]?.[j] ?? 0) + 1;
      const ins = (d[i]?.[j - 1] ?? 0) + 1;
      const row = d[i];
      if (row !== undefined) row[j] = Math.min(sub, del, ins);
    }
  }
  const ops: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const here = d[i]?.[j] ?? 0;
    if (i > 0 && j > 0 && here === (d[i - 1]?.[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push(a[i - 1] === b[j - 1] ? "=" : "s");
      i--;
      j--;
    } else if (i > 0 && here === (d[i - 1]?.[j] ?? 0) + 1) {
      ops.push("d");
      i--;
    } else {
      ops.push("i");
      j--;
    }
  }
  ops.reverse();
  const regions: EditRegion[] = [];
  let cur: EditRegion | null = null;
  for (const op of ops) {
    if (op === "=") {
      cur = null;
      continue;
    }
    if (cur === null) {
      cur = { alen: 0, blen: 0 };
      regions.push(cur);
    }
    if (op === "s") {
      cur.alen++;
      cur.blen++;
    } else if (op === "d") {
      cur.alen++;
    } else {
      cur.blen++;
    }
  }
  return regions;
}

export type RegionHit = { k: number; onto: string; regions: EditRegion[] };

/** The smallest number of BOUNDED edit regions between `text` and any built
    sentence, or `null` when no alignment keeps every region within `SUBMAX`.
    ⚠️ The bound is applied to the alignment BEFORE the count is compared, which
    is what stops the probe from degenerating: without it every sentence is one
    region away from every other and the table reads `MULTI-1` for all 78. */
export function minRegionHit(text: string, submax: number = SUBMAX): RegionHit | null {
  const a = text.split(" ");
  let best: RegionHit | null = null;
  for (const onto of BUILT_SENTENCES) {
    const regions = editRegions(a, onto.split(" "));
    if (regions.length === 0) continue;
    if (regions.some((r) => r.alen > submax || r.blen > submax)) continue;
    if (best === null || regions.length < best.k) best = { k: regions.length, onto, regions };
  }
  return best;
}

/** Totals over the whole (OPAQUE × BUILT) grid — a population, so a silent
    narrowing of the probe shows up as a COUNT rather than as an absence
    (D465's third property). */
export function gridTotals(submax: number = SUBMAX): {
  pairs: number;
  rejected: number;
  admitted: number;
} {
  let pairs = 0;
  let rejected = 0;
  for (const r of OPAQUE) {
    const a = r.text.split(" ");
    for (const onto of BUILT_SENTENCES) {
      pairs++;
      const regions = editRegions(a, onto.split(" "));
      if (regions.length === 0 || regions.some((x) => x.alen > submax || x.blen > submax)) rejected++;
    }
  }
  return { pairs, rejected, admitted: pairs - rejected };
}

// ─── 3. AXIS ② — THE MARKERS AND THEIR BUILT-SIDE CONTROL ────────────────────
/** `verdict` is DECLARED by the author and CHECKED by the control. A row is
    labelled only by a `blocker`, and the gate asserts every declared `blocker`
    really has a zero built side and every declared `co-marker` really does not.
    So a marker cannot quietly become the other thing. */
export type Marker = {
  name: string;
  rx: RegExp;
  verdict: "blocker" | "co-marker";
  /** What the sentence would need, in the vocabulary of this repo. */
  needs: string;
};

export const MARKERS: readonly Marker[] = [
  {
    name: "COPY-ATTACK",
    rx: /use it as this attack/,
    verdict: "blocker",
    needs:
      "attack() §8.5 as a callable function taking an attacker, a defender and a `declared` — the standing refusal's own executable falsifier, plus a bound on `runProgram`'s unbounded queue",
  },
  {
    name: "SCHEMA-BANNER",
    rx: /\b(?:Ancient|Future|Tera)\b/,
    verdict: "blocker",
    needs:
      "an ingest COLUMN. `cardSchema` has 21 keys and none classifies the banner (D468), so a filter over it counts 0 on every board forever",
  },
  {
    name: "NAMED-ATTACK",
    rx: /used (?:Angelite|Rollout)|Hyper Fang|United Wings/,
    verdict: "blocker",
    needs:
      // 🛑🛑 D479 — THE FIRST CLAUSE OF THIS `needs` WAS FALSE AND IS CORRECTED IN
      //    PLACE (D442/D466); the original is kept below the corrected text as the
      //    record (D178). `InPlayPokemon.usedAttack` (D394) IS a state field carrying
      //    exactly "which attack this body used", `BoardCondition` spells it TWICE
      //    (`yourActiveUsedAttackLastTurn { attack }` D394 and
      //    `yourPokemonUsedAttackLastTurn { attack }` D396), and
      //    `ATTACK_GATE_CLAUSE_GATES` in `effects.ts` already holds a SHIPPED row for
      //    this marker's own corpus line 630 —
      //    `{ kind: "onlyIf", condition: { kind: "yourActiveUsedAttackLastTurn",
      //    attack: "Rollout" } }`. That row is ENFORCED at the §8 declaration seam
      //    today; it sits in the residue only because `builds()` refuses a gate split
      //    whose `body` is `""` (D395's clause-only case), which is a fact about the
      //    CENSUS and not about expressibility.
      //    ⚠️ The verdict stays `blocker` because the OTHER three rows still are —
      //    but for three different reasons, none of them this one: line 82 is blocked
      //    on its "Choose 2 … Shuffle those … into your opponent's deck" HEAD, line
      //    166 on a named-attack BASE-DAMAGE override, line 542 on a `CardFilter` over
      //    a card's printed attack list. D463: a refusal grouping N rows under ONE
      //    reason is N refusals until each is priced.
      "a mechanism per row, and NOT the one this marker used to name: line 82's head, " +
      "line 166's named-attack base-damage override, line 542's `CardFilter` over a " +
      "card's printed attack list — while line 630's named-attack fact is SHIPPED " +
      "(`InPlayPokemon.usedAttack`, `BoardCondition.yourActiveUsedAttackLastTurn`, and " +
      "an `ATTACK_GATE_CLAUSE_GATES` row for that very sentence). " +
      "[D479 corrected. WAS: \u201Ca record of WHICH ATTACK a body used, keyed by the " +
      "attack\u2019s printed NAME \u2014 a fact no state field carries and no CardFilter " +
      "member spells\u201D]",
  },
  {
    name: "VARIABLE-MAX",
    rx: /up to the number of|number of cards up to/,
    verdict: "blocker",
    needs:
      "a choice whose MAXIMUM is computed at resolve time from the board or from a flip count, where every shipped `up to N` op takes a printed integer",
  },
  // ── THE FOUR THAT WERE WRITTEN AS BLOCKERS AND REFUTED BY THEIR OWN CONTROL.
  //    Kept, with the verdict corrected rather than the marker deleted, because
  //    the refutation is the finding (D178 — annotate provenance, never
  //    overwrite it). Each of these reads like a reason and is not one.
  {
    name: "CONTINUOUS",
    rx: /During your next turn|During your opponent's next turn|Until the end of/,
    verdict: "co-marker",
    needs:
      "nothing this marker can name — the continuing-effect seam is the most heavily BUILT thing in the column",
  },
  {
    name: "PRIZE-ZONE",
    rx: /face-down Prize|face up|Prize cards? your opponent has taken|Prize cards? remaining|more Prize cards/,
    verdict: "co-marker",
    needs: "nothing this marker can name — Prize reads and Prize counts both ship",
  },
  {
    name: "BOTH-SIDES-BOARD",
    rx: /both yours and your opponent's/,
    verdict: "co-marker",
    needs: "nothing this marker can name — the both-seats board scope ships",
  },
  {
    name: "CARD-NAME-COUNT",
    rx: /has "[^"]+" in its name|your Drifloon and Drifblim|number of Fennel cards/,
    verdict: "co-marker",
    needs:
      "nothing this marker can name — `CardFilter.ownerPokemon` reads `Card.name` and has since D200",
  },
  {
    name: "OPP-HAND-CHOICE",
    rx: /opponent (?:chooses|discards a card)|your opponent shuffle/,
    verdict: "co-marker",
    needs: "nothing this marker can name — opponent-hand discard and reveal both ship",
  },
  {
    name: "ANY-NUMBER-OF",
    rx: /any number of/,
    verdict: "co-marker",
    needs:
      "nothing this marker can name — and it ships PRECISELY to show how narrow a `blocker` verdict is: this is one alternation away from `VARIABLE-MAX`, and it is refuted where that one is not",
  },
];

export type MarkerCount = {
  marker: Marker;
  opaque: [number, number];
  residue: [number, number];
  built: [number, number];
};

/** The two-sided population of one marker over the WHOLE legal column. */
export function markerCount(marker: Marker): MarkerCount {
  const opaqueText = new Set(OPAQUE.map((r) => r.text));
  const out: MarkerCount = {
    marker,
    opaque: [0, 0],
    residue: [0, 0],
    built: [0, 0],
  };
  for (const [units, text] of corpus) {
    if (!marker.rx.test(text)) continue;
    if (opaqueText.has(text)) {
      out.opaque[0]++;
      out.opaque[1] += units;
    }
    if (RESIDUE_TEXT.has(text)) {
      out.residue[0]++;
      out.residue[1] += units;
    } else {
      out.built[0]++;
      out.built[1] += units;
    }
  }
  return out;
}

export const MARKER_COUNTS: readonly MarkerCount[] = MARKERS.map(markerCount);

// ─── 4. THE PARTITION ────────────────────────────────────────────────────────
export type Anatomy = {
  units: number;
  text: string;
  cls: string;
  hit: RegionHit | null;
  marker: Marker | null;
};

/** ⚠️ AXIS ① IS TESTED FIRST, AND THE ORDER IS AN ARGUMENT RATHER THAN A HABIT.
    D463's rule says `OPAQUE` is a statement about the INSTRUMENT'S REACH before
    it is a statement about the work, so the mechanical axis — the one that says
    the class is an ARTEFACT — gets the first question. The marker table below
    reports every marker's hits over ALL of `OPAQUE`, not only over the far half,
    so nothing a `MULTI-k` label covers is hidden by the ordering. */
export const ANATOMY: readonly Anatomy[] = OPAQUE.map((r) => {
  const hit = minRegionHit(r.text);
  if (hit !== null) return { units: r.units, text: r.text, cls: `MULTI-${hit.k}`, hit, marker: null };
  const marker =
    MARKERS.find((m) => m.verdict === "blocker" && m.rx.test(r.text)) ?? null;
  return {
    units: r.units,
    text: r.text,
    cls: marker === null ? "UNEXPLAINED" : `BLOCKED-${marker.name}`,
    hit: null,
    marker,
  };
});

// ─── 5. RUN ──────────────────────────────────────────────────────────────────
const P = (n: number) => String(n).padStart(3);
const pair = (t: [number, number]) => `${P(t[0])} / ${P(t[1])}`;

if (import.meta.main) {
  console.log("=== THE `OPAQUE` ANATOMY (D471) ===");
  console.log(
    `subject: ${OPAQUE.length} sentences / ${OPAQUE.reduce((s, r) => s + r.units, 0)} printings — the OPAQUE class of scripts/residue-census.ts`,
  );
  console.log(
    `targets: ${BUILT_SENTENCES.length} BUILT sentences in the same legal column   SUBMAX=${SUBMAX}`,
  );

  console.log("\n=== AXIS ① — THE k-REGION PROBE ===");
  console.log("CLASS                    sentences  printings");
  const classes = [...new Set(ANATOMY.map((a) => a.cls))].sort((a, b) => {
    const fam = (c: string) => (c.startsWith("MULTI") ? 0 : c.startsWith("BLOCKED") ? 1 : 2);
    const n = (c: string) => Number(/-(\d+)$/.exec(c)?.[1] ?? 0);
    return fam(a) - fam(b) || n(a) - n(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  for (const c of classes) {
    const hits = ANATOMY.filter((a) => a.cls === c);
    console.log(`${c.padEnd(24)} ${P(hits.length)}        ${P(hits.reduce((s, a) => s + a.units, 0))}`);
  }
  const multi = ANATOMY.filter((a) => a.hit !== null);
  const far = ANATOMY.filter((a) => a.hit === null);
  console.log(
    `\nREACHED by a bounded MULTI-REGION substitution: ${multi.length} / ${multi.reduce((s, a) => s + a.units, 0)}`,
  );
  console.log(
    `FAR — no alignment keeps every region within ${SUBMAX}: ${far.length} / ${far.reduce((s, a) => s + a.units, 0)}`,
  );
  const totals = gridTotals();
  console.log(
    `grid: ${totals.pairs} (row × built) pairs, ${totals.admitted} admitted, ${totals.rejected} rejected on region size`,
  );

  console.log("\n=== AXIS ② — THE MARKERS, WITH THEIR BUILT-SIDE CONTROL ===");
  console.log("MARKER              VERDICT      OPAQUE       RESIDUE        BUILT");
  for (const mc of MARKER_COUNTS) {
    console.log(
      `${mc.marker.name.padEnd(19)} ${mc.marker.verdict.padEnd(11)} ${pair(mc.opaque)}   ${pair(mc.residue)}   ${pair(mc.built)}`,
    );
  }
  console.log(
    "\n⚠️ A CO-MARKER NEVER LABELS A ROW. Its built side is > 0, so the phrase is",
  );
  console.log(
    "   served somewhere and is NOT why these sentences are opaque. FIVE of the",
  );
  console.log("   six were written as blockers and refuted by this very column.");

  console.log("\n=== ROWS, BY CLASS ===");
  for (const c of classes) {
    console.log(`\n── ${c} ${"─".repeat(Math.max(0, 60 - c.length))}`);
    for (const a of ANATOMY.filter((x) => x.cls === c)) {
      console.log(`${P(a.units)}p  ${a.text}`);
      if (a.hit !== null) {
        console.log(`     ${a.hit.k} region(s) → BUILT: ${a.hit.onto}`);
        console.log(
          `     regions: ${a.hit.regions.map((r) => `${r.alen}→${r.blen}`).join("  ")}`,
        );
      }
      if (a.marker !== null) console.log(`     NEEDS: ${a.marker.needs}`);
      if (a.hit === null && a.marker === null) {
        console.log("     no bounded multi-region edit reaches a built string, and no BLOCKER marker fires.");
      }
    }
  }
}
