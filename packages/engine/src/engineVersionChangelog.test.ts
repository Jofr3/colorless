import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { engineVersion } from "./index";

// D506 — THE CHANGELOG GUARD. `index.ts` CARRIES 202 VERSION-PROVENANCE HEADINGS
// AND UNTIL THIS FILE NOTHING — NO GATE, NO TEST, NO MUTANT ROW — EVER READ ONE.
//
// The declaration of `engineVersion` at the foot of this package carries a
// ~1,480-line doc comment whose paragraphs open:
//
//   🆕🆕🆕 engineVersion <old> → **<new>** (D<nnn> — …)
//
// That is the only record in the repository of WHICH SLICE SHIPPED WHICH ENGINE
// VERSION that a reader ever actually reads, and at D505's head it was wrong in
// three places, verified against `git log -- packages/engine/package.json`:
//
//   (a) D501 EDITED D500's HEADING INSTEAD OF ADDING ITS OWN. The heading read
//       `0.391.0 → **0.393.0** (D500 …)`, which swallowed D501's bump and
//       attributed it to D500; the string `0.392.0` appeared nowhere in the
//       file. 🛑 AND THE MECHANISM IS WORTH NAMING, BECAUSE IT WAS NOT
//       CARELESSNESS: D501's ONLY edit to `index.ts` was that one arrow
//       (`git show 58f14838 -- packages/engine/src/index.ts` is a one-line
//       diff). The house version-tax sweep is VALUE-KEYED — grep the outgoing
//       literal, re-point every hit — and a changelog heading legitimately
//       CONTAINS the outgoing literal as its target. So the sweep that is
//       supposed to move every pin forward also rewrites the one occurrence
//       that must stay still. D500's own block even prints an exception list
//       for exactly this class and names the PREVIOUS heading; the sweep then
//       ate the CURRENT one.
//   (b) 0.394.0 (D502, `3c91f6d5`) had no heading.
//   (c) 0.395.0 (D505, `00dc8659`) had no heading — deliberately, following
//       D502's precedent, with the provenance put in the new suite's header and
//       the op's doc block instead.
//
// 🛑 SO WHAT GOES RED HERE, STATED FIRST (D200 → D214's rule — a check whose
// author cannot name the edit that breaks it is vacuous):
//
//   (1) SHIP A VERSION WITHOUT WRITING ITS HEADING — defects (b) and (c)
//       exactly. `package.json` says 0.396.0 and the newest heading still
//       targets 0.395.0 → the HEAD case fails, naming both values. Un-bolding
//       one heading's target (`→ **0.395.0**` → `→ 0.395.0`) is the same
//       failure reached from the other side and is what `-changelog-head-
//       unnamed` does;
//   (2) RETARGET AN EXISTING HEADING'S ARROW — defect (a) exactly. Rewrite
//       `0.392.0 → **0.393.0** (D501 …)` as `0.391.0 → **0.393.0** (D501 …)`
//       and THREE cases fail at once — measured: the CHAIN case on a
//       two-release step plus an undeclared hole at 0.392.0, the ATTRIBUTION
//       case because `docs/decisions.md` still records D501 as 0.392.0 →
//       0.393.0, and the UNIQUE case because 0.391.0 becomes the SOURCE of two
//       headings, D500's and this one. ⚠️ THAT IS STRUCTURAL, NOT SLOPPY
//       WIRING: a heading's source and its target are ONE ARROW, so any edit to
//       it is simultaneously an edit to the link, to the claim and to the
//       chain's shape. The cases are kept separate so the report names which
//       property broke rather than just that something did;
//   (3) CLAIM A VERSION TWICE — copy a heading, or write a second one for a
//       version that already has one → the UNIQUE case fails. A version with
//       two headings has two stories and the file cannot say which slice
//       shipped it;
//   (4) 🛑 CLOSE ONE OF THE TEN DECLARED HISTORICAL HOLES WITHOUT DECLARING
//       THAT YOU DID — write the missing `0.259.0 → **0.260.0**` heading and
//       leave `DECLARED_GAPS` alone → the CHAIN case fails from the OTHER side,
//       naming the declaration that has stopped being true. D150's totality
//       rule at an allowlist: a stale exemption must fail as loudly as an
//       undeclared one, or the allowlist quietly becomes an excuse. The same
//       case fails if a NEW hole opens;
//   (5) 🛑 RETYPE A VERSION PAIR IN `docs/decisions.md` — change D501's row to
//       `Engine 0.392.0 → 0.394.0` → the ATTRIBUTION case fails. THIS IS THE
//       POINT OF THE FILE'S SECOND HALF. Every expected (slice → version) fact
//       below is read out of `docs/decisions.md` at test time. There is no table
//       of slice-to-version in this file to drift with the defect it exists to
//       catch (D503's rule, D504's mechanism);
//   (6) MISLABEL A HEADING — change `(D501 —` to `(D504 —` → the ATTRIBUTION
//       case fails on the other branch, because D504 shipped no engine version
//       and `docs/decisions.md` records no pair for it, so the heading names a
//       slice whose bump cannot be adjudicated;
//   (7) DELETE THE HEADINGS, OR CHANGE THE HEADING FORMAT WHOLESALE (drop the
//       `**` from every target, rename `engineVersion` in the prose, replace the
//       arrow) → the PARSE case fails, rather than every case below passing
//       vacuously over an empty list. ⚠️ NO MUTANT ROW KILLS THIS ONE AND THAT
//       IS SAID RATHER THAN HIDDEN: no single `find`/`replace` can unfind 202
//       headings, so the case is a floor against a bulk edit, not against a
//       one-site one. Its job is to protect the other four from a green run over
//       nothing;
//   (8) MOVE `engineVersion` AWAY FROM `package.json` → already covered, by
//       `fanCall.test.ts:715` (`expect(engineVersion).toBe(manifest.version)`)
//       and D275's mutant row. This file asserts the tie again anyway, because
//       the chain's head is compared against BOTH and a reader of a failure
//       message should not have to go and find out which one moved.
//
// ⚠️ THE AUTHORITY QUESTION, DECIDED DELIBERATELY AND WRITTEN DOWN.
//
// The authority for *"which version did slice D<nnn> ship?"* is the repository
// history: the value of `version` in `packages/engine/package.json` at each
// commit. THIS GUARD DOES NOT READ IT, and the reason is not laziness:
//
//   • `packages/engine/tsconfig.json` sets `"types": []` on purpose — the engine
//     runs in a Worker and in the browser — and that blocks an EXPLICIT import
//     too, not just the globals: `import { execFileSync } from
//     "node:child_process"` in this directory is `error TS2591: Cannot find name
//     'node:child_process'` (measured). Widening the engine's types so a doc
//     guard can shell out is exactly the widening `progressLog.test.ts` and
//     `mutationSummaryQuote.test.ts` both refused.
//   • 🛑 AND THE DECIDING MEASUREMENT: `.github/workflows/ci.yml` uses
//     `actions/checkout@v4` with no `fetch-depth`, i.e. a SHALLOW clone of ONE
//     commit. `git log -- packages/engine/package.json` there returns one entry.
//     A guard that hard-fails on that is red in CI the day it lands; a guard that
//     SKIPS when it cannot see the history is worse than no guard at all. There
//     is no third option that keeps `bun run check` honest in both places.
//
// So the guard is built on two authorities that are both present in every
// checkout, neither of which is a copy held by this file:
//
//   • THE CHAIN ITSELF, for structure. `index.ts`'s own 202 headings, plus
//     `engineVersion` and `manifest.version` as the head. Nothing about the
//     structure is transcribed here.
//   • `docs/decisions.md`, for attribution. It records `Engine <old> → <new>`
//     on the row of 225 decisions, INCLUDING all 30 the headings name. It is an
//     independent witness: a misattribution has to be committed identically in
//     two files, by two different steps of the end-of-session ritual, to pass.
//     ⚠️ ITS ACCURACY IS MEASURED, NOT ASSUMED — checked against
//     `git log -p -- packages/engine/package.json` while this file was written,
//     it agrees on 160 of 162 adjudicable slices, the two exceptions being
//     D184's and D389's rows, both far outside the D452+ era the headings label.
//     For the 27 pre-existing labelled headings it agreed 26/27, and the ONE
//     disagreement was defect (a).
//
// 🛑 AND HERE IS EXACTLY WHAT THAT CHOICE CANNOT SEE, stated plainly because a
// green run must not be read as "the changelog is true":
//
//   • A UNIFORM RE-LABELLING. If every heading AND every `docs/decisions.md` row
//     in a stretch were shifted onto the wrong slice together, the chain would
//     still be well formed, the two files would still agree, and this guard
//     would be green. Only the commit history can refute that, and the two
//     bullets above are why it is not read.
//   • THE PROSE. A heading's body — the corpus line, the printing count, the
//     "ZERO new anchors" list — is unchecked. Only the arrow and the `D<nnn>`
//     in the parenthesis are adjudicated.
//   • THE FIFTY-THREE MISSING HEADINGS. Ten historical holes covering 53 engine
//     versions (D233, D272–D273, D278, D282–D292, D297–D298, D326, D354,
//     D412–D424, D439–D451, D466–D478) are DECLARED below rather than filled.
//     The guard freezes them: it cannot be made green by opening a new one, and
//     it goes red if one is closed without saying so. It does not make them
//     less missing.
//   • WHETHER A HEADING EXISTS AT ALL FOR A SLICE THAT SHIPPED NOTHING. A
//     docs-only slice has no bump and wants no heading; nothing here notices a
//     heading that should have been written for a version inside a declared hole.

/** `index.ts` as text — the chain's own bytes. A GLOB rather than `node:fs`, for
    `progressLog.test.ts`'s reason restated above: this package's tsconfig sets
    `"types": []`. Vite resolves the pattern relative to THIS file, so the key is
    the pattern. It is read as RAW BYTES as well as imported, because the
    headings live in a comment and a comment is invisible to the module. */
const SOURCES: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./index.ts", { query: "?raw", import: "default", eager: true });

/** 🛑 THE SECOND AUTHORITY. `docs/decisions.md`, whose per-slice row records the
    engine bump. Read at test time so no (slice → version) table exists in this
    file to drift with the defect it exists to catch. */
const DOCS: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("../../../docs/*.md", { query: "?raw", import: "default", eager: true });

function fileAt(bag: Record<string, string>, key: string): string {
  const text = bag[key];
  if (text === undefined) {
    throw new Error(`${key} is not readable from the glob — keys: ${Object.keys(bag).join(", ")}`);
  }
  return text;
}

const INDEX_TS = fileAt(SOURCES, "./index.ts");
const DECISIONS_MD = fileAt(DOCS, "../../../docs/decisions.md");

/** The head of the chain. Both spellings, so a failure message never leaves the
    reader wondering which of the two moved — the tie between them is
    `fanCall.test.ts`'s rung and D275's mutant row, not this file's job. */
const HEAD = manifest.version;

// ─── (A) THE CHAIN, PARSED OUT OF index.ts ───────────────────────────────────

interface Heading {
  /** The version the heading says the engine was on. */
  readonly from: string;
  /** The version it says the engine moved to — the BOLD one. */
  readonly to: string;
  /** The decision named in the parenthesis, where there is one. 27 of the 199
      pre-existing headings carry it; the older ones predate the convention. */
  readonly decision: string | null;
  readonly line: number;
}

/** Run over the RAW source, not a flattened copy: `\s` already crosses the
    newline-plus-indent a wrapped heading uses, and the 199 headings this found
    at D506's head are exactly the 199 a collapse-then-match pass found.
    Anchored on `engineVersion <v> → **<v>**` — the bold target is what makes a
    heading a CLAIM rather than a mention, and it is why the prose elsewhere in
    the file that says things like `(engineVersion 0.381.0 → 0.382.0)` or
    `toBe("0\.392\.0")` is correctly out of scope. */
const HEADING_RE = /engineVersion\s+(\d+\.\d+\.\d+)\s*→\s*\*\*(\d+\.\d+\.\d+)\*\*\s*(?:\(\*{0,2}(D\d+))?/g;

const NEWLINES: number[] = [];
for (let i = 0; i < INDEX_TS.length; i += 1) if (INDEX_TS[i] === "\n") NEWLINES.push(i);

function lineOf(offset: number): number {
  let lo = 0;
  let hi = NEWLINES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((NEWLINES[mid] ?? 0) < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

const HEADINGS: Heading[] = [...INDEX_TS.matchAll(HEADING_RE)].map((m) => ({
  from: m[1] ?? "",
  to: m[2] ?? "",
  decision: m[3] ?? null,
  line: lineOf(m.index),
}));

const parts = (v: string): [number, number, number] => {
  const [a, b, c] = v.split(".").map((n) => Number.parseInt(n, 10));
  return [a ?? 0, b ?? 0, c ?? 0];
};

function compare(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Is `b` the very next release after `a`? A minor bump resets the patch, a
    patch bump keeps the minor (0.149.0 → 0.149.1 really happened), and a major
    bump is admitted for the day it arrives — this engine has never had one, and
    if it does, this predicate is the place that says so. */
function isNextRelease(a: string, b: string): boolean {
  const [x0, x1, x2] = parts(a);
  const [y0, y1, y2] = parts(b);
  if (y0 === x0 && y1 === x1 + 1 && y2 === 0) return true;
  if (y0 === x0 && y1 === x1 && y2 === x2 + 1) return true;
  return y0 === x0 + 1 && y1 === 0 && y2 === 0;
}

const byTarget = new Map<string, Heading[]>();
for (const h of HEADINGS) {
  const bucket = byTarget.get(h.to);
  if (bucket === undefined) byTarget.set(h.to, [h]);
  else bucket.push(h);
}

const bySource = new Map<string, Heading[]>();
for (const h of HEADINGS) {
  const bucket = bySource.get(h.from);
  if (bucket === undefined) bySource.set(h.from, [h]);
  else bucket.push(h);
}

const TARGETS = [...byTarget.keys()].sort(compare);
const NEWEST = TARGETS[TARGETS.length - 1] ?? "";

const render = (h: Heading): string =>
  `index.ts:${h.line}  ${h.from} → ${h.to}${h.decision === null ? "" : ` (${h.decision})`}`;

// ─── (B) THE TEN DECLARED HISTORICAL HOLES ───────────────────────────────────

/** 🛑 A HOLE IS A NAMED SPAN, NOT A LOOSE TOLERANCE. Ten stretches of engine
    version have no heading at all; every one predates D506 and every one is
    identified by the decisions that bumped through it, read off
    `git log -p -- packages/engine/package.json` when this file was written.
    They are frozen here so that CLOSING one without saying so fails (D150's
    totality rule) and OPENING a new one fails too — which is the whole point,
    because defects (b) and (c) were new holes at the head of the chain.
    ⚠️ IF YOU FILL ONE, DELETE ITS ENTRY IN THE SAME EDIT. Do not widen. */
interface DeclaredGap {
  /** The newest version the chain reaches before the hole. */
  readonly after: string;
  /** The version the next heading claims to leave from. */
  readonly before: string;
  /** How many versions in between have no heading. */
  readonly missing: number;
  readonly why: string;
}

const DECLARED_GAPS: readonly DeclaredGap[] = [
  { after: "0.149.0", before: "0.149.1", missing: 1, why: "D233's patch bump" },
  { after: "0.187.0", before: "0.189.0", missing: 2, why: "D272–D273 — the drift D275's mutant row was installed for" },
  { after: "0.191.0", before: "0.192.0", missing: 1, why: "D278" },
  { after: "0.195.0", before: "0.204.0", missing: 9, why: "D282–D292" },
  { after: "0.207.0", before: "0.209.0", missing: 2, why: "D297–D298" },
  { after: "0.231.0", before: "0.232.0", missing: 1, why: "D326" },
  { after: "0.259.0", before: "0.260.0", missing: 1, why: "D354" },
  { after: "0.315.0", before: "0.326.0", missing: 11, why: "D412–D424" },
  { after: "0.340.0", before: "0.353.0", missing: 13, why: "D439–D451" },
  { after: "0.364.0", before: "0.376.0", missing: 12, why: "D466–D478 — the longest hole, and the one a successor should fill first" },
];

const gapKey = (after: string, before: string): string => `${after} → ${before}`;
const DECLARED = new Set(DECLARED_GAPS.map((g) => gapKey(g.after, g.before)));

interface Break {
  readonly after: string;
  readonly before: string;
  readonly at: Heading;
}

/** Walk the chain in version order. `byTarget` is keyed, so a version claimed
    twice does not derail the walk — that is the UNIQUE case's business, and
    keeping the two apart is what lets a mutant row kill one tripwire alone. */
const BREAKS: Break[] = [];
for (let i = 1; i < TARGETS.length; i += 1) {
  const previous = TARGETS[i - 1] ?? "";
  const here = byTarget.get(TARGETS[i] ?? "")?.[0];
  if (here === undefined) continue;
  if (here.from !== previous) BREAKS.push({ after: previous, before: here.from, at: here });
}

const UNDECLARED = BREAKS.filter((b) => !DECLARED.has(gapKey(b.after, b.before)));
const OBSERVED = new Set(BREAKS.map((b) => gapKey(b.after, b.before)));
const UNUSED = DECLARED_GAPS.filter((g) => !OBSERVED.has(gapKey(g.after, g.before)));

const NOT_ONE_RELEASE = HEADINGS.filter((h) => !isNextRelease(h.from, h.to));

// ─── (C) ATTRIBUTION, READ OUT OF docs/decisions.md ──────────────────────────

/** The per-slice engine bump as `docs/decisions.md` records it. One table row
    per line, so the row's own `| **D<nnn>** |` cell is the key and no offset
    arithmetic is needed. Four ancient rows print their pair twice verbatim
    (D152–D154, D297), so the pairs are deduped and it is DISTINCT pairs that
    have to be unique — a row that records two DIFFERENT bumps is not a witness
    to either. */
const ROW_RE = /^\|\s*\*\*(D\d+)\*\*\s*\|/;
const PAIR_RE = /[Ee]ngine(?:Version)?\s*\**\s*(\d+\.\d+\.\d+)\s*\**\s*→\s*\**\s*(\d+\.\d+\.\d+)\**/g;

const RECORDED = new Map<string, string[]>();
for (const line of DECISIONS_MD.split("\n")) {
  const row = ROW_RE.exec(line);
  if (row === null) continue;
  const slice = row[1] ?? "";
  const pairs = new Set<string>();
  PAIR_RE.lastIndex = 0;
  for (const p of line.matchAll(PAIR_RE)) pairs.add(`${p[1] ?? ""} → ${p[2] ?? ""}`);
  if (pairs.size > 0) RECORDED.set(slice, [...pairs]);
}

const LABELLED = HEADINGS.filter((h) => h.decision !== null);

interface Mismatch {
  readonly heading: Heading;
  readonly why: string;
}

const MISATTRIBUTED: Mismatch[] = [];
for (const h of LABELLED) {
  const slice = h.decision ?? "";
  const recorded = RECORDED.get(slice);
  if (recorded === undefined) {
    MISATTRIBUTED.push({
      heading: h,
      why: `docs/decisions.md records NO engine bump on ${slice}'s row, so the heading names a slice whose version cannot be adjudicated`,
    });
    continue;
  }
  if (recorded.length !== 1) {
    MISATTRIBUTED.push({
      heading: h,
      why: `docs/decisions.md records ${recorded.length} different bumps on ${slice}'s row (${recorded.join("; ")}), so it witnesses none of them`,
    });
    continue;
  }
  const claim = `${h.from} → ${h.to}`;
  if (recorded[0] !== claim) {
    MISATTRIBUTED.push({
      heading: h,
      why: `docs/decisions.md records ${slice} as ${recorded[0] ?? ""}, the heading claims ${claim}`,
    });
  }
}

// ─── THE CASES ───────────────────────────────────────────────────────────────

describe("the engine changelog records the version history it claims to (D506)", () => {
  it("(7) parses a real chain out of index.ts — anti-vacuity, first and explicitly", () => {
    // Every case below is satisfied by an empty heading list, which is exactly
    // what a renamed heading format or a deleted comment leaves behind.
    expect(INDEX_TS.length, "packages/engine/src/index.ts read as an empty string").toBeGreaterThan(
      1_000_000,
    );
    expect(
      HEADINGS.length,
      `only ${HEADINGS.length} "engineVersion <old> → **<new>**" headings parsed out of index.ts — the heading format changed, or the changelog was deleted, and every assertion below would otherwise pass over nothing`,
    ).toBeGreaterThan(150);
    expect(
      LABELLED.length,
      `only ${LABELLED.length} headings name a D<nnn>, so the attribution case has almost nothing to adjudicate`,
    ).toBeGreaterThan(25);
    expect(
      RECORDED.size,
      `only ${RECORDED.size} rows in docs/decisions.md record an engine bump — the second authority was truncated or its row format changed`,
    ).toBeGreaterThan(200);
    for (const h of HEADINGS) {
      expect(h.from, `a parsed heading has no source version: ${render(h)}`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
      expect(h.to, `a parsed heading has no target version: ${render(h)}`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    }
    expect(engineVersion, "engineVersion and packages/engine/package.json disagree — fanCall.test.ts and D275's mutant row own this tie; fix it there").toBe(HEAD);
  });

  it("(1)+(8) the newest heading targets the version the engine is actually on", () => {
    // 🛑 DEFECTS (b) AND (c). Shipping a version and not writing its heading is
    // the cheapest way for this record to go wrong — it is how 0.394.0 and
    // 0.395.0 came to have no provenance at all — and it is invisible to every
    // other instrument in the repo, because nothing else reads the headings.
    expect(
      NEWEST,
      `the newest heading in index.ts targets ${NEWEST}, but the engine is on ${HEAD}. ${
        compare(NEWEST, HEAD) < 0
          ? `everything released after ${NEWEST} shipped with no heading. Write ONE heading PER BUMP — do not retarget the last one, which is exactly D501's defect (see the header). ⚠️ The number of missing headings is deliberately NOT computed here: this guard does not read the commit history, so it cannot know how many releases sit between ${NEWEST} and ${HEAD}`
          : "a heading claims a version the engine has not shipped"
      }`,
    ).toBe(HEAD);
    const ahead = HEADINGS.filter((h) => compare(h.to, HEAD) > 0 || compare(h.from, HEAD) > 0);
    expect(
      ahead.length,
      `${ahead.length} heading(s) name a version ahead of ${HEAD}:\n  ${ahead.map(render).join("\n  ")}`,
    ).toBe(0);
  });

  it("(2)+(4) every heading advances by exactly one release and continues the previous one, except at the ten declared holes", () => {
    // 🛑 DEFECT (a). `0.391.0 → **0.393.0**` is a two-release step, and the
    // 0.392.0 it skipped had no heading of its own — one arrow carrying two
    // lies, which is what a value-keyed version sweep produces when it walks
    // over a heading (see the header).
    expect(
      NOT_ONE_RELEASE.length,
      `${NOT_ONE_RELEASE.length} heading(s) do not advance by exactly one release:\n  ${NOT_ONE_RELEASE.map(render).join("\n  ")}`,
    ).toBe(0);
    expect(
      UNDECLARED.length,
      `${UNDECLARED.length} UNDECLARED hole(s) in the chain — a version was shipped and no heading claims it:\n  ${UNDECLARED.map(
        (b) => `${render(b.at)}  does not continue ${b.after}`,
      ).join("\n  ")}\n  Write the missing heading, or — if the hole is historical and is being frozen rather than filled — add it to DECLARED_GAPS with the decisions it covers.`,
    ).toBe(0);
    expect(
      UNUSED.length,
      `${UNUSED.length} DECLARED_GAPS entr(y/ies) no longer describe a hole in the chain:\n  ${UNUSED.map(
        (g) => `${gapKey(g.after, g.before)} (${g.missing} missing, ${g.why})`,
      ).join(
        "\n  ",
      )}\n  If the hole was filled, delete the entry in the same edit — a stale exemption has to fail as loudly as an undeclared one (D150).`,
    ).toBe(0);
    // The arithmetic of the declaration, so a hole cannot be quietly widened by
    // moving one end of it: 53 versions across the ten spans.
    const spans = DECLARED_GAPS.map((g) => {
      const between = TARGETS.filter(
        (v) => compare(v, g.after) > 0 && compare(v, g.before) < 0,
      ).length;
      return { gap: g, between };
    });
    for (const { gap, between } of spans) {
      expect(
        between,
        `the declared hole ${gapKey(gap.after, gap.before)} has ${between} heading(s) inside it — it is not a hole`,
      ).toBe(0);
    }
  });

  it("(3) no engine version is claimed by two headings, and none is left by two", () => {
    const twiceClaimed = [...byTarget.entries()].filter(([, hs]) => hs.length > 1);
    expect(
      twiceClaimed.length,
      `${twiceClaimed.length} version(s) are the target of more than one heading, so the file tells two stories about which slice shipped them:\n  ${twiceClaimed
        .map(([v, hs]) => `${v}: ${hs.map(render).join(" | ")}`)
        .join("\n  ")}`,
    ).toBe(0);
    const twiceLeft = [...bySource.entries()].filter(([, hs]) => hs.length > 1);
    expect(
      twiceLeft.length,
      `${twiceLeft.length} version(s) are the source of more than one heading:\n  ${twiceLeft
        .map(([v, hs]) => `${v}: ${hs.map(render).join(" | ")}`)
        .join("\n  ")}`,
    ).toBe(0);
  });

  it("(5)+(6) every heading that names a slice agrees with that slice's row in docs/decisions.md", () => {
    // 🛑 THE CASE THE SECOND HALF OF THE FILE EXISTS FOR, AND THE ONLY ONE THAT
    // ADJUDICATES ATTRIBUTION RATHER THAN ARITHMETIC. `0.391.0 → **0.393.0**
    // (D500 …)` was a well-formed-looking claim about the wrong slice, and the
    // row in `docs/decisions.md` said so all along. Nothing compared them.
    expect(
      MISATTRIBUTED.length,
      `${MISATTRIBUTED.length} heading(s) disagree with docs/decisions.md:\n  ${MISATTRIBUTED.map(
        (m) => `${render(m.heading)}\n      ${m.why}`,
      ).join("\n  ")}`,
    ).toBe(0);
    // Anti-vacuity for THIS case specifically: the comparison must actually
    // have happened for most of the labelled era, not been skipped for want of
    // a row to compare against.
    const adjudicated = LABELLED.filter((h) => RECORDED.has(h.decision ?? "")).length;
    expect(
      adjudicated,
      `only ${adjudicated} of ${LABELLED.length} labelled headings had a docs/decisions.md row to be checked against`,
    ).toBe(LABELLED.length);
  });
});

// ⚠️ AND THE HONEST LIMIT OF THIS FILE, restated at the end where a reader of a
// green run will meet it:
//
//   • IT DOES NOT READ THE COMMIT HISTORY, so it cannot refute a misattribution
//     that `docs/decisions.md` shares. The two reasons — the engine's
//     deliberate `"types": []` and CI's shallow checkout — are measured and
//     written out in the header. A successor who wants the real authority should
//     put the check in a program that already has Node types (`scripts/` is the
//     dev-tooling project, D481) and must first answer what it does in a
//     one-commit clone, because `bun run check` runs there.
//   • IT ADJUDICATES THE ARROW AND THE SLICE ID, AND NOTHING ELSE IN THE
//     HEADING. Every factual claim in a heading's body — the corpus file line,
//     the printing count, "ZERO new anchors", the version-tax figures — is
//     unguarded prose, and several of those figures have already been found
//     stale by hand (D505's own close-out found one drifted for two slices).
//   • IT SAYS NOTHING ABOUT THE 172 HEADINGS THAT NAME NO SLICE. Attribution is
//     checkable only where the heading names a `D<nnn>`; the pre-D452 headings
//     are structurally checked and attributively unread.
//   • THE TEN DECLARED HOLES ARE FROZEN, NOT FORGIVEN. 53 engine versions have
//     no provenance anywhere in this file. The guard stops the number growing
//     and will notice the day it shrinks; it does not shrink it.
//   • A HEADING COULD BE IN THE WRONG PLACE IN THE FILE AND PASS. The chain is
//     read in VERSION order, not in file order, and the file's order is not
//     version order and never was — 0.393.0's block sits between 0.382.0's and
//     0.391.0's. Nothing here asks the paragraphs to be sorted.
