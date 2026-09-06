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
 * after it (155 / 129 / 180). D460 MOVED THEM AGAIN — 152 / 126 / 176 (the
 * COIN-COUNT THRESHOLD, 3 sentences / 4 printings, `censusAttackCorpus.ts` file
 * lines 213, 214 and 228). 🆕🆕 **D461 MOVES THEM TO 150 / 124 / 172** (the SCOPED
 * BOARD HEAL, 2 sentences / 4 printings, `censusAttackCorpus.ts` file lines 273 and
 * 274 — *"Heal 100 damage from each of your {Basic|Benched} Pokémon."*, the two
 * `PHRASE-1` rows this instrument's own class table pointed at).
 * ⚠️ **D460 WAS THIS INSTRUMENT'S FIRST USE AS A TARGET RATHER THAN AS A PRODUCT,
 * AND THE RELATION HELD**: the three rows it classified `COMPOUND-head` are exactly
 * the three that left, `COMPOUND-head` fell 13 → 10 sentences and 16 → 12
 * printings, and the three pinned literals still agree with `censusAtHead.test.ts`
 * to the digit.
 * 🆕🆕 **D463 MOVES THEM TO 147 / 121 / 168** (THE PER-HEADS ENERGY DISCARD, 2 sentences /
 * 2 printings, `censusAttackCorpus.ts` file lines 200 and 234 — *"Flip {2 coins|a coin
 * until you get tails}. For each heads, discard an Energy from your opponent's Active
 * Pokémon."*).
 * ⚠️ **AND THE LINE ABOVE WAS STALE BY ONE SLICE WHEN D463 READ IT.** D462 moved the three
 * literals to **149 / 123 / 170** and did not say so here, so this block read as though
 * D461 were HEAD for a whole slice. It is a doc figure with no test behind it, which is
 * exactly the class D425 is about; recorded rather than silently corrected, because the
 * interesting fact is that the rot is one slice deep every time and nothing reddens.
 * 🆕🆕 **D465 MOVES THEM TO 145 / 119 / 165** (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS,
 * 1 sentence / 1 printing, `censusAttackCorpus.ts` file line 500 — *"This Pokémon also does
 * 10 damage to itself for each damage counter on it."*). ⚠️ **AND THE RELATION IS NOW A
 * COMMAND RATHER THAN THIS PARAGRAPH.** `scripts/residue-census-gate.ts` §A reads the three
 * literals OUT OF `censusAtHead.test.ts`'s SOURCE and compares them with this script's own
 * three figures, so the rot recorded two paragraphs down — one slice deep, four times, with
 * nothing reddening — can no longer happen silently. The gate holds no number of its own.
 * 🆕🆕 **D464 MOVES THEM TO 146 / 120 / 166** (THE FLIP-GATED STATUS THAT ALSO STRIPS AN
 * ENERGY, 1 sentence / 2 printings, `censusAttackCorpus.ts` file line 264 — *"Flip a coin.
 * If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that
 * Pokémon."*).
 * ✅🆕🆕 **D465 FIXED THE SPAN PROBE'S TERMINAL-PUNCTUATION BLIND SPOT, AND THE FIVE ROWS
 * D464 NAMED ARE EXACTLY THE FIVE THAT MOVED.** `keptAfterDeletion` now offers a SECOND
 * candidate remainder when — and only when — the deleted span reaches the last token: the
 * dangling clause separator (`,` `;` `:`) is dropped and the sentence's own terminator is
 * re-attached, unless the remainder already ends in one. ⚠️ **IT IS A WIDENING, NOT A
 * REPLACEMENT**: the unrepaired join is still asked first, so no span this probe used to
 * reach can be lost — MEASURED, not argued, by diffing the whole printed report before and
 * after (all 29 pre-existing `SPAN` evidence lines are byte-identical; the only new output
 * is five rows and their five `[TAIL REPAIR]` lines).
 * **THE CLASS TABLE, BEFORE → AFTER, AT D465's HEAD BEFORE ANYTHING WAS BUILT:** `OPAQUE`
 * **86/123 → 81/116**, `PHRASE-6` 0/0 → **2/2**, `PHRASE-15` 0/0 → **1/1**, `PHRASE-16`
 * 0/0 → **1/1**, `PHRASE-18` 0/0 → **1/3**. **NOTHING ELSE MOVED**, and the residue itself
 * did not move at all (120 / 166 both sides) — `builds()` is untouched, so the three pinned
 * literals still agreed to the digit across the fix. The five rows, by corpus FILE LINE:
 * **126** `OPAQUE`→`PHRASE-15`, **129** →`PHRASE-16`, **143** →`PHRASE-6`,
 * **412** →`PHRASE-18`, **500** →`PHRASE-6`. **D465 THEN BUILT 500**, which is why
 * `PHRASE-6` reads 1/1 at head and `OPAQUE` did NOT move for the build — a class is a
 * statement about the INSTRUMENT's reach, and the instrument changed in the same slice.
 * ⚠️ **WHAT IS STILL BLIND**: a sentence whose last character is `)` — a parenthetical
 * rider — has no terminator to re-attach and gets none. Asserted as a REFUSAL in
 * `scripts/residue-census-gate.ts` §B ⑤, because a blind spot that is only written down is
 * a claim (D212).
 * 🛑🛑 **THE BLIND SPOT AS D464 FOUND IT, KEPT FOR THE RECORD.** `spanProbe` tokenises with `text.split(" ")` and rejoins with `" "`, so
 * a deletion that reaches the LAST token takes the sentence-final period with it and the
 * remainder can never build. Corpus line 264 is one such row: deleting *"and discard an
 * Energy from that Pokémon."* leaves a built string ONLY if the `.` is re-attached, which
 * this probe cannot do. **Measured over the residue at D464's head: a tail-aware span probe
 * — same deletion, terminal punctuation re-attached — reaches 18 sentences / 24 printings,
 * of which SIX (9 printings) are rows this instrument classified `OPAQUE` — enumerated in
 * full rather than summarised (D428), by corpus FILE LINE: **126** (1p, *"Discard the top 3
 * cards of your deck, and this attack does 80 damage for each Energy card you discarded in
 * this way."*), **129** (1p, the Misty's twin), **143** (1p, *"Draw 3 cards from the bottom
 * of your deck."* — one deletion from D43's `drawCards`), **264** (2p, THIS SLICE's row),
 * **412** (3p, *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G}
 * Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*) and
 * **500** (1p, *"This Pokémon also does 10 damage to itself for each damage counter on
 * it."*). The other twelve the SEGMENT probe already reaches, so they are already
 * classified. With line 264 built, FIVE rows / 7 printings of that set remain. **So `OPAQUE`
 * was over-populated by six rows for a purely mechanical reason, and the fix is one
 * `if` in `spanProbe` — deliberately NOT made here, because changing the instrument in the
 * same slice that uses it to pick a target would leave nothing to check the pick against.
 * It is the next slice's cheapest instrument work, and the six rows are its own test.**
 * ✅ **D465 PAID IT, AND D464's TWO FIGURES BOTH REPRODUCED EXACTLY.** At D465's head the
 * tail-aware probe reaches **17 sentences / 22 printings** — D464 measured 18 / 24 with line
 * 264 still in the residue, and `18 − 1 = 17`, `24 − 2 = 22`. Of those 17, **12 are already
 * reached by the SEGMENT probe** (D464's "the other twelve") and **5 / 7 printings are
 * reachable ONLY with the repair** — the five it named, to the row. ⚠️ **THE FIX IS NOT ONE
 * `if`**: the period alone is not enough, because two of the five leave a dangling comma.
 * D464's estimate of the SIZE was wrong in the cheap direction while both of its MEASUREMENTS
 * were exact, which is the ordinary shape — a measurement survives a slice, a guess does not.
 * 🛑 **D463 IS THE FIRST SLICE IN FOUR TO MOVE `OPAQUE` — 88/126 → 87/125. D464 IS THE
 * SECOND, 87/125 → 86/123.** Line 234 was
 * classified `OPAQUE` and line 200 `SUBST-7`, and the two are ONE shape reached by two
 * shipped `AttackFlipCount` members. **`OPAQUE` is a statement about how far THIS
 * INSTRUMENT can edit a sentence before it reaches a built string, and not a statement
 * about how much work the sentence is.** A row can be `OPAQUE` and cost one regex; the
 * class table's own `SUBST-7` row named the twin of this one at one substitution, which is
 * how the pair was found at all. Read `OPAQUE` as UNCLASSIFIED, never as EXPENSIVE.
 * 🆕🆕 **D461 IS THE SECOND, AND IT IS THE SHARPER TEST OF THE TWO** — because a
 * `PHRASE-1` row is the class this instrument is MOST LIKELY TO UNDERPRICE. Its
 * evidence for the class is that deleting ONE token reaches a built string, which
 * says WHERE the blocker is and says nothing about what the derived value LOSES.
 * Here it lost the whole subject of the sentence in both rows — dropping `Basic`
 * heals every evolved body, dropping `Benched` heals the attacker — so the slice
 * cost an anchor, a map, a deriver arm, two op fields, two fixtures and an
 * interpreter diff, against a class whose name says "one token". `PHRASE-1` fell
 * **9 → 7 sentences and 13 → 9 printings**, the two rows it named are exactly the
 * two that left, and the three pinned literals still agree to the digit. **READ A
 * CLASS AS A LOWER BOUND ON THE WORK, NEVER AS AN ESTIMATE OF IT.** **If they ever disagree, one of the two
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
export function builds(text: string): boolean {
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

type SpanHit = {
  span: string;
  at: number;
  len: number;
  ties: number;
  kept: string;
  repaired: boolean;
};

/** 🆕 D465 — THE TAIL REPAIR. `spanProbe` tokenises on `" "` and rejoins on
    `" "`, so a deletion that reaches the LAST token takes the sentence-final
    period with it and the remainder can never build: no corpus sentence ends
    without its terminator. D464 measured the cost of that and did not pay it —
    SIX residue rows / 9 printings sat in `OPAQUE` for this purely mechanical
    reason. The repair, applied ONLY when the deleted span reaches the last
    token: drop a dangling clause separator (`,` `;` `:`) off the remainder,
    then re-attach the original sentence terminator unless the remainder already
    ends in one. ⚠️ IT IS A WIDENING, NOT A REPLACEMENT — the unrepaired join is
    still asked, so no span this probe used to reach can be lost. ⚠️ AND IT IS
    STILL BLIND to a sentence whose last character is `)` (a parenthetical
    rider), because there is no terminator to re-attach. */
export const TERMINATOR = /[.!?]$/;
export function keptAfterDeletion(text: string, tok: readonly string[], i: number, len: number): string[] {
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
      best = { from: a.slice(p, p + fromLen).join(" "), to: b.slice(p, p + toLen).join(" "), onto: b0, size };
    }
  }
  return best;
}

// ─── 5. RUN ──────────────────────────────────────────────────────────────────
const corpus = legalAttackCorpus();
const residue: (readonly [number, string])[] = [];
// ⚠️ The pair type is LOAD-BEARING, not decoration (D481): inferred as
// `number[]`, every read below is `number | undefined` under
// `noUncheckedIndexedAccess` and the `?? 0` at the print site is doing work
// it should never have had to do. A fixed-length tuple is exempt from that
// rule, so `[sentences, printings]` is stated once here instead.
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
const builtSentences = corpus.filter(([, t]) => builds(t)).map(([, t]) => t);

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
// ⚠️ `NEEDLE !== null` IS REDUNDANT AT RUNTIME AND REQUIRED FOR THE TYPES
// (D481). The branch above already consumed the `NEEDLE === null` case, so
// this clause can never be false where it is reached — but TypeScript does
// not narrow through the NEGATION of a conjunction, so without it `NEEDLE`
// stays `string | null` and both `.includes(NEEDLE)` calls below are
// errors. Stating the case the branch is FOR is cheaper than re-nesting it.
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
    console.log(`${pad}  CUT   ${r.seg.cutBuilds ? `✅ builds (${arm(r.seg.cut)})` : "🛑 does NOT build"}: ${r.seg.cut}`);
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
    // D465: a repaired remainder is NOT the sentence minus the span — the
    // terminator moved — so it is printed rather than left to be reconstructed.
    if (r.span.repaired) console.log(`${pad}      KEPT  ${r.span.kept}`);
    if (r.seg === null) console.log(`${pad}      ${derivation(r.span.kept)}`);
  }
  if (r.seg === null && r.sub === null && r.span === null) {
    console.log(`${pad}no deletion and no substitution this instrument can make reaches a built string.`);
  }
}
