import { describe, expect, it } from "vitest";

// D504 — THE TRANSCRIPTION GUARD. THE ARCHIVE QUOTES THE MUTATION HARNESS'S
// SUMMARY LINE 474 TIMES AND NOTHING HAS EVER COMPARED A QUOTE TO THE THING
// BEING QUOTED.
//
// `scripts/mutation/run.ts` prints one line per run:
//
//   <n> killed · <n> known survivor(s) · <n> GAP(S) · <n> stale ·
//   <n> skipped(dirty) · <n> clobber(s) · <n> error(s) · <n>s total
//
// The token is `GAP(S)`, capital S, and has been since D211's first commit —
// `git log -S 'GAP(s) ·' -- scripts/mutation/run.ts` is empty, i.e. the
// lowercase form has never existed in the harness. Yet at D503's close-out the
// archive quoted it lowercase 311 times in `progress.md` and 144 times in
// `decisions.md`, spanning EVERY `"EXACTLY AS PREDICTED: <line>"` stamp on
// record — 64 consecutive slices that committed a prediction, hit it, and then
// wrote down a string the run had never emitted.
//
// 🛑 THE NUMBERS WERE RIGHT EVERY TIME. THE VERBATIM CLAIM WAS NOT. That is the
// whole finding: a stamp that says *"exactly as predicted"* and then presents a
// string as the run's output is checkable ONLY if the string is the run's
// output. Nothing was looking — no mutant row quotes the token, no gate parses
// the summary line, no test compares a recorded prediction to an emitted one.
// D496–D498's blind spot one level up: a sweep proves every row that EXISTS was
// killed; nothing proved the sentence DESCRIBING the sweep was accurate.
//
// 🛑 SO WHAT GOES RED HERE, STATED FIRST (D200 → D214's rule — a check whose
// author cannot name the edit that breaks it is vacuous):
//
//   (1) write `0 GAP(s)` — or `6 ERROR(s)`, or `13 KILLED` — into a recorded
//       summary line in `progress.md`, `decisions.md` or `conventions.md` → the
//       QUOTE case fails, naming the file, the line, the token the harness
//       spells and the token the page spells;
//   (2) elide a field and then misspell a LATER one (`… · 0 stale · 0
//       clobber(s) · 6 ERROR(s) · …`, with `skipped(dirty)` dropped out of the
//       middle) → the same case still fails, because the walk skips ahead over
//       an elided field instead of stopping. Four of the six defects this guard
//       found beyond D503's census sat behind exactly that elision;
//   (3) 🛑 CHANGE THE TOKEN IN `run.ts` — `GAP(S)` → `GAP(s)`, `killed` →
//       `Killed` — and the archive stops agreeing with the harness, so the QUOTE
//       case fails on every recorded line at once. THIS IS THE POINT OF THE
//       WHOLE FILE. Every expected token below is PARSED OUT OF `run.ts`'s own
//       template literal at test time. A guard holding a hard-coded copy of the
//       token list inherits exactly the defect it exists to catch: the copy and
//       the harness drift apart in silence and the guard reports green forever.
//       There is no second copy here to drift;
//   (4) rename the template's FIRST TWO fields in `run.ts` (`known survivor(s)`
//       → `known survivors`) → no recorded line is recognised at all and the
//       FLOOR case fails, rather than the file passing on an empty scan;
//   (5) delete or rename the template in `run.ts`, or change its shape so the
//       `${…}` slots no longer bracket seven labels → the PARSE case fails
//       before any document is read, rather than passing vacuously on zero
//       derived tokens;
//   (6) add a SIXTH place that spells the token lowercase in prose → the CENSUS
//       case fails, because the five deliberate meta-mentions are carried by two
//       narrow, named context patterns and nothing else is excused;
//   (7) delete one of those five meta-mentions, or reword it so its context
//       pattern no longer matches → the same CENSUS case fails from the other
//       side, naming which exemption went unused (D150's totality rule);
//   (8) bulk-replace the archive's summary lines out of existence (a
//       range-delete, a `sed` that eats the blockquotes) → the anti-vacuity
//       floors fail, naming how many recorded lines were found.
//
// ⚠️ HOW A RECORDED LINE IS ALLOWED TO DIFFER FROM AN EMITTED ONE. These are
// prose quotations, not byte copies, and the following variance is LEGITIMATE —
// it is normalised away below rather than reported:
//   • thousands separators — the page writes `2,436 killed` and `10,490.6s`
//     where the harness writes `2436 killed` and `10490.6s`;
//   • the trailing ` total` is frequently dropped;
//   • the line wraps across markdown lines, often re-opening with a `> `
//     blockquote prefix mid-token-group, and the surrounding `**`/`` ` ``
//     emphasis opens and closes across that wrap;
//   • `/` appears as the separator instead of `·` in at least one recorded line;
//   • the quotation is truncated early (one line stops after `stale`);
//   • `<n>` stands in for a count where the line is quoted as a TEMPLATE, which
//     is how `conventions.md` prints it.
// What may NOT differ is the token sequence itself.

/** The docs the guard reads, as text. A GLOB rather than `node:fs` for
    `progressLog.test.ts`'s reason, restated: this package has no `"types":
    ["node"]` in its tsconfig (it runs in a Worker and in the browser), and
    widening that to read one file would put Node globals in scope for the whole
    engine. Vite resolves the pattern relative to THIS file. */
const DOCS: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("../../../docs/*.md", { query: "?raw", import: "default", eager: true });

/** 🛑 THE SOURCE OF TRUTH, AND THE REASON THIS FILE IS NOT VACUOUS. The harness
    itself, as text — a separate glob because `run.ts` sits outside `docs/`. It
    is read as RAW BYTES, never imported: `run.ts` has a top-level `await
    main()` and importing it would run the mutation harness inside the suite. */
const HARNESS: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("../../../scripts/mutation/run.ts", { query: "?raw", import: "default", eager: true });

function fileAt(bag: Record<string, string>, key: string): string {
  const text = bag[key];
  if (text === undefined) {
    throw new Error(`${key} is not readable from the glob — keys: ${Object.keys(bag).join(", ")}`);
  }
  return text;
}

const RUN_TS = fileAt(HARNESS, "../../../scripts/mutation/run.ts");

/** The docs that quote the summary line. `conventions.md` is in scope because
    the D503 convention prints the template itself, and a convention that quotes
    the harness wrongly is the same defect with more authority. */
const SCANNED = ["progress.md", "decisions.md", "conventions.md"] as const;

// ─── (A) PARSE THE HARNESS ───────────────────────────────────────────────────

/** The summary template literal, lifted out of `run.ts` by its first slot.
    Anchored on `${killed.length} killed` rather than on the word "summary",
    because the anchor has to be part of the thing being quoted: if the template
    moves, this finds it; if the template's first field is renamed, this finds
    NOTHING and the parse case below says so. The body holds no nested backtick,
    so `[^`]*` reaches the closing one. */
const TEMPLATE_MATCH = /`\$\{killed\.length\} killed[^`]*`/.exec(RUN_TS);
const TEMPLATE = TEMPLATE_MATCH === null ? "" : TEMPLATE_MATCH[0].slice(1, -1);

/** The literal text between the `${…}` slots. For today's template that is
    `["", " killed · ", " known survivor(s) · ", " GAP(S) · ", " stale · ",
    " skipped(dirty) · ", " clobber(s) · ", " error(s) · ", "s total\\n"]` — but
    nothing below assumes those values, only that shape. */
const CHUNKS = TEMPLATE.split(/\$\{[^}]*\}/);

/** The field labels, in order, spelled exactly as the harness spells them: each
    interior chunk minus its trailing separator. THE ONLY DEFINITION OF
    "CORRECT" IN THIS FILE, and it is derived, not transcribed. */
const LABELS: string[] = CHUNKS.slice(1, -1).map((c) => c.replace(/\s*\S\s*$/, "").trim());

/** The separator the harness puts between fields, also derived — the lone
    non-space character at the end of the first interior chunk. */
const SEPARATOR = /\s(\S)\s*$/.exec(CHUNKS[1] ?? "")?.[1] ?? "";

/** The tail after the last slot — `s total\n` — i.e. the unit glued to the
    elapsed time. Recorded lines drop the ` total` freely, so only the `s` is
    load-bearing and only the parse case looks at it. */
const TAIL = CHUNKS[CHUNKS.length - 1] ?? "";

/** The labels the harness SHOUTS. A token the harness spells with a capital is
    one ordinary prose cannot produce by accident, so every appearance of any
    casing of it anywhere in the scanned docs is a quotation of the harness and
    must be spelled the harness's way. Derived, so that capitalising a second
    field in `run.ts` widens the census automatically. Today: `["GAP(S)"]`. */
const LOUD = LABELS.filter((l) => /[A-Z]/.test(l));

// ─── (B) NORMALISE A MARKDOWN PAGE INTO SOMETHING A LINE CAN BE FOUND IN ─────

interface Flat {
  /** The page with wraps, blockquote prefixes and emphasis removed. */
  text: string;
  /** `line[i]` is the 1-based source line `text[i]` came from. */
  line: number[];
}

/** Collapse a markdown page so a quotation that wraps is still one string:
    every newline (plus the next line's indent and any `>` blockquote markers)
    becomes a single space, and `*`/`` ` `` are dropped wherever they appear.
    The per-character line map is kept so a violation can still name its line. */
function flatten(source: string): Flat {
  const out: string[] = [];
  const line: number[] = [];
  let n = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") {
      n += 1;
      i += 1;
      while (i < source.length) {
        const p = source[i];
        if (p !== " " && p !== "\t" && p !== ">") break;
        i += 1;
      }
      out.push(" ");
      line.push(n);
      continue;
    }
    if (ch === "*" || ch === "`") {
      i += 1;
      continue;
    }
    out.push(ch ?? "");
    line.push(n);
    i += 1;
  }
  return { text: out.join(""), line };
}

const FLAT: Record<string, Flat> = {};
for (const name of SCANNED) {
  FLAT[name] = flatten(fileAt(DOCS, `../../../docs/${name}`));
}

function flatOf(name: string): Flat {
  const f = FLAT[name];
  if (f === undefined) throw new Error(`no flattened text for docs/${name}`);
  return f;
}

function lineAt(f: Flat, offset: number): number {
  return f.line[Math.min(offset, f.line.length - 1)] ?? 0;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A count as a recorded line may spell it: digits with optional thousands
    separators and an optional fraction, or the literal `<n>` a template uses. */
const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?|<n>)`;
/** The separator as recorded: the harness's own, or `/`, which one recorded
    line uses. Derived for the first alternative so a change in `run.ts` is felt
    here too. */
const SEP = `\\s*[${escapeRe(SEPARATOR)}/]\\s*`;

// ─── (C) FIND THE RECORDED LINES ─────────────────────────────────────────────

/** A candidate recorded line is a run of text that names the harness's FIRST
    TWO labels in order, case-insensitively.
    ⚠️ TWO, NOT ONE, AND THIS IS LOAD-BEARING. `<n> killed` alone is ordinary
    house prose — the page writes `13 KILLED` ~250 times as a shorthand for a
    probe's verdict, and an anchor on one label would drag all of them in. Two
    labels in the current template's own spelling is what distinguishes a
    QUOTATION OF THIS HARNESS from a paraphrase; it is also what keeps the
    paren-less family (`302 killed / 8 known survivors / 0 gaps / …`, 243 lines
    of it) out of scope, since `known survivors` is not `known survivor(s)`.
    ⚠️ THOSE ARE PARAPHRASES, NOT AN OLDER HARNESS FORMAT — `run.ts` has spelled
    `known survivor(s)` that way since D211's first commit and has never printed
    `known survivors`. They were not emitted either; they are simply not
    adjudicable by this guard, which is said again in the closing note. */
const CANDIDATE = new RegExp(
  `${NUM}\\s+${escapeRe(LABELS[0] ?? " ")}${SEP}${NUM}\\s+${escapeRe(LABELS[1] ?? " ")}`,
  "gi",
);

interface Finding {
  where: string;
  want: string;
  got: string;
  quote: string;
}

interface Scan {
  candidates: number;
  findings: Finding[];
}

/** Walk one recorded line field by field and report every field it spells with
    the wrong capitals.

    ⚠️ FIELDS MAY BE ELIDED, AND THE WALK SKIPS AHEAD RATHER THAN STOPPING. Some
    forty archived stamps drop `<n> skipped(dirty)` out of the middle of the
    line. Stopping at the first non-match would make every field AFTER the
    elision unguarded — which is not hypothetical: four `ERROR(s)` misspellings
    sit past an elided field. So at each position the walk tries this label and
    every later one, takes the first that matches case-insensitively, and holds
    the harness's ORDER by never going backwards. */
function scan(name: string): Scan {
  const f = flatOf(name);
  const findings: Finding[] = [];
  let candidates = 0;
  CANDIDATE.lastIndex = 0;
  for (const anchor of f.text.matchAll(CANDIDATE)) {
    const start = anchor.index;
    candidates += 1;
    let pos = start;
    let k = 0;
    while (k < LABELS.length) {
      let advanced = false;
      for (let j = k; j < LABELS.length; j += 1) {
        const label = LABELS[j] ?? "";
        const step = new RegExp(`^(?:${j === 0 ? "" : SEP})(${NUM})\\s+(${escapeRe(label)})`, "i");
        const m = step.exec(f.text.slice(pos, pos + 160));
        if (m === null) continue;
        if (m[2] !== label) {
          // The token is there, spelled with different capitals. THIS IS D503's
          // DEFECT EXACTLY, and the only divergence that is unambiguously a
          // transcription error rather than a paraphrase — same letters, same
          // position, different shift key.
          findings.push({
            where: `docs/${name}:${lineAt(f, pos)}`,
            want: label,
            got: m[2] ?? "",
            quote: f.text.slice(start, start + 140),
          });
          k = LABELS.length;
          advanced = true;
          break;
        }
        pos += m[0].length;
        k = j + 1;
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
  }
  return { candidates, findings };
}

const SCANS: Record<string, Scan> = {};
for (const name of SCANNED) SCANS[name] = scan(name);

function scanOf(name: string): Scan {
  const s = SCANS[name];
  if (s === undefined) throw new Error(`no scan for docs/${name}`);
  return s;
}

const ALL_FINDINGS = SCANNED.flatMap((n) => scanOf(n).findings);
const ALL_CANDIDATES = SCANNED.reduce((a, n) => a + scanOf(n).candidates, 0);

function render(f: Finding): string {
  return `${f.where}  the harness prints ${JSON.stringify(f.want)}, the page writes ${JSON.stringify(f.got)}\n      … ${f.quote}`;
}

// ─── (D) THE FIVE DELIBERATE META-MENTIONS ───────────────────────────────────

/** 🛑 AN EXEMPTION IS A NAMED CONTEXT, NOT A LOOSE PATTERN. Five places in the
    archive spell the token lowercase ON PURPOSE, because the lowercase form is
    their SUBJECT — they are the sentences that record that it was never emitted.
    They are carried by the two phrasings they actually use, each with the count
    it is expected to account for, so that a SIXTH lowercase mention (a real
    regression) is not excused, and so that DELETING one of these five fails too.
    ⚠️ IF THE RITUAL ADDS A SIXTH DELIBERATE MENTION, raise the count here and
    say why — do not widen the pattern. */
interface Exemption {
  readonly name: string;
  readonly why: string;
  readonly re: RegExp;
  readonly expected: number;
}

const EXEMPTIONS: readonly Exemption[] = [
  {
    name: "the archaeology command",
    why: "`git log -S 'GAP(s) ·' -- scripts/mutation/run.ts` is the command that PROVES the lowercase form never existed. Its argument has to be the string being searched for. `docs/progress.md` and `docs/conventions.md` each print it once.",
    re: /git log -S '(GAP\(s\)) ·'/g,
    expected: 2,
  },
  {
    name: "the sentence that names the lowercase form as never-emitted",
    why: "“`GAP(s)` has never existed in `run.ts`” — the finding itself, stated in the header stamp and the resume point of `docs/progress.md` and in `docs/decisions.md`'s D503 row. The token is mentioned, not used.",
    re: /(GAP\(s\)) has (?:NEVER|never) existed in run\.ts/g,
    expected: 3,
  },
];

interface Mention {
  where: string;
  offset: number;
  got: string;
  context: string;
}

/** Every appearance, in any casing, of a label the harness SHOUTS. */
function mentionsOf(name: string, label: string): Mention[] {
  const f = flatOf(name);
  const re = new RegExp(escapeRe(label), "gi");
  return [...f.text.matchAll(re)].map((m) => ({
    where: `docs/${name}:${lineAt(f, m.index)}`,
    offset: m.index,
    got: m[0],
    context: f.text.slice(Math.max(0, m.index - 60), m.index + 60),
  }));
}

/** The offsets inside one page that an exemption forgives. */
function exemptOffsets(name: string, ex: Exemption): number[] {
  const f = flatOf(name);
  const re = new RegExp(ex.re.source, "g");
  const out: number[] = [];
  for (const m of f.text.matchAll(re)) {
    const token = m[1] ?? "";
    out.push(m.index + m[0].indexOf(token));
  }
  return out;
}

// ─── THE CASES ───────────────────────────────────────────────────────────────

describe("the archive quotes the mutation harness VERBATIM (D504)", () => {
  it("(5) parses a real template out of scripts/mutation/run.ts — anti-vacuity, first and explicitly", () => {
    // Every case below is satisfied by an empty label list, which is exactly what
    // a renamed or deleted template leaves behind.
    expect(RUN_TS.length, "scripts/mutation/run.ts read as an empty string").toBeGreaterThan(10_000);
    expect(
      TEMPLATE_MATCH,
      "no `${killed.length} killed …` template literal in scripts/mutation/run.ts — the summary line moved or was renamed, and every assertion in this file would otherwise pass on nothing",
    ).not.toBeNull();
    expect(
      LABELS.length,
      `parsed ${LABELS.length} field labels out of the template: ${JSON.stringify(LABELS)}`,
    ).toBe(7);
    for (const label of LABELS) {
      expect(label, `a parsed label is empty or still holds a \${…} slot: ${JSON.stringify(LABELS)}`).toMatch(
        /^[A-Za-z][A-Za-z()\s]*$/,
      );
    }
    expect(SEPARATOR, `no single-character field separator in ${JSON.stringify(CHUNKS[1])}`).toHaveLength(1);
    expect(TAIL.startsWith("s"), `the template's tail is ${JSON.stringify(TAIL)}, not the elapsed-time unit`).toBe(true);
    expect(
      LOUD.length,
      `no label in ${JSON.stringify(LABELS)} is spelled with a capital, so the census case below has nothing to look for`,
    ).toBeGreaterThan(0);
  });

  it("(4)+(8) finds the recorded summary lines at all — the floors a range-delete trips", () => {
    expect(DOCS["../../../docs/progress.md"]?.length ?? 0).toBeGreaterThan(100_000);
    expect(DOCS["../../../docs/decisions.md"]?.length ?? 0).toBeGreaterThan(10_000);
    // 474 recorded lines at D504: 326 in progress.md, 148 in decisions.md. The
    // floor is deliberately slack — it is here to catch the archive being EATEN,
    // not to pin a number the ritual moves every session.
    expect(
      ALL_CANDIDATES,
      `only ${ALL_CANDIDATES} recorded summary lines found across ${SCANNED.join(", ")} — the pages were truncated, or CANDIDATE stopped matching them`,
    ).toBeGreaterThan(400);
    expect(scanOf("progress.md").candidates).toBeGreaterThan(250);
    expect(scanOf("decisions.md").candidates).toBeGreaterThan(100);
  });

  it("(1)+(2)+(3) every recorded summary line spells its fields the way scripts/mutation/run.ts spells them", () => {
    // 🛑 THE CASE THE FILE EXISTS FOR. `LABELS` came out of `run.ts` above; the
    // pages are compared against THAT, so mutating the harness's token is felt
    // here, and no copy of the token list exists in this file to drift with it.
    const report = ALL_FINDINGS.map(render).join("\n  ");
    expect(
      ALL_FINDINGS.length,
      `${ALL_FINDINGS.length} recorded summary line(s) do not match the harness's own template.\n  Harness fields, parsed from scripts/mutation/run.ts: ${JSON.stringify(LABELS)}\n  ${report}`,
    ).toBe(0);
  });

  it("(6)+(7) the only lowercase spellings left are the five deliberate meta-mentions, each accounted for by name", () => {
    const offenders: Mention[] = [];
    const exempted = new Set<string>();
    let exemptTotal = 0;

    for (const label of LOUD) {
      for (const ex of EXEMPTIONS) {
        let seen = 0;
        for (const name of SCANNED) {
          for (const off of exemptOffsets(name, ex)) {
            exempted.add(`${name}@${off}`);
            seen += 1;
          }
        }
        exemptTotal += seen;
        expect(
          seen,
          `the exemption "${ex.name}" matched ${seen} place(s), not ${ex.expected}. UP means a new lowercase mention was written and must be justified here rather than absorbed; DOWN means one of the deliberate mentions was deleted or reworded. WHY IT IS EXEMPT: ${ex.why}`,
        ).toBe(ex.expected);
      }
      for (const name of SCANNED) {
        for (const m of mentionsOf(name, label)) {
          if (m.got === label) continue;
          if (exempted.has(`${name}@${m.offset}`)) continue;
          offenders.push(m);
        }
      }
    }

    expect(
      exemptTotal,
      `${exemptTotal} exempted meta-mentions, not 5 — the allowlist and the page have come apart`,
    ).toBe(5);
    expect(
      offenders.length,
      `${offenders.length} place(s) spell a harness token with the wrong capitals and are not one of the five deliberate meta-mentions:\n  ${offenders
        .map((m) => `${m.where}  ${JSON.stringify(m.got)} … ${m.context}`)
        .join("\n  ")}`,
    ).toBe(0);
  });
});

// ⚠️ AND THE THINGS THIS FILE DELIBERATELY DOES NOT DO — the honest limit of a
// structural guard over prose, named so the next reader does not read a green
// run as "the archive is true":
//
//   • IT DOES NOT CHECK THE NUMBERS. `9999 killed · 0 known survivor(s) · 0
//     GAP(S) · …` passes. Whether a recorded tally matches the run it claims to
//     describe is unknowable from the page alone — the log is not in the repo —
//     and D503's finding was precisely that the numbers were the RELIABLE half.
//   • IT DOES NOT CHECK THAT A RECORDED LINE WAS EVER EMITTED. A summary line
//     invented wholesale, with plausible counts and perfect spelling, passes.
//     This guard makes a recorded line byte-comparable to a future log; it
//     cannot perform that comparison for a run nobody kept.
//   • 🛑 IT ONLY SEES CASING — SAME LETTERS, WRONG SHIFT KEY — AND THAT IS A
//     DELIBERATE NARROWING, NOT AN OVERSIGHT. The archive also holds PARAPHRASES
//     of the line that were never emitted either: `0 GAP` for `0 GAP(S)`,
//     `1 CLOBBER` for `1 clobber(s)`, and a whole family spelled
//     `302 killed / 8 known survivors / 0 gaps / 0 clobbers / 0 errors`.
//     ⚠️ NONE OF THOSE IS AN OLDER HARNESS FORMAT — `git log -S` puts every
//     token of today's line in `run.ts` at D211 (`killed`, `known survivor(s)`,
//     `GAP(S)`, `stale`) or D215 (`skipped(dirty)`, `clobber(s)`), with no
//     intervening spelling; `clobbers ·`, `errors ·` and ` skipped · ` have
//     never existed in it. They are re-wordings, and the guard cannot tell a
//     re-wording from a quotation of a format it does not know. Casing is the
//     one divergence that is unambiguous. D504 repaired three such paraphrases
//     by hand (`docs/decisions.md`'s two `1 GAP`, and `docs/progress.md`'s
//     `0 GAP` beside its `13 KILLED`) and they stay UNGUARDED — a second
//     instance can be written tomorrow and nothing here will say so.
//   • IT ONLY SEES LINES THAT NAME THE FIRST TWO FIELDS. A quotation that starts
//     at `known survivor(s)`, or that paraphrases the first field away, is
//     invisible. That is the price of not dragging the page's ~250 `13 KILLED`
//     probe shorthands in as false positives, and it is a real hole.
//   • IT DOES NOT NOTICE AN ELIDED FIELD. Some forty archived stamps drop
//     `<n> skipped(dirty)` out of the middle of the line; the walk steps over
//     the hole so the fields after it stay guarded, and says nothing about the
//     hole itself. Restoring those would mean inventing a count no log holds.
