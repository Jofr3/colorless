#!/usr/bin/env bun
/**
 * Breaks down the residue census's `OPAQUE` class (sentences no single deletion or substitution
 * brings to a built string). Its main finding: every census probe is single-region, so a sentence
 * that differs from a built one at two separate points is unreachable by all of them. Run with `bun
 * scripts/opaque-anatomy.ts`.
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
 * Token-level Levenshtein with a backtrace, reduced to its maximal disjoint edit regions: equal
 * sequences give zero regions, one contiguous difference gives one, two separated differences give
 * two.
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

/**
 * The smallest number of bounded edit regions between `text` and any built sentence, or `null` when
 * no alignment keeps every region within `SUBMAX`. The bound is applied before counts are compared;
 * without it every sentence is one region away from every other.
 */
export function minRegionHit(
  text: string,
  submax: number = SUBMAX,
  targets: readonly string[] = BUILT_SENTENCES,
): RegionHit | null {
  const a = text.split(" ");
  let best: RegionHit | null = null;
  for (const onto of targets) {
    const regions = editRegions(a, onto.split(" "));
    if (regions.length === 0) continue;
    if (regions.some((r) => r.alen > submax || r.blen > submax)) continue;
    if (best === null || regions.length < best.k) best = { k: regions.length, onto, regions };
  }
  return best;
}

/**
 * Totals over the whole OPAQUE x BUILT grid, so a silent narrowing of the probe shows up as a
 * changed count.
 */
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
      if (regions.length === 0 || regions.some((x) => x.alen > submax || x.blen > submax))
        rejected++;
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
    verdict: "co-marker",
    needs:
      "nothing — all six sentences are built (four at declaration, D573; the two that REVEAL or MILL first in the MIDDLE of the attack, D574)",
  },
  {
    name: "SCHEMA-BANNER",
    rx: /\b(?:Ancient|Future)\b/,
    verdict: "co-marker",
    needs:
      "nothing new — `banners.ts` (D568/D569) classifies all three banners by printing id; what is left of the Ancient/Future residue is blocked by OTHER mechanisms (a persisted attacker class, a seat-level attack record, a set-target block)",
  },
  {
    name: "TERA-BANNER",
    rx: /\bTera\b/,
    verdict: "co-marker",
    needs:
      "nothing new — `banners.ts` (D568) classifies the banner by printing id; its attack residue is EMPTY at D573 (Gemstone Mimicry, the last Tera attack sentence, is built)",
  },
  {
    name: "NAMED-ATTACK",
    rx: /used (?:Angelite|Rollout)|Hyper Fang|United Wings/,
    verdict: "co-marker",
    needs:
      "no row left in the residue: line 82's head is BUILT (D541) and line 166's " +
      "named-attack base-damage override is BUILT (D544, a `base` rider on `boostAttack`) " +
      "— while line 630's named-attack " +
      "fact is SHIPPED " +
      "(`InPlayPokemon.usedAttack`, `BoardCondition.yourActiveUsedAttackLastTurn`, and " +
      "an `ATTACK_GATE_CLAUSE_GATES` row for that very sentence) and line 542 is BUILT " +
      "(D508, the anchor — its filter had been spellable since D446). " +
      "[D544 corrected. WAS: \u201Ca mechanism per row, and NOT the one this marker used " +
      "to name: line 82\u2019s head and line 166\u2019s named-attack base-damage override\u201D] " +
      "[D479 corrected. WAS: \u201Ca record of WHICH ATTACK a body used, keyed by the " +
      "attack\u2019s printed NAME \u2014 a fact no state field carries and no CardFilter " +
      "member spells\u201D]",
  },
  {
    name: "VARIABLE-MAX",
    rx: /up to the number of|number of cards up to/,
    verdict: "co-marker",
    needs:
      "nothing this marker can name since D525 — the heads-count ceiling ships as `retrievalUpToHeads` (one `discardPileRetrieval` with `max: heads` written at the fold). [D525 corrected. WAS: \u201ca choice whose MAXIMUM is computed at resolve time from the board or from a flip count, where every shipped `up to N` op takes a printed integer\u201d]",
  },
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
    needs:
      "nothing this marker can name — the both-seats board scope ships, as a WALK (`counterEachAll.side`, `handRefresh.who`, `spreadDamage` composed twice) and, since D512, as a COUNT (`bothSidesPokemonInPlay`, beside `bothSidesBenchCount` and `bothActivesEnergyCount`)",
  },
  {
    name: "CARD-NAME-COUNT",
    rx: /has "[^"]+" in its name|your Drifloon and Drifblim|number of Fennel cards/,
    verdict: "co-marker",
    needs:
      "nothing this marker can name — `CardFilter.ownerPokemon` reads `Card.name` (a PREFIX) and has since D200, D510's `supporterNameContaining` reads it UNANCHORED under a Supporter head, and D512's `pokemonNameContaining` reads it UNANCHORED under a Pokémon head",
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

/**
 * The mechanical axis is tested first, because `OPAQUE` describes the instrument's reach before it
 * describes the work. The marker table counts hits over all of `OPAQUE`, so the ordering hides
 * nothing.
 */
export function blockerMarkerOf(r: { readonly text: string }): Marker | null {
  const marker = MARKERS.find((m) => m.verdict === "blocker" && m.rx.test(r.text)) ?? null;
  return marker;
}

export const ANATOMY: readonly Anatomy[] = OPAQUE.map((r) => {
  const hit = minRegionHit(r.text);
  if (hit !== null)
    return { units: r.units, text: r.text, cls: `MULTI-${hit.k}`, hit, marker: null };
  const marker = blockerMarkerOf(r);
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
    console.log(
      `${c.padEnd(24)} ${P(hits.length)}        ${P(hits.reduce((s, a) => s + a.units, 0))}`,
    );
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
  console.log("\n⚠️ A CO-MARKER NEVER LABELS A ROW. Its built side is > 0, so the phrase is");
  console.log("   served somewhere and is NOT why these sentences are opaque. SIX of the");
  console.log("   seven were written as blockers and refuted by this very column —");
  console.log("   five on the day it was written, and NAMED-ATTACK at D508, by a build.");

  console.log("\n=== ROWS, BY CLASS ===");
  for (const c of classes) {
    console.log(`\n── ${c} ${"─".repeat(Math.max(0, 60 - c.length))}`);
    for (const a of ANATOMY.filter((x) => x.cls === c)) {
      console.log(`${P(a.units)}p  ${a.text}`);
      if (a.hit !== null) {
        console.log(`     ${a.hit.k} region(s) → BUILT: ${a.hit.onto}`);
        console.log(`     regions: ${a.hit.regions.map((r) => `${r.alen}→${r.blen}`).join("  ")}`);
      }
      if (a.marker !== null) console.log(`     NEEDS: ${a.marker.needs}`);
      if (a.hit === null && a.marker === null) {
        console.log(
          "     no bounded multi-region edit reaches a built string, and no BLOCKER marker fires.",
        );
      }
    }
  }
}
