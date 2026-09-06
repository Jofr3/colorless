// D480 — THE BUILD-STATE CLAIM, DECLARED AS DATA.
//
// TEST-ONLY: not exported from the package index, exactly like `testFixtures.ts`
// and `catalogManifest.ts`. Nothing at runtime reads this file.
//
// 🛑 WHY THIS FILE EXISTS, AND THE KILLER IS FOUR OCCURRENCES OVER 150 DECISIONS.
// A refusal in this repo carries TWO separable claims: *"this sentence cannot be
// expressed"* and *"this printing is not built"*. The first is settled by opening
// a declaration and has been audited that way since D479. The second was only ever
// settled by PROSE, and it has been wrong four times:
//
//   • **D330** — priced a row that had already shipped, and wrote the rule:
//     *"check whether the piece has shipped before pricing it."*
//   • **D343** — hit it again. index.ts 0.249.0: *"🛑 THE ROW WAS HANDED ON AS
//     UNBUILT AND THE PROGRAM WAS ALREADY IN THE REGISTRY. `const KOFU`, both
//     Standard ids, a `fix-kofu` demonstrator, a table row and two driven tests all
//     existed at `5827be3`."* It called itself *"D330's lesson at its second site"*.
//   • **D321** — turned the lesson into a procedure (*"a backlog row that names an
//     unbuilt card is a claim about the REGISTRY"*, checked with `git grep <id>`),
//     quoted in `koPrizeBonus.test.ts`'s header.
//   • **D479 → D480** — the fourth, and the sharpest, because it happened INSIDE a
//     refusal audit whose stated method was *"settled by opening the declaration it
//     names, never by reading the prose around it"*. D479 opened `BoardCondition`,
//     `GameState` and `playableIf` and was right about all three; it did not open
//     the id table, so it re-asserted the build-state half of the very paragraph it
//     was falsifying. Unfair Stamp `sv06-165` shipped at **D271** — the same
//     decision D479 named as the one that refuted the expressibility clause — and
//     Team Rocket's Archer `sv10-170`/`-223` at **D326**. D480 was commissioned to
//     hand-author two registry rows that had existed for 208 and 153 decisions.
//
// **Three prose rules, and the fourth occurrence still happened.** That is D465's
// bar for turning a rule into an instrument, so the claim is now a COMMAND —
// `lint-coverage.ts`'s move (D212: *"the only thing asserting the coverage was
// PROSE … So the claim is now a COMMAND"*) applied to build state.
//
// ⚠️ WHAT IT DOES NOT DO, NAMED FIRST (D200 → D214: a check whose author cannot
// name the edit that breaks it is vacuous; and `progressLog.test.ts`'s rule that a
// structural guard over prose owes its own limit out loud).
//
//   1. 🛑 **`programFor(id) === undefined` IS ONLY A VALID ORACLE FOR A REGISTRY
//      SURFACE, AND D204 ALREADY PROVED THE OTHER HALF VACUOUS.** index.ts 0.130.0:
//      *"All four N's Zoroark ex printings ALREADY carry a program (their 'Trade'
//      Ability); it is the ATTACK that is unbuilt. A whole-id flag reads that card
//      as built and drops it from the backlog silently — so this slice flags PER
//      SURFACE."* Every row here therefore records its `surface`, and every value of
//      `surface` is one `programFor` answers. **ATTACK printings have no row here at
//      all**: their oracle is the twelve derivers, and `residue-census.ts` owns it.
//   2. 🛑 **IT CANNOT TELL A REAL ID FROM A REAL ID BELONGING TO ANOTHER CARD.**
//      D204's other finding: *"SIX OF TEN FLAGGED ROWS CARRY IDS BELONGING TO OTHER
//      CARDS, so its 'every id asserted unbuilt' was a vacuous guard … Every COUNT
//      was right, which is why nothing caught it."* This engine has no catalog —
//      `catalogManifest.ts` covers six sets of twenty. What the suite CAN do, and
//      does, is require every row's `id` to appear inside its own `cite.excerpt`,
//      so a transposed id cannot be typed here without also being typed into the
//      prose it claims to quote, where it would no longer match.
//   3. It does not check that a refusal's REASON is true, only that its build-state
//      claim still is. A wrong reason beside a genuinely-unbuilt printing passes.
//      That is D479's REASON-ONLY class, and it is not this instrument's question.
//   4. It guards only DECLARED rows. A refusal written in prose and never brought
//      here is unguarded, exactly as before. The table is a ratchet, not a census —
//      see the provenance note on `REFUSED_PRINTINGS` for the measured population it
//      was seeded from and the honest gap.
//
// ⚠️ AND IT IS TOTAL IN BOTH DIRECTIONS, this repo's standing rule. `REFUSED_PRINTINGS`
// asserts *is not built*; `RESOLVED_REFUSALS` asserts *is built, and the doc block
// that used to deny it now carries the dated correction*. A revert of either side
// goes red, and neither can be satisfied by emptying the other.

/** The registry surfaces `programFor` is an oracle for. There is deliberately no
    `"attack"` member: an attack sentence is built by a DERIVER, not by a row, so
    `programFor` answers a different question about it (D204's per-surface rule). */
export type RefusalSurface = "trainer" | "tool" | "ability" | "passive" | "specialEnergy";

/** One printing whose REGISTRY-surface program is refused at HEAD, and the doc
    block that says so. */
export type RefusedPrinting = {
  /** The printed card id, exactly as the catalog spells it. */
  readonly id: string;
  /** The card, for the red line to be readable without a lookup. */
  readonly card: string;
  /** Which surface is refused — the oracle's scope (limit 1 above). */
  readonly surface: RefusalSurface;
  /** Why, in the vocabulary of the doc block cited below. */
  readonly why: string;
  /** The decision that recorded the refusal. */
  readonly since: string;
  /** Where the claim is written. `excerpt` must be a single line occurring
      EXACTLY ONCE in `file` and must itself name `id` — a line number rots
      silently, a unique string rots loudly (`mutants.ts`'s rule, borrowed). */
  readonly cite: { readonly file: string; readonly excerpt: string };
};

/** THE REFUSED SET — every row asserted UNBUILT ON ITS NAMED SURFACE at HEAD.
    Building any of these without deleting its row here reddens
    `refusedPrintings.test.ts` BY ID, and the row hands the builder the doc block
    to correct. That is the whole mechanism, and it is the one D330, D343 and
    D479 each needed and did not have.

    ⚠️ **PROVENANCE, AND THE GAP NAMED RATHER THAN IMPLIED.** Seeded by scanning
    the doc blocks of the nine non-changelog engine modules (`attack`, `cardplay`,
    `continuous`, `effects`, `flow`, `interpreter`, `redact`, `registry`, `types`)
    for a build-state word (`unbuilt` / `not built` / `never built`) inside a
    comment, then reading every id in a ±4-line window around it. That returns
    **27 windows naming 19 distinct ids with no registry program**. Only the rows
    below were transcribed, because only for these does the doc block itself state
    the SURFACE — and without a stated surface the oracle in limit 1 is not valid.
    The other thirteen are attack-surface printings (whose oracle is the derivers),
    data-blocked `Ancient` banner rows (which the same blocks are careful to call
    *"DATA-BLOCKED and permanently so, NOT unbuilt"*), or ids named as a wider
    sweep's false positives rather than as refusals.
    ⚠️ **`index.ts` IS EXCLUDED ON PURPOSE, AND THAT IS NOT A FUDGE.** It is the
    engine's version changelog: a `0.249.0` block describes the state AT 0.249.0,
    so *"the last unbuilt clause"* there is a true statement about a past head and
    reddening on it would be an instrument defect, not a finding. Scanning it too
    takes the window count from 27 to 44 and every one of the extra 17 is history.
    ⚠️ **THIS IS A RATCHET, NOT A CENSUS.** Nothing asserts the list is COMPLETE,
    and a completeness claim would be false the moment the next refusal is written
    in prose. What it asserts is that these fourteen printings are still refused. */
export const REFUSED_PRINTINGS: readonly RefusedPrinting[] = [
  {
    id: "sv01-127",
    card: 'Muk "Poison Sacs"',
    surface: "ability",
    why: 'The NEGATIVE form of the status-clear family — a modifier on §10\'s evolution clear (turn.ts, `reason: "evolved"`) carrying no op and no moment of its own. Refused as "a rule about a clear this op never performs", and named rather than left so the next census greps the repo and finds it already counted (D171\'s Corviknight rule).',
    since: "D171",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '// Muk sv01-127 "Poison Sacs": "Your opponent\'s Poisoned Pokémon don\'t recover',
    },
  },
  {
    id: "sv02-192",
    card: "Reversal Energy (the second printing)",
    surface: "specialEnergy",
    why: "NOT a mechanism refusal: `sv04-266` IS built (D302, `REVERSAL_ENERGY`) and this is the same card's other printing at `legal_standard = 0`. It is here because a POPULATION refusal and a MECHANISM refusal read identically in prose, and only this one is settled by the catalog rather than by the engine — the day it becomes Standard-legal the row is a one-line addition to the id table and nothing else.",
    since: "D302",
    cite: {
      file: "packages/engine/src/registry.ts",
      excerpt: "  // more Prizes remaining). 2 printings, 1 legal — `sv02-192` is not Standard.",
    },
  },
  {
    id: "sv06-164",
    card: "Survival Brace",
    surface: "tool",
    why: 'The TOOL twin of `survivesKoAtFullHp`. It prints the shipped sentence narrowed to "from your opponent\'s Pokémon" AND a second sentence — "Then, discard this card." — that the field cannot express: a passive fold has no way to consume its own source, and the discard is a STATE WRITE that would have to happen at the clamp site with the Tool\'s uid in hand. It needs a self-discard rider; flagged, priced, not taken.',
    since: "D243",
    cite: {
      file: "packages/engine/src/registry.ts",
      excerpt: "      • Survival Brace sv06-164 — the TOOL twin, 1 Standard-legal, which adds",
    },
  },
  {
    id: "sv07-132",
    card: "Briar",
    surface: "trainer",
    why: 'One of the two spellings of the Prize-count clause. `opponentPrizesRemaining` reads the SATISFYING SET (`counts: [0, 1, 2, 3]` for Lacey\'s "3 or fewer"), which is what makes the union spell an inequality; Briar prints "exactly 2 Prize cards remaining" and is refused for the reason recorded beside the member rather than for the shape of the count.',
    since: "D207",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)',
    },
  },
  {
    id: "sv07-163",
    card: "Briar (alternate art)",
    surface: "trainer",
    why: "A reprint of `sv07-132` and refused with it. Listed on its own line because a refusal covering N printings is N refusals until each is priced (D463) — and because the day Briar is built, all four ids must leave this table together or the survivors become a silent false claim.",
    since: "D207",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)',
    },
  },
  {
    id: "sv07-171",
    card: "Briar (alternate art)",
    surface: "trainer",
    why: "The third Briar printing, and refused with the other three. Its own row for `sv07-163`'s reason: a refusal covering N printings is N refusals until each is priced (D463), and a partial deletion here would leave a false claim rather than no claim.",
    since: "D207",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)',
    },
  },
  {
    id: "sv08.5-100",
    card: "Briar (reprint)",
    surface: "trainer",
    why: "The fourth Briar printing, in a later set, and the only one of the four whose id the doc block spells WHOLE. Its own row for `sv07-163`'s reason, and it is the control that keeps the suffix reading honest: one row cited in full beside three cited by suffix.",
    since: "D207",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)',
    },
  },
  {
    id: "sv10.5w-023",
    card: "the ABILITY twin of Iron Bundle's compound switch",
    surface: "ability",
    why: 'Found by a sweep the backlog row missed BECAUSE THE ROW CENSUSED ATTACK TEXT ONLY. It prints the compound switch as an activated Ability — "Once during your turn, you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent\'s Active Pokémon to the Bench." — so it is a REGISTRY row and not an arm, and is deliberately left for its own slice. ⚠️ It is exactly the shape D204 flagged per-surface: the card is not "unbuilt", its ABILITY is.',
    since: "D312",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: "// BECAUSE THE ROW CENSUSED ATTACK TEXT ONLY: `sv10.5w-023`/`-107` print the",
    },
  },
  {
    id: "sv10.5w-107",
    card: "the ABILITY twin of Iron Bundle's compound switch (alternate art)",
    surface: "ability",
    why: 'The pair of `sv10.5w-023`, and the reason it gets a row of its own is that the doc block spells it `/`-107`` — a SUFFIX, which no id scan can see. A refusal written in suffix shorthand is invisible to every `git grep <id>` D321 prescribes, and that is the second way a build-state claim goes unchecked.',
    since: "D312",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: "// BECAUSE THE ROW CENSUSED ATTACK TEXT ONLY: `sv10.5w-023`/`-107` print the",
    },
  },
];

/** Does `excerpt` actually name `id`? — the anti-typo rung of limit 2, and the
    only piece of LOGIC in this file.

    🛑 **IT IS NOT `excerpt.includes(id)`, AND THE REASON IS A FINDING RATHER THAN A
    CONVENIENCE.** The repo writes a reprint's id as a SUFFIX — ``sv10.5w-023`/`-107``,
    `Briar sv07-132/-163/-171` — so five of the nine rows below are cited by prose
    that never spells their id in full. **A refusal written in suffix shorthand is
    invisible to the `git grep <id>` D321 prescribes**, which is the second way a
    build-state claim goes unchecked and the reason those printings get their own
    rows here. So a citation counts if it spells the id whole, OR if it names the SET
    and the printing NUMBER separately — which is exactly what the shorthand does.

    ⚠️ The set/number split is at the LAST `-` because a set is `sv10.5w`, never
    `sv10-5w`: the version dot is a dot, so an id carries exactly one hyphen today.
    Written as `lastIndexOf` anyway, because "exactly one" is a fact about this
    catalog and not about the shape. */
export function excerptNamesId(excerpt: string, id: string): boolean {
  const split = id.lastIndexOf("-");
  if (split <= 0) return false;
  const set = id.slice(0, split);
  const number = id.slice(split);
  return excerpt.includes(id) || (excerpt.includes(set) && excerpt.includes(number));
}

/** One printing a doc block DID refuse and that is built at HEAD, with the
    correction that records it. */
export type ResolvedRefusal = {
  readonly id: string;
  readonly card: string;
  /** The decision that actually shipped the row. */
  readonly builtBy: string;
  /** The decision whose refusal this falsifies. */
  readonly refusedBy: string;
  /** The DATED CORRECTION, not the refusal — `cite.excerpt` must occur exactly
      once in `cite.file`. Deleting the stamp, or reverting the file to the state
      in which the refusal stood alone, goes red. */
  readonly cite: { readonly file: string; readonly excerpt: string };
};

/** THE OTHER DIRECTION — the printings D480 found already built behind a refusal
    that still claimed otherwise. Each is asserted BUILT, and each is asserted to
    carry its dated correction (D178: falsified refusals are kept verbatim, never
    deleted, with the falsification stamped beside them).

    🛑 **THESE THREE ARE THE WHOLE OF D480's ORIGINAL WORK ORDER.** It priced them
    as *"two hand-authored `registry.ts` rows and nothing else"*. The true price was
    ZERO rows: `UNFAIR_STAMP` and `TEAM_ROCKETS_ARCHER` were already declared, in
    the id table, in the fixture table, in `CENSUS_TRAINER_LEGAL`, in
    `TRAINER_TERMS`, inside `BUILT.trainer`, and driven end-to-end on real boards
    — including all three of the boards the work order asked for by name (both
    sides of the gate driven separately, the wrong-SEAT board, and the wrong-WINDOW
    board) — by `lastTurnKo.test.ts` §3 and `lastKoOwnerMark.test.ts` §7. */
export const RESOLVED_REFUSALS: readonly ResolvedRefusal[] = [
  {
    id: "sv06-165",
    card: "Unfair Stamp",
    builtBy: "D271",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/registry.ts",
      excerpt:
        "    🛑🛑 **D480 — THE PARAGRAPH ABOVE IS FALSE AT HEAD, AND ITS REFUTATION IS IN",
    },
  },
  {
    id: "sv10-170",
    card: "Team Rocket's Archer",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt:
        "      🛑🛑 **D480 — THE PARAGRAPH DIRECTLY ABOVE IS D479'S OWN CORRECTION, AND ITS",
    },
  },
  {
    id: "sv10-223",
    card: "Team Rocket's Archer (alternate art)",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt:
        "    🛑 **D480 — THE WORD `unbuilt-but-same-shape` FOUR LINES UP IS FALSE, AND HAS",
    },
  },
];
