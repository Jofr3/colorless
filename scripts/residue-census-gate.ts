#!/usr/bin/env bun
/**
 * Gate for `scripts/residue-census.ts`, which otherwise has no test behind it. Run with `bun
 * scripts/residue-census-gate.ts`.
 */

import { readFileSync } from "node:fs";
import { legalAttackCorpus, resolvedByAnyReader } from "../packages/engine/src/censusAttackCorpus";
import { arm, builds, builtSentences, keptAfterDeletion, rows } from "./residue-census";

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
// `builds()` and `arm()` carry the same predicate by transcription, so check that they partition
// the corpus: the built and residue sets must be disjoint and together cover every sentence,
// compared per sentence so a drift names its row.
const builtSet = new Set(builtSentences);
const residueSet = new Set(rows.map((r) => r.text));
check(
  "§A builds() and arm() partition the population: builtSentences + rows === corpus",
  builtSentences.length + rows.length === corpus.length,
  `${builtSentences.length} built + ${rows.length} residue ≠ ${corpus.length} corpus sentences`,
);
const disagree = corpus.filter(([, t]) => builds(t) !== (arm(t) !== null)).map(([, t]) => t);
check(
  "§A builds() and arm() are the same predicate, sentence by sentence",
  disagree.length === 0,
  `${disagree.length} sentence(s) where builds() and arm() disagree; first: «${disagree[0] ?? "—"}»`,
);
const inBoth = corpus.filter(([, t]) => builtSet.has(t) && residueSet.has(t)).map(([, t]) => t);
const inNeither = corpus
  .filter(([, t]) => !builtSet.has(t) && !residueSet.has(t))
  .map(([, t]) => t);
check(
  "§A every corpus sentence is in exactly ONE of builtSentences / rows (both directions)",
  inBoth.length === 0 && inNeither.length === 0,
  `${inBoth.length} in both, ${inNeither.length} in neither; first: «${inBoth[0] ?? inNeither[0] ?? "—"}»`,
);

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
  [
    "③ an already-terminated remainder is not re-terminated",
    candidates(B_PLAIN_FIRST, 3, 8),
    false,
  ],
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
// Vacuous-safe: the residue can be empty, and progress must not turn this check red. The same span
// loop is covered independently by the fixed literal list below.
check(
  "§C the repair never fired at all — it is dead code",
  rows.length === 0 || offered > 0,
  `0 repaired candidates over ${spans} spans in ${rows.length} residue sentences`,
);

// The span loop again, over pinned literal sentences that no slice can build away, so this check
// does not depend on the residue population.
const C_PRIME_TEXTS: readonly string[] = [
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
  "Discard the top 3 cards of your deck, and this attack does 80 damage.",
];
let offeredPrime = 0;
let spansPrime = 0;
const strayPrime: string[] = [];
for (const text of C_PRIME_TEXTS) {
  const tok = text.split(" ");
  for (let len = 1; len < tok.length; len++) {
    for (let i = 0; i + len <= tok.length; i++) {
      spansPrime++;
      const got = keptAfterDeletion(text, tok, i, len);
      const isTail = i + len === tok.length && i > 0;
      if (got.length > 1) offeredPrime++;
      if (got.length > 1 && !isTail) strayPrime.push(`«${text}» at ${i} len ${len}`);
      if (got[0] !== [...tok.slice(0, i), ...tok.slice(i + len)].join(" ")) {
        strayPrime.push(`PLAIN CANDIDATE MOVED: «${text}» at ${i} len ${len}`);
      }
    }
  }
}
check(
  "§C′ the repair fired on a span that does not reach the last token (fixed literal list)",
  strayPrime.length === 0,
  `${strayPrime.length} stray offer(s) over ${spansPrime} spans; first: ${strayPrime[0] ?? "—"}`,
);
check(
  "§C′ the repair never fired at all over the fixed literal list — it is dead code",
  offeredPrime > 0,
  `0 repaired candidates over ${spansPrime} spans in ${C_PRIME_TEXTS.length} pinned sentences`,
);

// ─── VERDICT ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`residue-census-gate: ${failures.length} claim(s) FAILED\n`);
  for (const f of failures) console.error(`  🛑 ${f}\n`);
  process.exit(1);
}
console.log(
  `residue-census-gate: OK — §A three pinned literals agree (${measured.raw} / ${measured.residue} / ${measured.printings}) and builds()/arm() partition ${corpus.length} sentences as ${builtSentences.length} + ${rows.length}, §B ${B_CASES.length + 2} tail-repair claims hold, §C ${offered} repaired candidate(s) over ${spans} spans in ${rows.length} residue sentences, none outside a tail span; §C′ ${offeredPrime} repaired candidate(s) over ${spansPrime} spans in ${C_PRIME_TEXTS.length} pinned sentences, none outside a tail span.`,
);
