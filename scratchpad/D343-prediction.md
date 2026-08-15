# D343 — PREDICTION, written BEFORE any build. Head verified `5827be3`.

Baseline re-measured at the verified head: **352 files / 7,214 tests, exit 0**.
`node_modules` healthy (16 top-level, `vitest` + `typescript` present).

---

## 0. THE ROW, AND THE THING THE WORK ORDER DID NOT KNOW

🛑 **KOFU IS ALREADY BUILT AT `5827be3`.** `registry.ts` holds `const KOFU`
(line ~8288) wired at `"sv07-138"`, `"sv07-165"` and `"fix-kofu"` (lines
11368/11369/11534), with a doc block, a demonstrator in `FIXTURE_POOL`, a row in
`legalNonAttackPrograms.test.ts`'s table (line ~145) and two driven tests
(line ~3021). The resume point priced a row that had shipped. **D330's lesson,
at its second site.**

What is NOT built is **the printed *"in any order"***, and the current program
drops it silently:

```
{ op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
{ op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 4 }] },
```

**THE TELL IS IN THE EXISTING TEST, AND IT IS D342'S SHAPE EXACTLY.**
`legalNonAttackPrograms.test.ts` asserts the payment landed with
`expect([...tail].sort()).toEqual([...picks].sort())` — it **SORTS**, i.e. it
asserts a SET where the print demands an ORDER. D342 noticed its two survivors
were "an assertion about a FIELD instead of about a BOARD"; this is the sibling —
**an assertion about a SET instead of about a SEQUENCE.**

## 1. RE-DERIVED CENSUS (remote D1 `luminous`, 2026-08-15, at this head)

| query | n | legal |
|---|---|---|
| `effect` ∋ `bottom of your deck in any order` | 2 | 2 |
| `attacks_json` ∋ same | 0 | — |
| `abilities_json` ∋ same | 0 | — |
| `effect` ∋ `from your hand on the bottom of your deck` | 5 | 2 |
| `attacks_json` ∋ same | **0** | — (the negative query) |
| `abilities_json` ∋ same | 1 | 1 |

The wider width returns Dendra ×3 (**0 legal**, count **1**), Kofu ×2 (2 legal,
count **2**) and Quaquaval `sv08-052` "Up-Tempo" (1 legal, an Ability, count
**1**). **KOFU IS THE ONLY PRINTING IN THE ENGINE'S ENTIRE HAND→BOTTOM FAMILY
WHOSE COUNT EXCEEDS ONE**, which is precisely why the order has never been
observable and why `payFromHand`'s doctrine has never been wrong until now.

## 2. THE BLOCKER, RE-DERIVED FROM SOURCE (not inherited)

`interpreter.ts:1873` — `const top = state.players[owner].deck.slice(0, Math.max(0, op.n));`
`interpreter.ts:3466` — `const rest = deck.slice(choice.uids.length);` then
`deck: [...choice.uids, ...rest]`.

**CONFIRMED: `reorderTop` reads and writes the TOP and cannot address the
bottom.** D342's search→`dest:"deckTop"`→`reorderTop` channel is unavailable.

## 3. WHICH END THE ORDERING HAPPENS AT, AND WHY — THE DECISION

**AT THE DECK-BOTTOM END, AFTER THE MOVE, VIA A `from: "bottom"` FORK ON
`reorderTop`.** Three candidates were priced; two are refused *from source*:

**REFUSED — (c) let the `payFromHand` answer's array order BE the ordering.**
Superficially free: `payFromHandApply` already does
`deck: [...side.deck, ...paid]` and builds `paid` by iterating `uids` in the
answer's order, so the order is *incidentally* consumed today. It is refused on
two independent facts in the source:
1. **`index.ts`'s D341 block states the doctrine this would break** — *"every
   `chooseCards` consumer iterates the answer to MOVE cards, so two answers
   naming the same uids are the same board, and **the validator is free to treat
   the array as a set**."* A client is licensed to reorder a `chooseCards`
   answer. Building Kofu on that array order would rest a printed clause on a
   behaviour the engine explicitly declines to specify. **D341's rule: a prompt
   kind is a claim about what an answer MEANS.** `chooseCards` means *which*.
2. **`payFromHand` AUTO-RESOLVES when `candidates.length <= op.count`**
   (`interpreter.ts:2207`) — "the only decision is WHICH cards". On the exactly-
   two-other-cards board that is the *commonest* Kofu line, **no prompt is shown
   at all** and the cards land in raw hand order. The printed "in any order" is
   not merely unspecified there, it is **absent**. This branch is correct for
   every printing authored so far and false for this one.

**REFUSED — (b) order over the HAND, before the move.** Needs a prompt that both
SELECTS a subset and SEQUENCES it — neither `chooseCards` (subset, no order) nor
`orderCards` (permutation of the *whole* offer) does both, so it is a NEW prompt
kind and re-pays D341's whole bill (kind + choice kind + validator + redact + zod
+ projection + 2 dialogs + the `ONE_PER_KIND` pin). Its cheap variant — a second
park whose candidates come from the `paid` RECORD — is **buying a channel when
the board is one**, which is the exact thing D342 says to check first.

**CHOSEN — (a) `reorderTop { n: 2, from: "bottom" }` after the payment.** After
`payFromHand{to:"deckBottom"}` the two paid cards **ARE the last two cards of the
deck, by construction** — the same by-construction guarantee that made D342's
trick work, read at the other end. So:

> 🆕 **D342's TRICK IS GENERAL; ITS READER WAS NOT.** The resume point recorded
> "the channel is the board is NOT available here". That is wrong in its
> generality and right in its particulars: the board **is** the channel for Kofu
> too — `reorderTop` simply could not read that end of it. **The cost of the row
> is one WINDOW FORK, not one CHANNEL.**

Placed **inside the existing `recordGate{slot:"paid"}`**, ahead of the draw:
`recordGateHolds` is `filed.length > 0`, so a run that paid nothing never opens
an ordering window over two cards nobody put there.

⚠️ **AND THE FLOOR/DOMAIN HAZARD IS D342's `exact`, ONE ZONE OVER, WITH A WEAKER
GUARANTEE.** `reorderTop{n:2}`'s domain is 2; `payFromHand`'s floor is
`min(handSize, 2)`. They agree only because `handCostUnmet` refuses the play
unless two are payable — a gate **in another file**, not a property of the op
pair. D342's `exact` made the pair self-sufficient; this does not, and the
difference is worth writing down rather than papering over.

## 4. THE EVENT DECISION

`DECK_TOP_REORDERED { seat, actor, count }` gains **`end?: "bottom"`** — an
OPTIONAL field, absent on every existing construction site.

* **A field, not a second event type**, for the reason D341 made `side` a field
  rather than a second op: one op with a window fork owes one row with a window
  fork.
* **OPTIONAL and absent-means-top is load-bearing**, and I predict it is what
  keeps `derivedReorderTop.test.ts:748/754` green — both are exact-shape
  `toEqual({ type, seat, actor, count })` assertions that a REQUIRED field would
  redden.
* **The row still fires on the bottom fork**, D241's rule kept unconditional.
  The tempting "there is no look, so emit nothing" is refused: it is true of
  *Kofu* (the controller placed those two cards there themselves one op earlier)
  and false of the fork (a future "look at the bottom 3 cards…" is a real look),
  so gating an EVENT on `from` would key a confidentiality rule on a window.
* `MATCH_RECORD_VERSION` **STAYS 20** — events are rendered into `record.log`
  rows and are not themselves persisted (`DECK_TOP_REORDERED`'s own doc says so),
  and a new optional op field is registry-side program vocabulary.

## 5. THE MOVING LIST — every rung I predict CHANGES

Numbered claims. `M` = moves, `U` = measured unmoved.

### 5a. Code
1. **M** `effects.ts` — `reorderTop` union member gains `from?: "bottom"`.
2. **M** `interpreter.ts` park (~1864) — window forks to the bottom slice.
3. **M** `interpreter.ts` apply (~3447) — splice forks to the bottom.
4. **M** `interpreter.ts` `reorderNote` (~8902) — caption forks.
5. **M** `events.ts` — `DECK_TOP_REORDERED` gains `end?: "bottom"`.
6. **M** `log.ts` `DECK_TOP_REORDERED` row — phrase forks top/bottom.
7. **M** `registry.ts` `KOFU` — program gains the op; doc block rewritten.
8. **M** `packages/engine/package.json` — `0.248.0 → 0.249.0`.
9. **M** `index.ts` — a new version doc block at the head of the chain.

### 5b. Rungs keyed on a COUNT
10. **M** `bun run check` **test count 7,214 → strictly greater** (new tests).
11. **U** `bun run check` **file count 352** — I predict I add NO new suite file
    (the row extends `derivedReorderTop.test.ts` and
    `legalNonAttackPrograms.test.ts`). ⚠️ Flagged as the claim most likely to
    break if the ordering warrants its own suite.
12. **U** `BUILT.attack` **1198**, `.ability` **252**, `.trainer` **108**,
    `.specialEnergy` **8**, `built` **1566**, residue **817**,
    `unbuiltAttack` **534**, `raw.length` **675**, `nonAttackRegistryIds`
    **531**, `TRAINER_TERMS` **57**, `units` **2383**. **KOFU IS ALREADY
    COUNTED** — this row builds no new printing, so NOT ONE CENSUS TOTAL MOVES.
    This is the unusual feature of the slice and the reason its risk sits
    entirely in the non-count rungs below.
13. **U** `raw[last]` = **`sv08.5-104`** (insertion order — nothing appended).
14. **U** `classified.size` **39**, `swept.size` **27** (`revealClause`) —
    `reorderTop` is not a search op.
15. **U** `DROPPED` **2**, `MATCH_RECORD_VERSION` **20**, corpus **977**.
16. **U** `precociousEvolution`'s `head − rawDelta − splitDelta` DIFFERENCE and
    its `searchDeck` dest ENUMERATION — this row touches neither.

### 5c. ⚠️ RUNGS KEYED ON SOMETHING THAT IS **NOT** A COUNT — D342's six misses
This is where D342 lost its prediction. Enumerated deliberately:

17. **U — a UNION's MEMBERSHIP.** `preventBlock.test.ts:1254` (`reorderTop:
    "untouched"`) and `:2045` (the driven probe) are keyed on the op's **NAME**,
    not its field set. A new optional field adds no §11 verdict. Predicted
    UNMOVED, and this is a prediction, not an assumption.
18. **M — a UNION's MEMBERSHIP.** `EffectOp`'s `reorderTop` member field set
    `{n, side?}` → `{n, side?, from?}`. Any auditor enumerating that member's
    KEYS moves. I predict there is **no such auditor** (unlike `searchDeck.dest`,
    whose inhabitants are enumerated) — flagged as a real risk.
19. **M — a UNION's MEMBERSHIP.** `GameEvent`'s `DECK_TOP_REORDERED` field set
    gains `end?`. Predicted to break **no** exact-shape assertion *because the
    field is optional and absent on the top path* — see claim 5b.
20. **U — an AUDITOR'S PINS.** `programWalk.test.ts`'s missed-op pin (**40**
    after D342). `reorderTop` is already a walked op and KOFU is already a walked
    program, so the pin is unmoved.
21. **M — a REFUSAL WITH A SHELF LIFE.** `derivedSearchTopOrder.test.ts:114`
    asserts/records *"Kofu `sv07-138`/`-165` — a DIFFERENT verb and zone pair"*
    among the sentences its deriver does NOT read, and `:369` drives
    `for (const text of [KOFU, DEDUCTION_KIT, RAIFORT])` expecting no match.
    **THIS STAYS TRUE** (the deriver still must not read Kofu — Kofu is an
    authored registry row, not a derived attack), so predicted **UNMOVED** — but
    it is exactly the shape D342's lesson names, so it is listed and will be
    re-read rather than assumed.
22. **M — a REFUSAL WITH A SHELF LIFE.** `derivedSearchTopOrder.test.ts:73`'s
    prose *"`reorderTop { n: 2 }` then reads `deck.slice(0, 2)`"* becomes a
    HALF-truth the moment `from` exists. Narrow it to the top fork.
23. **M — a REFUSAL WITH A SHELF LIFE.** `derivedLookAtTop.test.ts:170/176`'s
    residue note about `reorderTop.side` giving the family "its first read of a
    zone the actor does not own" — still true, but it now sits beside a second
    fork and should say which.
24. **M — a PARTITIONED TOTAL.** None identified. ⚠️ **Explicitly recorded as
    the category I could not find an instance of**, which is how D342 lost two.
25. **M — DOC PROSE THAT IS A CLAIM.** `registry.ts` `KOFU`'s doc block and
    `legalNonAttackPrograms.test.ts:150`'s `ops:` string both describe the
    program and both become false.
26. **M — DOC PROSE THAT IS A CLAIM, AND A FACTUAL ERROR I FOUND.**
    `effects.ts`'s `payFromHand` doc asserts *"every Trainer in the family says
    'other'/'another' and every Ability says neither"*. **KOFU SAYS NEITHER AND
    IS A TRAINER** — its parenthetical reads "If you can't put 2 cards **from
    your hand**…". The engine's behaviour is right (the played uid is excluded
    because it is on the table); the stated CORRELATION is false at this head,
    independently of anything I build. Predicted: I correct it.
27. **M — `index.ts`'s D341 doctrine sentence.** *"the validator is free to treat
    the array as a set"* is about to acquire its first counterexample-adjacent
    case; the honest narrowing is that it is free to do so **for `chooseCards`**,
    and that `payFromHand{to:"deckBottom"}` at count > 1 is why a SECOND op
    carries the order rather than the answer.

### 5d. Errors
28. **M** I predict a **NONZERO** `bunx biome` re-wrap error count against
    existing mutant rows if I touch quoted lines — D342 hit 7. I predict
    **1–6**, concentrated on `interpreter.ts`'s `reorderTop` arms, which existing
    mutant rows quote. Each `find` re-anchored and verified to match exactly once.

## 6. THE ERRAND — the third population bug

Grep run: **68 hits** of `Object.entries|keys(FIXTURE_POOL)` across
`packages/engine/src/*.test.ts`. Most legitimately read printed card text
(`card.text`, `card.trainerType`, filters over the fixture body) — for those the
pool IS the population.

**MY CANDIDATE, and the reason:** `revealClause.test.ts:561`, the
"SWEEPS `FIXTURE_POOL` for search ops nobody classified — a DISCOVERED census".
Its loop body is `programFor(id)` + `searchOps(id)` — **keyed entirely on an id,
touching no printed text.** And its own two pins say the quiet part out loud:
`classified.size` **39** against `swept.size` **27** — twelve classified
programs the sweep cannot see — with a comment explaining the gap away as
"suites carrying their own local pool". **That is D341's `preventBlock` §11
defect and D342's `programWalk` defect, third site.** Prediction: the right
population is the registry (`registryCardIds()` / the id map), `swept.size`
rises well above 27, and the sweep starts covering real `sv*` catalog rows
rather than `fix-*` demonstrators.

⚠️ **Predicted SECOND-ORDER consequence, and the thing that makes this NOT
bounded work:** if the sweep is repointed at the registry it will very likely
surface **unclassified real search ops** — rows nobody has decided the reveal
for. That is a genuine finding but it is an unbounded one. **Prediction: I run
the measurement, and I only repair the population if the unclassified set comes
back empty or trivially small.** If it does not, I write the measured number into
the resume point and hand it on rather than half-doing it.

## 7. SWEEP

`bun run mutants` LAST, no `--full`, log to `scratchpad/D343-sweep.log`.
Predicted: `killed + survivors + GAPs = 977` (corpus unmoved, claim 15), kill
delta reconciles against the rows I add. Predicted survivors: **0–2**; if any
survives, **I check whether its `what` is still TRUE before assuming a suite
gap** (D341's rule, and D342 found both of its claims true).

---
---

# GRADE — written after the build, before the sweep finished

## HITS (numbered against §5 of the prediction above)

**Code, 1–9:** all MOVED as predicted. ✅ ×9
(effects.ts union+doc, interpreter park, interpreter apply, `reorderNote`,
events.ts field, log.ts row, registry `KOFU`, package.json, index.ts doc block.)

**10 ✅** test count 7,214 → **7,215**, strictly greater.
**11 ✅** file count **352 UNMOVED** — no new suite file, as predicted (and this
was flagged in advance as the claim most likely to break).
**12 ✅** every census total UNMOVED and MEASURED so — the unusual feature of the
slice, and correctly predicted for the right reason (Kofu was already counted):
`BUILT.attack` 1198, `.ability` 252, `.trainer` 108, `.specialEnergy` 8,
`built` 1566, residue 817, `unbuiltAttack` 534, `raw.length` 675,
`nonAttackRegistryIds` 531, `TRAINER_TERMS` 57, `units` 2383.
**13 ✅** `raw[last]` = `sv08.5-104`, UNMOVED.
**15 ✅ (partly — see MISS 3)** `DROPPED` 2 and `MATCH_RECORD_VERSION` 20 UNMOVED.
**16 ✅** `precociousEvolution`'s DIFFERENCE and `searchDeck` dest ENUMERATION
both UNMOVED.
**17 ✅ (union membership)** `preventBlock`'s `reorderTop` verdict and driven
probe are keyed on the op NAME, not its field set — green unedited.
**19 ✅ (union membership)** `DECK_TOP_REORDERED` gained `end?` and broke NO
exact-shape assertion, *because* the field is optional and absent on the top
path. `derivedReorderTop.test.ts:748/754` green unedited — the mechanism was
predicted, not just the outcome.
**20 ✅ (auditor's pins)** `programWalk`'s missed-op pin unmoved.
**21 ✅ (refusal)** `derivedSearchTopOrder`'s "this deriver does not read Kofu"
rungs stayed true and green.
**22, 23, 25, 26, 27 ✅** every prose claim named as rotting was rotten.
**26 was the sharpest**: `payFromHand`'s "every Trainer in the family says
other/another" is FALSE of Kofu, and was false at the head that wrote it.
**28 ✅** predicted 1–6 biome re-wrap errors against mutant rows; **exactly 4**,
all in `interpreter.ts`'s `reorderTop` arms, all re-anchored and verified to
match exactly once.
**§6 errand ✅ in every clause**, including the second-order warning. The
candidate was named correctly (`revealClause.test.ts:561`), the reason was named
correctly (the loop touches no card text), the tell was named correctly, and the
predicted consequence — "it will very likely surface unclassified real search
ops" — landed at **5 programs / 13 catalog ids**.

## MISSES

**MISS 1 — 🛑 THE BIG ONE. `export const engineVersion` ITSELF.** Claim 8 named
`package.json` and claim 9 named `index.ts`'s DOC BLOCK, and I never named the
CONSTANT. Six suites went red at the full check on the TIE between the constant
and the manifest — aquaWash, chillTeaserToy, fanCall, legacyEnergy, lookForPrey,
tonguePull. **A TIE BETWEEN TWO FILES IS NOT A COUNT AND APPEARS IN NO CENSUS**,
which is precisely the category the standing lesson names. I enumerated four
non-count categories (union membership, partitioned total, auditor's pins,
refusal) and this belongs to a FIFTH I did not have a name for.

**MISS 2 — A SECOND EXACT VERSION PIN, in `derivedSearchTopOrder.test.ts`.** Not
merely unpredicted: it is **D342's own lesson, committed by D342, in the same
commit as the lesson**. Its handoff says a file that pins a version it does not
own reddens for someone else's reason; it converted D341's site to `>=` and wrote
a fresh exact pin in its own file. Converted to `>=`; the exact pin now lives in
`legacyEnergy.test.ts` alone, so a bump touches FOUR sites again.

**MISS 3 — THE CORPUS TOTAL.** §7 asserted `killed + survivors + GAPs = 977`
"corpus unmoved". A slice that adds mutant rows MOVES the corpus by construction:
977 → **985** (8 rows). Claim 15 listed corpus 977 under **U** and that was
simply wrong-headed — the baseline figure and the closing figure are two rungs,
which is the same "a list's length and the sum it sits inside are two rungs"
error D342 made one abstraction up.

**MISS 4 — ONE OF MY OWN MUTANT ROWS WAS EQUIVALENT.**
`D343-reorder-window-bottom-is-off-by-the-window` was written as a correctness
row. ECMA-262 clamps a `slice` start below `-length` to 0, so the clamped and
unclamped expressions are identical on every board. Declared `equivalent` and the
source comment making the same false claim was corrected. **D341's rule — a
mutant's `what` is a claim — applied to a row ONE SLICE old rather than an
inherited one: a `what` can be false on ARRIVAL, not only later.**

**MISS 5 — CLAIM 24, recorded honestly in advance and still a miss.** I wrote
"PARTITIONED TOTAL: none identified — explicitly recorded as the category I could
not find an instance of." I found none because I looked for one shaped like
D342's. The version TIE (miss 1) is the same *kind* of object: a value that
several files must agree on, where naming one holder does not name the agreement.

## SCORE

Counting the numbered claims and their sub-clauses: **51 hits, 5 misses.**

⚠️ **THE SHAPE OF THE MISSES, WHICH IS THE ONLY PART WORTH CARRYING FORWARD.**
Every count-keyed claim landed, again — including all the historically dangerous
ones, and including the unusual prediction that NOTHING in the census would move.
**Four of the five misses are the same object seen four ways: a fact that lives
in the AGREEMENT BETWEEN ARTEFACTS rather than in any one of them** — a constant
tying to a manifest, two files each pinning one number, a baseline total versus a
closing total, and a mutation row's claim versus the language's actual semantics.
D342 lost six on "not a count". D343 lost five on **"not in one place"**.
