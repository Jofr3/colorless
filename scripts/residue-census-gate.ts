#!/usr/bin/env bun
/**
 * THE BLOCKER-CENSUS GATE (D465) — `bun scripts/residue-census-gate.ts`.
 *
 * WHY THIS EXISTS. `scripts/residue-census.ts` is a COMMITTED MEASUREMENT and it
 * had nothing behind it. Its own doc block says so twice — *"this file is the
 * one with no test behind it"* — and the price was paid twice over: the three
 * figures it transcribes from `censusAtHead.test.ts` rotted by exactly one slice
 * on four separate occasions and nothing reddened, and D464 found a whole
 * MECHANICAL BLIND SPOT in its span probe that had been over-populating `OPAQUE`
 * by six rows since D459. Both are the same defect this repo keeps rediscovering
 * (D212's own header names it): **a claim with nothing behind it.** So the
 * claims become a COMMAND, on D212's precedent — a script, not a suite, because
 * `scripts/**` is outside vitest's include globs and outside `tsc -b`'s project
 * references, so a `*.test.ts` that imported the instrument would break the
 * typecheck rather than guard anything.
 *
 * IT IS NOT A STEP OF `bun run check`. It is a mutation KILLER
 * (`killedByCommand`), exactly as `scripts/lint-coverage.ts` is for D212's rows
 * and `scripts/mutation/recovery-gate.ts` is for D411's. Exit 0 = every claim
 * holds; exit 1 = a named claim failed, with the measured value beside it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS — three sections, and each one is a claim the instrument's
 * doc block already MAKES in prose.
 *
 * § A — THE TRANSCRIPTION IS THE SAME OBJECT. `residue-census.ts`'s `raw`,
 *   residue sentences and residue printings must equal the three literals
 *   `censusAtHead.test.ts` pins in its `residueSentences` rung. ⚠️ THE LITERALS
 *   ARE PARSED OUT OF THE SUITE'S SOURCE, never copied here — a figure copied
 *   into a second file is the exact thing that rotted four times. So this
 *   section has no number of its own and cannot go stale; it can only ever say
 *   that the two computations disagree.
 *
 * § B — THE TAIL REPAIR, AS A PURE FUNCTION, ON LITERAL INPUTS. `spanProbe`
 *   tokenises on `" "` and rejoins on `" "`, so before D465 a deletion reaching
 *   the LAST token took the sentence-final period with it and the remainder
 *   could never build — no corpus sentence ends without its terminator. Each
 *   case below is one axis of `keptAfterDeletion`, and each is the killer of one
 *   mutation row. ⚠️ INCLUDING THE BLIND SPOT THAT REMAINS: a sentence whose
 *   last character is `)` has no terminator to re-attach and MUST NOT be given
 *   an invented one, so the refusal is pinned as tightly as the repair.
 *
 * § C — THE REPAIR IS CONFINED TO TAIL SPANS, TOTAL OVER THE RESIDUE. Every
 *   sentence, every span offset, every span length: a second candidate is
 *   offered if and only if the span reaches the last token and does not start at
 *   it. This is the one section that reads the corpus rather than a literal, and
 *   it is the section that catches a repair which fires EVERYWHERE — the
 *   mutation that would silently widen every other class in the table.
 *
 * ⚠️ WHAT IT DOES NOT ASSERT, STATED (D419/D455). It says nothing about which
 * CLASS any row lands in — a class list is exactly the pinned figure this file
 * refuses to hold, because building a row is supposed to move it. It says
 * nothing about whether `builds()` is the right predicate; that is
 * `censusAtHead.test.ts`'s job and § A only checks the two agree. And it says
 * nothing about the SEGMENT or SUBSTITUTION probes, which are unchanged by D465
 * and remain, as they were, untested.
 */

import { readFileSync } from "node:fs";
import { legalAttackCorpus, resolvedByAnyReader } from "../packages/engine/src/censusAttackCorpus";
import { keptAfterDeletion, rows } from "./residue-census";

const CENSUS = "packages/engine/src/censusAtHead.test.ts";
const failures: string[] = [];

function check(claim: string, ok: boolean, detail: string): void {
  if (ok) return;
  failures.push(`${claim}\n      ${detail}`);
}

/** Pull one pinned literal out of the suite's SOURCE. The literal is never
    copied into this file — see § A. A miss is a failure, not a default. */
function pinned(needle: string): number | null {
  const src = readFileSync(CENSUS, "utf8");
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const m = /^\s*(\d+)\s*\)/.exec(src.slice(at + needle.length));
  return m === null ? null : Number(m[1]);
}

// ─── § A. THE TRANSCRIPTION IS THE SAME OBJECT ───────────────────────────────
const corpus = legalAttackCorpus();
const measured = {
  raw: corpus.filter(([, t]) => !resolvedByAnyReader(t)).length,
  residue: rows.length,
  printings: rows.reduce((sum, r) => sum + r.units, 0),
};
const PINS: readonly (readonly [string, string, number])[] = [
  ["raw unbuilt sentences", "expect(rawUnbuiltSentences.length).toBe(", measured.raw],
  ["residue sentences", "expect(residueSentences.length).toBe(", measured.residue],
  ["residue printings", "expect(unbuiltAttack).toBe(", measured.printings],
];
for (const [label, needle, mine] of PINS) {
  const theirs = pinned(needle);
  check(
    `§A ${label}: the instrument and ${CENSUS} disagree`,
    theirs !== null && theirs === mine,
    theirs === null
      ? `could not find \`${needle}…)\` in the suite — the rung moved; re-transcribe`
      : `residue-census.ts says ${mine}, the suite pins ${theirs}`,
  );
}

// ─── § B. THE TAIL REPAIR, PURE, ON LITERAL INPUTS ───────────────────────────
/** `keptAfterDeletion(text, tok, i, len)` → the candidate remainders, plain
    first. One entry = no repair was offered; two = the plain join and the
    repaired one. */
function candidates(text: string, i: number, len: number): string[] {
  return keptAfterDeletion(text, text.split(" "), i, len);
}
const B_PLAIN_FIRST = "Flip a coin. If heads, this attack does 30 more damage.";
const B_CASES: readonly (readonly [string, string[], boolean])[] = [
  // ① THE DEFECT ITSELF. A deletion reaching the last token loses the period;
  //    the repair re-attaches it. `Draw 3 cards from the bottom of your deck.`
  //    minus its last six tokens is `Draw 3 cards` — which builds only as
  //    `Draw 3 cards.` (corpus FILE LINE 143, `OPAQUE` for six slices).
  [
    "① terminator re-attached to a bare remainder",
    candidates("Draw 3 cards from the bottom of your deck.", 3, 6),
    true,
  ],
  // ② A DANGLING CLAUSE SEPARATOR IS DROPPED. Corpus FILE LINE 126 leaves
  //    `Discard the top 3 cards of your deck,` — a comma no printed sentence
  //    ends on. Without the strip, ① is not enough and the row stays `OPAQUE`.
  [
    "② dangling comma dropped before the terminator",
    candidates("Discard the top 3 cards of your deck, and this attack does 80 damage.", 8, 6),
    true,
  ],
  // ③ NO DOUBLE TERMINATOR. A remainder that already ends in `.` is left alone,
  //    or every multi-segment sentence gets `..` and loses a hit it used to have.
  //    Here the tail-span branch IS entered and correctly declines: the repair
  //    is offered only when it would CHANGE the remainder.
  ["③ an already-terminated remainder is not re-terminated", candidates(B_PLAIN_FIRST, 3, 8), false],
  // ④ THE REPAIR IS NOT OFFERED ON AN INTERIOR SPAN.
  ["④ an interior deletion gets no second candidate", candidates(B_PLAIN_FIRST, 0, 3), false],
  // ⑤ THE BLIND SPOT THAT REMAINS, PINNED. A `)`-terminated sentence — a
  //    parenthetical rider — has NO terminator to re-attach, and inventing one
  //    would be a widening nobody measured. Stated in the doc block; asserted here.
  [
    "⑤ a `)`-terminated sentence is left alone (the remaining blind spot)",
    candidates(
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      11,
      9,
    ),
    false,
  ],
];
for (const [label, got, wantRepair] of B_CASES) {
  check(
    `§B ${label}`,
    got.length === (wantRepair ? 2 : 1),
    `expected ${wantRepair ? "a repaired second candidate" : "no repair"}, got ${JSON.stringify(got)}`,
  );
}
// The two named remainders, spelled out — a length check alone passes on a
// repair that produces the wrong string.
check(
  "§B ① produces the built twin exactly",
  candidates("Draw 3 cards from the bottom of your deck.", 3, 6)[1] === "Draw 3 cards.",
  JSON.stringify(candidates("Draw 3 cards from the bottom of your deck.", 3, 6)),
);
check(
  "§B ② produces the built twin exactly",
  candidates("Discard the top 3 cards of your deck, and this attack does 80 damage.", 8, 6)[1] ===
    "Discard the top 3 cards of your deck.",
  JSON.stringify(
    candidates("Discard the top 3 cards of your deck, and this attack does 80 damage.", 8, 6),
  ),
);

// ─── § C. CONFINED TO TAIL SPANS — TOTAL OVER THE RESIDUE ────────────────────
let offered = 0;
let spans = 0;
const stray: string[] = [];
for (const r of rows) {
  const tok = r.text.split(" ");
  for (let len = 1; len < tok.length; len++) {
    for (let i = 0; i + len <= tok.length; i++) {
      spans++;
      const got = keptAfterDeletion(r.text, tok, i, len);
      const isTail = i + len === tok.length && i > 0;
      if (got.length > 1) offered++;
      if (got.length > 1 && !isTail) stray.push(`«${r.text}» at ${i} len ${len}`);
      if (got[0] !== [...tok.slice(0, i), ...tok.slice(i + len)].join(" ")) {
        stray.push(`PLAIN CANDIDATE MOVED: «${r.text}» at ${i} len ${len}`);
      }
    }
  }
}
check(
  "§C the repair fired on a span that does not reach the last token",
  stray.length === 0,
  `${stray.length} stray offer(s) over ${spans} spans; first: ${stray[0] ?? "—"}`,
);
check(
  "§C the repair never fired at all — it is dead code",
  offered > 0,
  `0 repaired candidates over ${spans} spans in ${rows.length} residue sentences`,
);

// ─── VERDICT ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`residue-census-gate: ${failures.length} claim(s) FAILED\n`);
  for (const f of failures) console.error(`  🛑 ${f}\n`);
  process.exit(1);
}
console.log(
  `residue-census-gate: OK — §A three pinned literals agree (${measured.raw} / ${measured.residue} / ${measured.printings}), §B ${B_CASES.length + 2} tail-repair claims hold, §C ${offered} repaired candidate(s) over ${spans} spans in ${rows.length} residue sentences, none outside a tail span.`,
);
