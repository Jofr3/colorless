### 2026-08-15 — build session #283 (P3-M5 — D343, Kofu's printed "in any order": `reorderTop` learns the deck's bottom, and the row the work order priced had already shipped)

**Slice D343.** Engine **0.248.0 → 0.249.0**, ONE bump over FOUR sites.
`MATCH_RECORD_VERSION` **STAYS 20**.

⚠️ **THIS SESSION RAN IN TWO HALVES ACROSS A CONTAINER RESTART.** The first half
built the row, wrote the mutant corpus, fixed the errand and bumped the version —
four commits, all pushed. It was killed roughly fifteen minutes into its mutation
sweep, and the sweep and the entire docs close-out died with it. The second half
re-verified the head, re-derived every census figure from source, graded the
prediction, found and repaired one further defect, ran the sweep to completion and
wrote this entry. **The engine work survived because it was committed as it
landed; the sweep did not because it was left for last.** That is the whole
argument for the commit rhythm, stated by the one slice it happened to.

#### 🛑 The row was already built, and the work order did not know

`registry.ts` held `const KOFU` at `5827be3`, wired at `"sv07-138"`, `"sv07-165"`
and `"fix-kofu"`, with a doc block, a demonstrator in `FIXTURE_POOL`, a row in
`legalNonAttackPrograms.test.ts`'s table and two driven tests. D341's resume point
offered it as one of three unbuilt candidates and priced it at 2 legal printings.
**It had shipped.** That is **D330's lesson at its second site**: a backlog row
that names a card is a claim about the tree, and it rots exactly like a count.

What was *not* built is the printed **"in any order"**, and the program dropped it
in silence:

```
{ op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
{ op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 4 }] },
```

**THE TELL WAS IN THE EXISTING TEST, AND IT IS D342's SHAPE EXACTLY.** The suite
asserted the payment landed with
`expect([...tail].sort()).toEqual([...picks].sort())` — it **SORTS**. It asserts a
**SET** where the print demands a **SEQUENCE**. D342 found its two survivors were
"an assertion about a FIELD instead of about a BOARD"; this is the sibling one
abstraction over, and it is why a card that has been green for many slices was
wrong about the only clause this row exists for.

#### The decision: a WINDOW FORK, not a CHANNEL — and two refusals from source

`reorderTop` read and wrote the deck's TOP and could not address the other end
(`interpreter.ts` park `deck.slice(0, n)`, apply `[...choice.uids, ...rest]`). So
D342's search→`deckTop`→`reorderTop` channel was unavailable, and the resume point
recorded "the channel is the board is NOT available here."

🆕 **THAT IS WRONG IN ITS GENERALITY AND RIGHT IN ITS PARTICULARS.** After
`payFromHand{to:"deckBottom"}` the two paid cards **ARE the deck's last two, by
construction** — the same by-construction guarantee that made D342's trick work,
read at the other end. **D342's TRICK IS GENERAL; ITS READER WAS NOT.** The cost
of the row is one window fork, not one channel:

```
{ op: "reorderTop", n: 2, from: "bottom" }
```

placed **inside the existing `recordGate{slot:"paid"}`**, ahead of the draw —
`recordGateHolds` is `filed.length > 0`, so a run that paid nothing never opens an
ordering window over two cards nobody put there.

**TWO CHEAPER OPTIONS WERE REFUSED, AND BOTH REFUSALS ARE READ OUT OF THE SOURCE
RATHER THAN ARGUED FROM TASTE:**

* **REFUSED — let the `chooseCards` answer's ARRAY ORDER be the ordering.**
  Superficially free: `payFromHandApply` already builds `paid` by iterating the
  answer's `uids`, so the order is *incidentally* consumed today. Refused on two
  independent facts. (1) `index.ts`'s D341 block states the doctrine this would
  break — *"every `chooseCards` consumer iterates the answer to MOVE cards, so
  two answers naming the same uids are the same board, and the validator is free
  to treat the array as a set."* A client is **licensed** to reorder that answer.
  (2) `payFromHand` **AUTO-RESOLVES when `candidates.length <= op.count`** — on
  the exactly-two-other-cards board that is the *commonest* Kofu line, **no prompt
  is shown at all** and the cards land in raw hand order. The printed clause is
  not merely unspecified there; it is **ABSENT**. That branch is correct for every
  printing authored before this one and false for this one.
* **REFUSED — a prompt over the HAND, before the move.** It must both SELECT a
  subset and SEQUENCE it. Neither `chooseCards` (subset, no order) nor
  `orderCards` (permutation of the *whole* offer) does both, so it is a **new
  prompt kind** and re-pays D341's entire bill — kind, choice kind, validator,
  redact, zod, projection, two dialogs and the `ONE_PER_KIND` pin. Its cheap
  variant, a second park fed by the `paid` RECORD, is **buying a channel when the
  board is one**, which is the exact thing D342 says to check first.

⚠️ **THE FLOOR/DOMAIN HAZARD IS D342's `exact`, ONE ZONE OVER, WITH A WEAKER
GUARANTEE, AND IT IS WRITTEN DOWN RATHER THAN PAPERED OVER.** `reorderTop{n:2}`'s
domain is 2; `payFromHand`'s floor is `min(handSize, 2)`. They agree only because
`handCostUnmet` refuses the play unless two are payable — **a gate in another
file**, not a property of the op pair. D342's `exact` made its pair
self-sufficient; this one is not.

#### The event, and why a field rather than a second type

`DECK_TOP_REORDERED { seat, actor, count }` gains **`end?: "bottom"`** — OPTIONAL,
absent on every existing construction site. One op with a window fork owes one row
with a window fork (D341's reason for making `side` a field). The optionality is
load-bearing and it is what keeps `derivedReorderTop.test.ts`'s two exact-shape
`toEqual({ type, seat, actor, count })` assertions green **unedited** — a REQUIRED
field would have reddened both.

**The row still fires on the bottom fork**, D241's rule kept unconditional. The
tempting "there is no look, so emit nothing" is refused: it is true of *Kofu* (the
controller put those two cards there themselves, one op earlier) and false of the
*fork* (a future "look at the bottom 3 cards…" is a real look), so gating an EVENT
on `from` would key a confidentiality rule on a window.

`MATCH_RECORD_VERSION` **STAYS 20**: events are rendered into `record.log` rows and
are not themselves persisted, and a new optional op field is registry-side program
vocabulary.

#### 🛑🛑 The errand — the THIRD instance of one defect in three slices

`revealClause.test.ts`'s "SWEEPS `FIXTURE_POOL` for search ops nobody classified —
a DISCOVERED census" swept **the wrong population**, and its own two pins said so
out loud: `classified.size` **39** against `swept.size` **27**, with a comment
explaining the twelve-program gap away as "suites carrying their own local pool."

**THE QUESTION THAT DECIDES IT — DOES THE LOOP NEED PRINTED CARD TEXT?** It does
not. The body calls `programFor(id)` and `searchOps(id)`, both keyed on an **id**,
and never touches a fixture BODY. **So the pool was never the population; it was a
SAMPLE, and a sample that happened to be lying around.**

Repointed at `registryCardIds()` **∪** the pool — the union and not the registry
alone, because the pool holds deliberate demonstrators (`fix-onko`, `fix-pilescan`,
`fix-metallicsignal`) that are not registry ids, and dropping them would be this
same defect wearing the opposite sign.

**MEASURED: `swept.size` 27 → 103, `classified.size` 39 → 44.** The gap was **FIVE
distinct programs spanning THIRTEEN real catalog ids**, every one of them
**already built**, none of them ever tabled, and the sweep green over all of them:

* Fan Rotom `sv07-118`/`sv08.5-085` — an Ability that **PRINTS "reveal them"**
* Hassel `sv06-151`/`sv06-205`
* Buddy-Buddy Poffin `sv05-144`/`sv06-223`/`sv08.5-101`
* Eldegoss `sv07-011` "Breezy Gift"
* Ciphermaniac's Codebreaking `sv05-145`/`sv05-198`/`sv08.5-104`

⚠️ **THE LAST ONE WAS BUILT BY THE SLICE IMMEDIATELY BEFORE THIS ONE**, its own
registry doc block states the very fact the new table row records, and this sweep
stayed green straight through it. The whole cost of the defect in one sentence:
**A DISCOVERED CENSUS THAT CANNOT SEE THE CATALOG DOES NOT FAIL — IT AGREES WITH
YOU.** D341 repaired `preventBlock` §11 (swept the pool, not the deriver); D342
repaired `programWalk` (swept the registry INTERSECTED WITH the pool, hiding 32
real programs); this is the same bug in the auditor whose entire job was to be
TOTAL.

#### The doctrine that repair killed, at all eight sites that stated it

🛑 **AND THE SLICE LEFT ITS OWN CONSEQUENCE STANDING IN SIX FILES.** Five
consecutive slices (D338–D342) had copied one sentence forward — *"nothing enters
`FIXTURE_POOL`, so `swept.size` stands still at 27"*. After the repointing that is
false in the **NUMBER** *and* in the **MECHANISM**: a registry-keyed program is
swept whether or not its suite seats a shared body. Corrected at all eight sites
(`registry.ts` ×2, `derivedReorderTop.test.ts`, `freezingShroud.test.ts` ×2,
`familialMarch.test.ts`, `legalNonAttackPrograms.test.ts`, `lickingCatch.test.ts`),
keeping the half that is still true — the `catalogManifest` six-set rule and
`raw.length`'s two lines staying 0 apart. `preventBlock.test.ts` is deliberately
left alone: it **diagnoses** this defect and its statement is still true history.

⚠️ **AND ONE OF THOSE SITES WAS ROTTEN BEFORE D343 EXISTED** —
`derivedReorderTop.test.ts` also carried `raw.length` (672), which has been
**675** since D342. **NOTHING WENT RED FOR ANY OF IT, AND NOTHING COULD: A NUMBER
IN A COMMENT IS NOT A RUNG.**

#### The census — and the unusual thing about it

**NOT ONE `BUILT.*` COLUMN MOVED, AND THAT IS THE SLICE'S DEFINING FEATURE.** Kofu
was already counted, so this row builds no new printing. Re-derived from source at
the closing head rather than inherited:

| rung | value | |
|---|---|---|
| `BUILT.attack` | **1198** (1169 raw / 16 registry / 13 split) | unmoved |
| `BUILT.ability` / `.trainer` / `.specialEnergy` | **252** / **108** / **8** | unmoved |
| `built` | **1566** (1198+252+108+8, re-added from the parts) | unmoved |
| residue `units − built` | **817** (2383−1566) | unmoved |
| `unbuiltAttack` | **534** (1732−1198) | unmoved |
| `raw.length` / `nonAttackRegistryIds` | **675** / **531** | unmoved |
| `units` / `TRAINER_TERMS` / `DROPPED` | **2383** / **57** / **2** | unmoved |
| `MATCH_RECORD_VERSION` | **20** | unmoved |
| `classified.size` / `swept.size` | 39 → **44** / 27 → **103** | **MOVED — by the errand, not the build** |
| `REVEALING` / `NOT_REVEALING` | 28 → **29** / 11 → **15** | **MOVED** |
| mutation corpus | 977 → **985** | **MOVED — 8 rows** |
| `bun run check` | **352 files / 7,215 tests** | files unmoved, tests +1 |

#### The prediction, graded — 52 hits, 6 misses

Every count-keyed claim landed **again**, including the unusual prediction that
nothing in the census would move, and including all the historically dangerous
ones. The misses:

1. 🛑 **`export const engineVersion` ITSELF.** The prediction named `package.json`
   and named `index.ts`'s DOC BLOCK and never named the CONSTANT. Six suites went
   red at the full check on the **TIE** between the constant and the manifest.
   **A TIE BETWEEN TWO FILES IS NOT A COUNT AND APPEARS IN NO CENSUS.**
2. **A SECOND EXACT VERSION PIN**, in `derivedSearchTopOrder.test.ts` — and this
   is **D342's own lesson, committed by D342, in the same commit as the lesson**.
   Converted to `>=`; the exact pin now lives in `legacyEnergy.test.ts` alone.
3. **THE CORPUS TOTAL.** §7 asserted `killed + survivors + GAPs = 977`, "corpus
   unmoved". A slice that adds mutant rows moves the corpus **by construction**:
   977 → **985**. The baseline figure and the closing figure are two rungs.
4. **ONE OF ITS OWN MUTANT ROWS WAS EQUIVALENT.**
   `D343-reorder-window-bottom-is-off-by-the-window` was written as a correctness
   row; ECMA-262 clamps a `slice` start below `-length` to 0, so the clamped and
   unclamped expressions are identical on every board. Declared `equivalent` and
   the source comment making the same false claim corrected. **D341's rule — a
   mutant's `what` is a claim — applied to a row ONE SLICE old: a `what` can be
   false on ARRIVAL, not only later.**
5. **THE "PARTITIONED TOTAL" CATEGORY**, recorded in advance as the one no
   instance could be found for, and still a miss: the version TIE is the same
   *kind* of object.
6. 🆕 **CLAIM 14, WHICH THE MID-FLIGHT SELF-GRADE SCORED IN NEITHER COLUMN.** It
   listed `classified.size` 39 and `swept.size` 27 as **UNMOVED**, while **§6 of
   the same document promised to move exactly those two numbers**. Scoring §6 a
   hit falsifies §5b claim 14, and the grade did the first without noticing the
   second. **An incomplete enumeration is a miss, and a document that contradicts
   itself has already made one.**

⚠️ **THE SHAPE OF THE MISSES IS THE ONLY PART WORTH CARRYING FORWARD.** Five of
the six are one object seen five ways: **a fact that lives in the AGREEMENT
BETWEEN ARTEFACTS rather than in any one of them** — a constant tying to a
manifest, two files each pinning one number, a baseline total against a closing
total, a mutation row's claim against the language's semantics, and two sections
of one prediction against each other. **D342 lost six on "not a count". D343 lost
six on "not in one place".**

#### Mutation

Corpus **977 → 985** (8 D343 rows: the reader's fork, the window's clamp
[EQUIVALENT], the apply splice, the apply order, the caption, the event field, and
the registry program's two ways of losing the ordering). Four `bunx biome`
re-wraps against existing rows were re-anchored and each `find` verified to match
exactly once. Full sweep: ****964 killed · 21 known survivors · 0 GAPs · 0 stale · 0 skipped(dirty) · 0 clobbers · 0 errors**, 3,191.3s. **`964 + 21 + 0 = 985` ✅ = the corpus**, and the delta reconciles EXACTLY against this slice's 8 rows: killed **957 → 964** (+7, the correctness rows) and known survivors **20 → 21** (+1, the one declared EQUIVALENT after its own claim was measured false). **ZERO baseline errors** — the four `bunx biome` re-wraps were re-anchored correctly and every `find` still matches exactly once.**

#### Commits

* `5908858` feat(engine): Kofu's printed "in any order" — `reorderTop` learns the deck's BOTTOM
* `f1f7d9d` test(mutation): 8 D343 rows for the bottom fork — one declared EQUIVALENT after its own claim was measured false
* `58bae6c` fix(test): `revealClause`'s DISCOVERED census could not see the catalog — the THIRD instance of one defect in three slices
* `e9dfd05` chore(engine): `engineVersion` 0.249.0 at all four sites
* `cca6e8b` fix(docs): the `FIXTURE_POOL` doctrine D343 killed, at all eight sites that state it
* `(this commit)` docs: D343, the header stamp, the status row, session #283 and a REWRITTEN resume point
