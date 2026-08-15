#!/usr/bin/env python3
"""D344 docs/progress.md close-out. DRY-RUN BY DEFAULT.

Four surgical, anchored replacements. NO regex, NO re.S, NO re.sub — every edit
is an exact-literal `str.replace` whose anchor is asserted to occur EXACTLY ONCE
first, and the file's byte length is reported before and after so a deletion
cannot hide. (D-past: a regex with `re.S` would have deleted 582 KB of this page.)

  python3 scratchpad/D344-docs.py          # dry run: prints the plan, writes nothing
  python3 scratchpad/D344-docs.py --apply  # applies
"""
import sys

PATH = "docs/progress.md"
APPLY = "--apply" in sys.argv

HEADER = (
    "**Last updated:** 2026-08-15 — build session #284 (**P3-M5 — D344, *THE PRINTED "
    "`or`: AN ORDERING PROMPT LEARNS THE SECOND ARM PRINTED BESIDE IT, AND THE \"IN ANY "
    "ORDER\" FAMILY CLOSES ON STANDARD.*** Engine **0.249.0 → 0.250.0**, ONE bump over "
    "FOUR sites; `MATCH_RECORD_VERSION` **STAYS 20** — three widenings and nothing else "
    "(`reorderTop.otherwise`/`.otherwiseNote` are registry-side program vocabulary that "
    "is never persisted; `orderCards.alt` is an ADDED OPTIONAL FIELD on a persisted "
    "union, so a v20 record cannot hold one; `DECK_TOP_TO_BOTTOM` is an EVENT, rendered "
    "into `record.log` rather than stored). **BUILT: Deduction Kit `sv08-171`** (Item, "
    "**1 legal printing of 1**, `effect`) — *\"Look at the top 3 cards of your deck and "
    "put them back in any order, **or** shuffle them and put them on the bottom of your "
    "deck.\"* ✅ **THE FAMILY CENSUS WAS RE-DERIVED FROM REMOTE D1 `luminous` RATHER THAN "
    "INHERITED, AND THE INHERITED FIGURE WAS WRONG.** `instr(<col>,'in any order') > 0` "
    "over all three text columns returns **15 printings / 11 legal / 7 distinct "
    "sentences** (`effect` 8/6 + `attacks_json` 7/5 + `abilities_json` 0/0 = 15/11 ✅) — "
    "the pair D342 recorded and D343 flagged as unconfirmed, CONFIRMED to the digit. "
    "🛑 **BUT ITS \"five of the seven now BUILT\" CLAUSE WAS ONE TOO MANY: IT WAS FOUR.** "
    "Counted off `registry.ts` and `effects.ts` at this head — the two "
    "`ATTACK_REORDER_TOP` sentences (D341), the search-to-top one (D342) and Kofu's "
    "hand→bottom one (D343). **This is the fifth, and the two survivors — Raifort "
    "`sv06-161`/`sv08.5-142` and Absol ex `sv03-135`/`-214` — are BOTH "
    "`legal_standard = 0`, so of the FIVE sentences with any legal printing, all five "
    "are now built and the family CLOSES on Standard.** ⚠️ The honest form of the figure "
    "separates two axes the rotten one conflated: **7 sentences, 5 with a legal "
    "printing, 5 of those 5 built.** 🛑🛑 **THE `or` WAS PRICED AS \"NEITHER A CAPTION NOR "
    "A PROMPT KIND\" AND THE KIND HALF WAS ALREADY PAID.** `confirm`'s own doc block "
    "settles it — *\"a confirm answer means run `then` … a fact about the program\"*, "
    "where a `mayDraw` answer is a fact about cards — so **a binary answer that picks "
    "between two printed arms is a MEANING this engine has had since D186**, and "
    "`optional { then, otherwise }` has been a two-armed branch on a human answer since "
    "D316. 🛑 **IT IS REFUSED ANYWAY, FROM THE SOURCE RATHER THAN FROM TASTE**: an "
    "`optional` parks `{kind:\"confirm\", note}` and **a confirm carries NO CANDIDATES**, "
    "while the print hands the look over FIRST (*\"**Look at the top 3 cards** of your "
    "deck **and** put them back in any order, or …\"*) — so the wrapper would make the "
    "player choose **BLIND**. That is not a caption difference; it is the loss of the "
    "one thing the sentence gives before it asks. **THE PROMPT THAT ASKS THE `or` HAS TO "
    "BE THE PROMPT THAT DELIVERS THE LOOK**, and `orderCards` (D341) is the only prompt "
    "whose window `redactPrompt` resolves to the answerer alone. **THE ANSWER IS THE "
    "EMPTY ORDERING** — *none of these cards is being put back on top* — a value the "
    "prompt could not previously hold rather than one taken from something else "
    "(`validateChoice` demands a permutation of a window never smaller than 2), admitted "
    "EXACTLY when `alt` is present. ⭐ **AND `applyChoice` NEEDED NO ARM AT ALL**: both "
    "of its splices reduce to the identity on an empty answer, so the WHOLE of the "
    "second arm is the `continuationOps` splice — D316's shape exactly. **THE PIECES: 1 "
    "new `EffectOp` (`bottomDeckTop {n}`) + 2 optional op fields + 1 optional prompt "
    "field + 1 `continuationOps` member (the FIFTH, and the first branch carrier that is "
    "not a gate) + 1 `GameEvent` + 1 `log.ts` row + 1 wire field + 2 dialog buttons — "
    "and 0 new prompt kinds, 0 new choice kinds, 0 `validateChoice` arms, 0 "
    "`applyChoice` arms, 0 `redactPrompt` arms, 0 `ONE_PER_KIND` rows.** ⚠️ **`otherwise` "
    "IS A FLAT `EffectOp[]` AND THAT IS CORRECTNESS, NOT STYLE** — `subPrograms` "
    "discovers sub-programs by a NEGATIVE predicate over an op's own ARRAY-VALUED "
    "properties, and its doc names the one thing it cannot see: *\"a program reached "
    "through a field that is NOT an `EffectOp[]`\"*. A nested `{note, ops}` object would "
    "have hidden this arm from `walkProgram` and opened a **FOURTH instance of the "
    "population defect D341, D342 and D343 each repaired — the first one that would have "
    "been AUTHORED rather than inherited.** ⚠️ **THE M1 GUARD NEEDED NO SECOND ARM AND "
    "THAT IS ARITHMETIC**: `top.length` is `min(n, deck.length)`, so for any `n ≥ 2` the "
    "existing `top.length < 2` refusal is exactly *\"both arms are the same state\"*; the "
    "only board separating the tests is `n === 1` over a long deck, which no printing "
    "spells. 🛑 **FIVE PROSE SITES SWEPT, AND ONE HAD BEEN FALSE SINCE D341 WITH NOTHING "
    "TO SAY SO**: census row 11's note still called `sv08-171` *\"the ORDERED answer no "
    "prompt in this engine has\"* two slices after D341 shipped that prompt — the id sat "
    "there because the printed `or` blocked it, never the ordering. **A RESIDUE NOTE "
    "THAT NAMES A MECHANISM IS ONLY SPENDABLE IF THE ID OWES EXACTLY ONE.** **MOVED**: "
    "`BUILT.trainer` 108 → **109**, `built` 1566 → **1567**, residue 817 → **816** "
    "against an unmoved `units` **2,383**, `raw.length` 675 → **676**, "
    "`nonAttackRegistryIds` 531 → **532**, the four-list pool closure 531 → **532** "
    "(D342's NAMED miss, inherited and paid), `TRAINER_TERMS` 57 → **58 CARDS carrying "
    "+1 printing** (the two step by the SAME amount for the first time since D330), "
    "`TRAINER_SUBTYPE_TALLY` Item 27 → **28**, `byObject` 56 → **57**, the three-column "
    "sum 368 → **369**, census row 11's `effectIds` **1 → 0 — THE ROW'S TRAINER COLUMN "
    "CLOSES**, and `programWalk`'s carrier pin gains `[\"reorderTop\", [\"otherwise\"]]` "
    "— **the FIFTH branching op, and the first slice in which the union actually grew "
    "one since that pin was written to notice it.** ⚠️ **MEASURED UNMOVED**: "
    "`BUILT.attack` **1198** (1169 raw / 16 registry / 13 split), `.ability` **252**, "
    "`.specialEnergy` **8**, `unbuiltAttack` **534**, `units` **2,383**, `REVEALING` "
    "**29**, `NOT_REVEALING` **15**, `classified.size` **44**, `swept.size` **103** "
    "(`searchOps` collects only `searchDeck`/`lookAtTopN`, so the POPULATION gains "
    "`sv08-171` and the SWEEP does not), `DROPPED` **2** — every one off `IS NULL` / "
    "`length()` / `category` on remote D1 in the session that wrote it (2026-08-15). "
    "Prediction **23-4**, and **all four misses are one defect**: three SUMS keyed on a "
    "summand the prediction did name (`TRAINER_SUBTYPE_TALLY`, `byObject`, the "
    "three-column sum) and the FOUR VERSION SITES, keyed on a version it did name — "
    "*a figure named is not its rungs enumerated*, and `legacyEnergy.test.ts` carries "
    "D343's warning about exactly that, written after D343 made the same mistake. "
    "`bun run check` **353 files / 7,230 tests**; corpus 985 → **999**, fourteen rows, "
    "**all fourteen KILLED and no survivor declared**; sweep **978 killed · 21 known "
    "survivors · 0 GAPs · 0 stale · 0 skipped(dirty) · 0 clobbers · 0 errors**, "
    "978 + 21 + 0 = 999 ✅. ⚠️ **TWO BASELINE ERRORS, BOTH SELF-INFLICTED** — the "
    "version row (its FORTY-FIRST payment, and the first time it was named by an ERROR "
    "at the END of a 53-minute sweep rather than by a `precheck` that no longer exists) "
    "and D341's redaction row, whose `find` quoted FOUR lines including two neighbours "
    "and broke when `orderCards`'s arm gained the `alt` spread between them; re-anchored "
    "onto the one line its mutation is about, both re-verified KILLED.)"
)

STATUS = (
    "| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (latest: **P3-M5 — D344, "
    "THE PRINTED `or`: AN ORDERING PROMPT LEARNS THE SECOND ARM PRINTED BESIDE IT.** "
    "Engine **0.249.0 → 0.250.0**, `MATCH_RECORD_VERSION` **STAYS 20**. Deduction Kit "
    "`sv08-171` (Item, 1 legal of 1) — the LAST legal member of the *\"in any order\"* "
    "family, which now CLOSES on Standard: 15 printings / 11 legal / 7 sentences "
    "re-derived from remote D1, of which the 5 with a legal printing are all built and "
    "the 2 survivors are both `legal_standard = 0`. The `or` cost a CAPTION and a "
    "SPLICE and **no new prompt kind** — `confirm`'s own doc had already settled that a "
    "binary answer means *run this arm*, and what no prompt could do was ask it WITH "
    "THE CARDS VISIBLE. `bun run check` **353 files / 7,230 tests**; sweep **978 / 21 / "
    "0 GAPs / 0 errors** over a **999**-row corpus.) |"
)

SESSION_ENTRY = """### 2026-08-15 — build session #284 (P3-M5 — D344, the printed `or`: an ordering prompt learns the second arm printed beside it, and the "in any order" family closes on Standard)

**Slice D344.** Engine **0.249.0 → 0.250.0**, ONE bump over FOUR sites.
`MATCH_RECORD_VERSION` **STAYS 20**, grepped at both ends.

**THE ROW.** Deduction Kit `sv08-171` — Item, **1 Standard-legal printing of 1**,
125-char `effect`: *"Look at the top 3 cards of your deck and put them back in any
order, **or** shuffle them and put them on the bottom of your deck."*

✅ **GREPPED BEFORE PRICING, AS D343's HANDOFF DEMANDED.** `sv08-171` appeared at
eleven sites in the tree and **every one was prose** — version blocks, anchor
docs, two deriver suites' residue lists, census row 11's `effectIds`, two mutant
`what` strings. No registry row, no program, no id-map entry. **The row was
genuinely unbuilt, which is the first time in three slices that a handed-on price
survived the grep.**

✅ **THE FAMILY CENSUS RE-DERIVED FROM REMOTE D1 `luminous`, AND THE INHERITED
FIGURE WAS HALF RIGHT.** `instr(<col>,'in any order') > 0` over all three text
columns: **15 printings / 11 legal / 7 distinct sentences** (`effect` 8/6 +
`attacks_json` 7/5 + `abilities_json` 0/0 = 15/11 ✅) — D342's pair, which D343
flagged as unconfirmed, **CONFIRMED to the digit**. 🛑 **Its "five of the seven now
BUILT" clause was ONE TOO MANY: it was FOUR** — the two `ATTACK_REORDER_TOP`
sentences (D341), the search-to-top one (D342), Kofu's hand→bottom one (D343).
This is the fifth. The two survivors (Raifort ×2, Absol ex ×2) are **both
`legal_standard = 0`**, so **of the FIVE sentences with any legal printing, all
five are now built and the family CLOSES on Standard.** ⚠️ The honest form of the
figure separates the two axes the rotten one conflated: **7 sentences, 5 with a
legal printing, 5 of those 5 built.** "Five of seven" was the right numerator
against the wrong denominator, a slice early.

🛑🛑 **THE `or` WAS PRICED AS "NEITHER A CAPTION NOR A PROMPT KIND", AND THE KIND
HALF TURNED OUT TO BE ALREADY PAID.** `confirm`'s own doc block settles it: *"a
confirm answer means run `then` … a fact about the program"*, where a `mayDraw`
answer is a fact about cards. **A binary answer that picks between two printed
arms is a MEANING this engine has had since D186**, and `optional { then,
otherwise }` has been a two-armed branch on a human answer since D316.

🛑 **AND IT IS REFUSED ANYWAY, FROM THE SOURCE RATHER THAN FROM TASTE.** An
`optional` parks `{kind:"confirm", note}` and **a confirm carries NO CANDIDATES**.
The print hands the information over FIRST — *"**Look at the top 3 cards** of your
deck **and** put them back in any order, or …"* — so an `optional` wrapper asks
the question **BLIND**. That is not a caption difference; it is the loss of the
one thing the sentence gives before it asks. **THE PROMPT THAT ASKS THE `or` HAS
TO BE THE PROMPT THAT DELIVERS THE LOOK**, and `orderCards` (D341) is the only
prompt whose window `redactPrompt` resolves to the answerer alone.

**THE ANSWER IS THE EMPTY ORDERING**, and it reads as the print does: *none of
these cards is being put back on top.* It is a value the prompt could not
previously hold rather than one taken away from something else — `validateChoice`
demands a permutation of a window never smaller than 2 — and it is admitted
EXACTLY when `alt` is present. ⭐ **`applyChoice` NEEDED NO ARM AT ALL**: both of
its splices reduce to the identity on an empty answer, so the WHOLE of the second
arm is the `continuationOps` splice. **D316's shape exactly — the yes/no
difference lives in `resumeProgram`, never in the apply.**

**THE PIECES.** 1 new `EffectOp` (`bottomDeckTop {n}` — shuffle the top `n`,
append under the deck) + 2 optional op fields (`reorderTop.otherwise`,
`.otherwiseNote`) + 1 optional prompt field (`orderCards.alt`) + 1
`continuationOps` member (**the FIFTH, and the first branch carrier that is not a
gate**) + 1 `GameEvent` (`DECK_TOP_TO_BOTTOM`, count-only, **no `actor`** — D135,
the op has one seat) + 1 `log.ts` row + 1 wire field + 2 dialog buttons + 1
registry row + 1 driven suite. **0 new prompt kinds, 0 new choice kinds, 0
`validateChoice` arms, 0 `applyChoice` arms, 0 `redactPrompt` arms, 0
`ONE_PER_KIND` rows.**

⚠️ **`otherwise` IS A FLAT `EffectOp[]` AND THAT IS CORRECTNESS, NOT STYLE.**
`subPrograms` discovers sub-programs by a NEGATIVE predicate over an op's own
ARRAY-VALUED properties, and its doc names the one thing it cannot see: *"a
program reached through a field that is NOT an `EffectOp[]`"*. A nested
`{note, ops}` object would have hidden this arm from `walkProgram` and opened a
**FOURTH instance of the population defect D341, D342 and D343 each repaired —
and the first one that would have been AUTHORED rather than inherited.** The
carrier pin proved the choice from the other side: it went red naming
`["reorderTop", ["otherwise"]]` before the suite that drives the card existed,
which is the first time in that pin's history that the union actually grew a
fifth branching op.

⚠️ **THE M1 GUARD NEEDED NO SECOND ARM, AND THAT IS ARITHMETIC.** `top.length` is
`min(n, deck.length)`, so for any `n ≥ 2` the existing `top.length < 2` refusal is
exactly *"both arms are the same state"*: a 0- or 1-card deck shuffled onto the
bottom of what remains of it is where it was. The only board separating the two
tests is `n === 1` over a long deck, which no printed sentence spells. Pinned from
both sides by 1-card, 2-card and empty-deck rungs.

🛑 **THE PROSE SWEEP: FIVE SITES, AND ONE HAD BEEN FALSE SINCE D341 WITH NOTHING
TO SAY SO.** Census row 11's note still called `sv08-171` *"the ORDERED answer no
prompt in this engine has"* — two slices after D341 shipped that prompt. The id
stayed in the list because what actually blocked it was the printed `or`, never
the ordering. **A RESIDUE NOTE THAT NAMES A MECHANISM IS ONLY SPENDABLE IF THE ID
OWES EXACTLY ONE**; this one named the half that landed first, and the table's own
Hassel lesson ("a row's count is an upper bound on its own work, not a description
of it") had said so about IDS without anyone applying it to NOTES. The other four
are the deriver anchors' residue lists — all left standing, because each asserts
only what THIS anchor reads, and **a refusal gets MORE load-bearing, not less, the
day the thing it refuses gets built**: a floating `ATTACK_REORDER_TOP` would now
half-build a card the registry builds whole.

**MOVED**: `BUILT.trainer` 108 → **109**, `built` 1566 → **1567** (1198 + 252 =
1450, + 109 = 1559, + 8 = 1567, re-added from the parts), residue 817 → **816**
against an unmoved `units` **2,383**, `raw.length` 675 → **676** (+1 real catalog
id and **no `fix-*` key** — a LOCAL `cardPool`, because `sv08` is not among
`catalogManifest`'s six sets), `nonAttackRegistryIds` 531 → **532**, the four-list
pool closure 531 → **532**, `CENSUS_TRAINER_LEGAL` +1, `TRAINER_TERMS` 57 → **58
CARDS carrying +1 printing** (the two step by the SAME amount for the first time
since D330), `TRAINER_SUBTYPE_TALLY` Item 27 → **28**, `byObject` 56 → **57**, the
three-column sum 368 → **369**, census row 11's `effectIds` **1 → 0 (the row's
trainer column CLOSES)**, `programWalk`'s carrier pin 4 → **5 entries** and its
`missed` pin +1 (`sv08-171 trainer :: bottomDeckTop`, **the first row on that list
whose carrier is not a gate**).

⚠️ **MEASURED UNMOVED**: `BUILT.attack` **1198** (1169 raw / 16 registry / 13
split), `.ability` **252**, `.specialEnergy` **8**, `unbuiltAttack` **534**,
`units` **2,383**, `REVEALING` **29**, `NOT_REVEALING` **15**, `classified.size`
**44**, `swept.size` **103**, `DROPPED` **2**. The reveal-census quartet is the
one worth stating: `searchOps()` collects **only** `searchDeck` and `lookAtTopN`,
and this program is `reorderTop` + `bottomDeckTop`, so the POPULATION gains
`sv08-171` and the SWEEP does not — measured from the loop, not assumed from the
shape. Every D1 figure off `IS NULL` / `length()` / `category` in the session that
wrote it (2026-08-15).

**PREDICTION 23-4, AND ALL FOUR MISSES ARE ONE DEFECT.** Three of them are SUMS
keyed on a summand the prediction did name — `TRAINER_SUBTYPE_TALLY` (the
PARTITION of the trainer total by `trainer_type`), `byObject` (which counts
PROGRAM OBJECTS where the prediction reasoned in PRINTINGS — D341's "the UNIT can
be wrong" met on this file's own pins), and the three-column sum. The fourth is
the **FOUR VERSION SITES**: the prediction listed `engineVersion` as a moving
FIGURE and never enumerated its four RUNGS, so bumping `package.json` alone
reddened eight suites. **A FIGURE NAMED IS NOT ITS RUNGS ENUMERATED** — and
`legacyEnergy.test.ts` carries D343's warning about precisely this, written by
D343 after D343 made the same mistake. **That warning has now failed two slices
running, which is evidence about the warning rather than about the slices**, and
it is why the resume point below carries the four sites as a CHECKLIST.

`bun run check` **353 files / 7,230 tests, exit 0**. Corpus 985 → **999**,
fourteen rows across five files, **all fourteen KILLED and no survivor declared**.
Sweep **978 killed · 21 known survivors · 0 GAPs · 0 stale · 0 skipped(dirty) ·
0 clobbers · 0 errors**, 3,199.6 s + two `--only` re-runs; **978 + 21 + 0 = 999 =
the corpus ✅**, and the kill delta **964 → 978 = +14** is exactly this slice's
rows. ⚠️ **TWO BASELINE ERRORS, BOTH SELF-INFLICTED AND BOTH RE-ANCHORED**: the
version row (its FORTY-FIRST payment, and **the first time in its history that it
was named by an ERROR at the end of a 53-minute sweep rather than by a `precheck`
that no longer exists as a flag** — the row is still a function of the BUMP and
never of the diff; what changed is that learning so now costs 53 minutes instead
of 2 seconds), and D341's redaction row, whose `find` quoted FOUR lines including
two neighbours and broke the moment `orderCards`'s redact arm gained the `alt`
spread between them. It is re-anchored onto the ONE line its mutation is actually
about. **A ROW WHOSE `find` QUOTES ITS NEIGHBOURS BREAKS WHEN A NEIGHBOUR MOVES.**

"""

RESUME = """## NEXT (resume point)

> ### ▶ THE NEXT CONCRETE ACTION (written 2026-08-15, after D344)
>
> ✅ **NO DEBTS ARE OUTSTANDING, THE TREE IS CLEAN AND EVERYTHING IS PUSHED** —
> the branch `claude/backend-loop-subagents-q2wz9f` AND `main`, which was
> fast-forwarded at the user's explicit instruction. **NO PULL REQUEST WAS
> OPENED, BY INSTRUCTION.** `bun run check` **353 files / 7,230 tests, exit 0**;
> full mutation sweep **978 killed · 21 known survivors · 0 GAPs · 0 stale ·
> 0 skipped(dirty) · 0 clobbers · 0 errors**. **`978 + 21 + 0 = 999` ✅ = the
> corpus**, and the delta reconciles EXACTLY against this slice's 14 rows: killed
> **964 → 978** (+14, every one of them a correctness row) and known survivors
> **21 → 21** (this slice declared none). ⚠️ **TWO BASELINE ERRORS WERE FOUND AND
> BOTH WERE THIS SLICE'S OWN DOING** — see the checklist below, which exists so
> the next slice does not pay for them at the end of a 53-minute run.
>
> ### ▶ 🛑 THE FOUR VERSION SITES, AS A CHECKLIST — BUMP ALL FOUR IN ONE COMMIT
>
> **This has now cost two consecutive slices, and the warning already lives in a
> test file that neither of them read before editing.** A version bump touches
> FOUR places and a fifth that is not a version at all:
> 1. `packages/engine/package.json` — `"version"`.
> 2. `packages/engine/src/index.ts` — `export const engineVersion`.
> 3. `packages/engine/src/index.ts` — the new `/** 🆕🆕 X → Y */` doc block.
> 4. `packages/engine/src/legacyEnergy.test.ts` — the two `toBe("X.Y.Z")` pins.
> 5. **AND `scripts/mutation/mutants.ts`'s `D275-engine-version-drifts-again`,
>    whose `find` QUOTES the constant.** It is not a version site; it is a
>    mutation anchor that a version site breaks. **Re-anchor it in the SAME
>    COMMIT as the bump** — otherwise it surfaces as a baseline ERROR at the very
>    end of the sweep, which is where D344 found it.
> **AND BEFORE THE SWEEP, RUN THE ANCHOR CHECK** — there is NO `--precheck` flag;
> the cheap equivalent is a five-line `bun -e` that imports `mutants.ts` and
> asserts every row's `find` occurs EXACTLY ONCE in its file. D344 ran it after
> authoring its own rows (0 bad) and did not re-run it over the WHOLE corpus after
> editing `redact.ts`, which is how the second error survived to the sweep. **RUN
> IT OVER ALL 999 ROWS, NOT JUST YOUR OWN.**
>
> ### ▶ THE FAMILY THAT JUST CLOSED, AND WHAT IT LEAVES
>
> ✅ **THE *"IN ANY ORDER"* FAMILY IS DONE ON STANDARD AND SHOULD NOT BE OFFERED
> AGAIN.** Re-derived from remote D1 `luminous` at this head (2026-08-15):
> **15 printings / 11 legal / 7 distinct sentences** (`effect` 8/6 +
> `attacks_json` 7/5 + `abilities_json` 0/0). Five of the seven sentences have a
> legal printing and **all five are built** (D341 ×2, D342, D343, D344). The two
> that remain are **both `legal_standard = 0`** and buy nothing today:
> * Raifort `sv06-161`/`sv08.5-142` — a `lookAtTopN` whose LEFTOVERS are ordered
>   (two parks in one sentence).
> * Absol ex `sv03-135`/`-214` — *"either player's deck"*, a printed SIDE CHOICE
>   before the ordering one.
> **RECORDED AS SHAPES, NOT ROWS. Do not build either without a legality change.**
>
> ### ▶ THE NEXT ROW HAS NOT BEEN PRICED, AND THAT IS DELIBERATE
>
> 🛑 **D344 DID NOT PRE-PRICE A SUCCESSOR ROW, BECAUSE THE LAST FIVE HANDOFFS THAT
> DID WERE WRONG ABOUT SOMETHING EACH TIME** — D330's row had shipped, D341's
> UNIT was wrong, D342's blocker clause was false, D343's row had shipped, and
> D344's inherited census figure was off by one. **A PRICE WRITTEN BY A SLICE THAT
> WILL NOT PAY IT IS THE MOST RELIABLY ROTTEN THING ON THIS PAGE.** What the next
> slice should do instead, in this order:
> 1. **Read `censusAtHead.test.ts`'s `ROWS` table and take the largest
>    `abilityIds` / `effectIds` residue**, which is a LIVE list guarded by a test
>    rather than a claim in prose. At this head the biggest are row 9's
>    (`attachEnergyFrom`, discard side) and row 12's (hand side) — **but read
>    their counts off the file, not off this sentence.**
> 2. **Census the SENTENCE, not the card** (D340), over ALL THREE text columns,
>    and **re-add every per-column split against its own total.**
> 3. **Then check whether the card you were sent for is the CHEAPEST thing that
>    sentence buys** (D341), and whether it has already shipped (D330/D343).
>
> ### ▶ THE STANDING REFUSAL, UNCHANGED THROUGH FOUR SLICES
>
> 🛑🛑 **DELETE THE FESTIVAL GROUNDS ROW FROM ANY WORK ORDER THAT STILL CARRIES
> IT — UNCHANGED FROM D341/D342/D343 AND NOT RE-OPENED AT D344.** Its count (**7
> legal**, one byte-identical `abilities_json` sentence) is correct and is the
> only thing about it that is. It needs THREE mechanisms, one of them a record
> bump: a turn machine that can declare a second attack
> (`grep -rn "attackAgain\\|extraAttack\\|attacksThisTurn\\|attackCount\\|
> attackedThisTurn"` over `packages/engine/src` is **ZERO HITS**, and
> `attackEpilogue.uid` is a REQUIRED persisted field, so this is a
> `PendingStage` change → **`MATCH_RECORD_VERSION` 20 → 21**); a re-entry behind
> the KO sweep; and a NAMED-STADIUM `BoardCondition` reading EITHER seat's
> Stadium. **Not one slice.**
>
> ### ▶ THE OPEN FINDING D343 LEFT, STILL OPEN AND NOW WITH A SECOND INSTANCE
>
> ⚠️ **A FIGURE QUOTED IN A COMMENT IS INVISIBLE TO EVERY CHECK IN THIS REPO.**
> D343 found eight rotten prose figures in one afternoon; D344 found a rotten
> prose *sentence* — census row 11's *"the ORDERED answer no prompt in this engine
> has"*, false from the moment D341 shipped `orderCards` and copied forward for
> three slices. **The cheap errand D343 proposed still stands**: a check that greps
> `packages/engine/src` for the handful of census figures that own an assertion and
> fails when a comment quotes a different value for a name it owns — the same shape
> as `progressLog.test.ts`, a structural guard over prose. ⚠️ **AND D344 SHARPENS
> ITS LIMIT**: such a check would have caught none of D344's find, because the
> rotten thing was a CLAIM ABOUT THE ENGINE and not a number. **A guard over
> quoted figures catches stale numbers; nothing in this repo catches a stale
> sentence, and the only defence remains grepping the doctrine you just
> falsified.**
>
> ### ▶ THE AUDITOR-POPULATION RUN, STILL NOT DECLARED FINISHED
>
> D341 repaired `preventBlock` §11; D342 repaired `programWalk`; D343 repaired
> `revealClause`'s DISCOVERED census. **D344 found no fourth instance and did not
> look for one** — but it did AVOID authoring one, which is a different fact worth
> recording: `reorderTop.otherwise` is a flat `EffectOp[]` precisely because
> `subPrograms`'s negative predicate cannot see an `EffectOp[]` nested inside an
> object, and a `{note, ops}` shape would have been invisible to `walkProgram`
> from the day it landed. **THE FOURTH INSTANCE IS EASIER TO WRITE THAN TO FIND.**
> The unspent errand is unchanged: `grep -rn "Object.entries(FIXTURE_POOL)\\|
> Object.keys(FIXTURE_POOL)" packages/engine/src/*.test.ts` (**68 hits** at D343)
> and ask of each — **does this loop need printed card text?** If it does not,
> `FIXTURE_POOL` is not its population.

"""


def main() -> None:
    src = open(PATH, encoding="utf-8").read()
    before = len(src.encode("utf-8"))
    out = src
    plan = []

    # 1. HEADER — demote the current "Last updated:" to "(was)" and prepend ours.
    anchor = "**Last updated:** 2026-08-15 — build session #283"
    assert out.count(anchor) == 1, f"header anchor x{out.count(anchor)}"
    out = out.replace(anchor, "**Last updated (was):** 2026-08-15 — build session #283")
    marker = "**Last updated (was):** 2026-08-15 — build session #283"
    assert out.count(marker) == 1
    out = out.replace(marker, HEADER + "\n\n" + marker)
    plan.append("header: demoted #283, prepended #284")

    # 2. STATUS TABLE — strike the current simulator row, insert ours above it.
    row = "| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (latest: **P3-M5 — D343,"
    assert out.count(row) == 1, f"status anchor x{out.count(row)}"
    idx = out.index(row)
    end = out.index("\n", idx)
    old_row = out[idx:end]
    struck = ("| ~~simulator~~ | ~~P3~~ | ~~(was D343)~~ "
              + old_row[len("| simulator | P3 | "):])
    out = out[:idx] + STATUS + "\n" + struck + out[end:]
    plan.append("status: struck the D343 row, inserted the D344 row above it")

    # 3. SESSION LOG — insert our entry directly under the "## Session log" heading.
    head = "## Session log\n\n"
    assert out.count(head) == 1, f"session-log anchor x{out.count(head)}"
    out = out.replace(head, head + SESSION_ENTRY)
    plan.append("session log: prepended the D344 entry")

    # 4. RESUME POINT — replace from "## NEXT (resume point)" up to the NEXT
    #    heading, which is "### Prior resume point". Bounded by an INDEX PAIR, so
    #    nothing beyond the second anchor can be touched.
    start_a = "## NEXT (resume point)\n"
    end_a = "### Prior resume point (P5-3 — deck cover art, kept for continuity)"
    assert out.count(start_a) == 1, f"resume start x{out.count(start_a)}"
    assert out.count(end_a) == 1, f"resume end x{out.count(end_a)}"
    s_i, e_i = out.index(start_a), out.index(end_a)
    assert s_i < e_i, "resume anchors out of order"
    replaced = e_i - s_i
    out = out[:s_i] + RESUME + out[e_i:]
    plan.append(f"resume point: replaced {replaced} bytes between the two anchors")

    after = len(out.encode("utf-8"))
    for step in plan:
        print("  •", step)
    print(f"\n  bytes: {before} -> {after}  (delta {after - before:+d})")
    assert after > before - 8000, "REFUSING: the page shrank more than the old resume point"

    if APPLY:
        open(PATH, "w", encoding="utf-8").write(out)
        print("\n  APPLIED.")
    else:
        print("\n  DRY RUN — nothing written. Re-run with --apply.")


main()
