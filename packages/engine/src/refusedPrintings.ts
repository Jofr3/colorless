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
    (🆕🆕🆕 D569 (D539): those blocks' "DATA-BLOCKED and permanently so" is WITHDRAWN — `banners.ts` supplied the banner and D569 built the Ancient noun/discard rows; the sentence describes how THIS scan classified them at the time and stays true as history)
    sweep's false positives rather than as refusals.
    ⚠️ **`index.ts` IS EXCLUDED ON PURPOSE, AND THAT IS NOT A FUDGE.** It is the
    engine's version changelog: a `0.249.0` block describes the state AT 0.249.0,
    so *"the last unbuilt clause"* there is a true statement about a past head and
    reddening on it would be an instrument defect, not a finding. Scanning it too
    takes the window count from 27 to 44 and every one of the extra 17 is history.
    ⚠️ **THIS IS A RATCHET, NOT A CENSUS.** Nothing asserts the list is COMPLETE,
    and a completeness claim would be false the moment the next refusal is written
    in prose. What it asserts is that these fourteen printings are still refused.
    (🆕🆕🆕 D555: SEVEN rows at this head, counted — the Samurott pair left when D555 built
    it; "fourteen" is an older head's figure, kept.) (🆕🆕🆕 D562: SIX — D562 built
    Survival Brace `sv06-164` (registry.ts `SURVIVAL_BRACE`) and deleted its row, D555's
    precedent; its cited doc block in registry.ts carries the dated correction.) (🆕🆕🆕 D568:
    TWO — D568 built Briar (`sv07-132`/`-163`/`-171`, `sv08.5-100`, registry.ts `BRIAR`) and
    deleted all four rows together, as the `sv07-163` row's own reason demanded; the cited
    effects.ts doc block carries the dated correction.) (🆕 CARD REVISION B08: ONE — Reversal
    Energy `sv02-192`, the table's only POPULATION refusal, became `legal_standard_effective = 1`
    at 714256b3 and B08 made the one-line id-table addition its row named; the cited registry.ts
    comment carries the dated correction.) */
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
];

/** Does `excerpt` actually name `id`? — the anti-typo rung of limit 2, and the
    only piece of LOGIC in this file.

    🛑 **IT IS NOT `excerpt.includes(id)`, AND THE REASON IS A FINDING RATHER THAN A
    CONVENIENCE.** The repo writes a reprint's id as a SUFFIX — ``sv10.5w-023`/`-107``,
    `Briar sv07-132/-163/-171` — so five of the nine rows below are cited by prose
    that never spells their id in full. 🆕🆕🆕 **D555 — MEASURED, NOT CARRIED: TWO of the
    SEVEN rows** (`sv07-163`, `sv07-171` — `refusedPrintings.test.ts` §4's `suffixOnly`
    recomputes it). The "five of the nine" was never the measured figure (THREE at the
    D554 head, the Samurott `-107` the third), and D555 BUILT Samurott `sv10.5w-023`/`-107`
    ("Torrential Whirlpool", registry.ts `TORRENTIAL_WHIRLPOOL`) and deleted both of its
    rows, so the table is seven rows and the suffix pair is Briar's alone. (🆕🆕🆕 D562:
    six rows — Survival Brace `sv06-164`, cited by its whole id, was built and deleted;
    the suffix pair is unchanged.) (🆕🆕🆕 D568: TWO rows, and NO suffix-cited row is left —
    D568 built Briar and deleted all four of its rows, the suffix pair with them; the
    function is kept for the next shorthand citation.) **A refusal written in suffix shorthand is
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
    board) — by `lastTurnKo.test.ts` §3 and `lastKoOwnerMark.test.ts` §7.

    🆕🆕🆕 **D555 — A RETIREMENT GUARDED IN ONE DIRECTION ONLY, SAID OUT LOUD.** D555
    BUILT Samurott `sv10.5w-023`/`-107` (registry.ts `TORRENTIAL_WHIRLPOOL`) and
    DELETED both of its `REFUSED_PRINTINGS` rows, as §2's red line instructs
    ("correct the cited doc block, then delete the row"). It added NO row here, so
    this table stays at THREE: its scope is D480's retro-finds, printings built
    BEHIND a refusal nobody corrected, and Samurott's refusal was corrected in the
    slice that built it. ⚠️ The cost is named, not hidden: the dated D555 correction
    in effects.ts (under *"AND THE SWEEP FOUND TWO LEGAL PRINTINGS"*, stamped
    *"deliberately left for their own slice" IS WITHDRAWN*) is guarded by NOTHING here — deleting or
    reverting it reddens no test. A later slice that wants the header's "total in
    both directions" to cover same-slice retirements adds two rows (builtBy D555,
    refusedBy D312, citing that annotation) and moves this count 3 -> 5. (🆕🆕🆕 D562 did
    the same for Survival Brace `sv06-164` — built, its row deleted, no row added here, its
    dated correction in registry.ts guarded by nothing in this file — so the count stays 3.) */
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
