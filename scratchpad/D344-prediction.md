# D344 — PREDICTION, written BEFORE any source edit (head 18835cd)

## THE ROW — Deduction Kit `sv08-171`, ACCEPTED (not refused)

Grepped first (D343's warning): `sv08-171` appears at 11 sites and **every one is
prose** — `index.ts` version blocks, `effects.ts` anchor docs,
`derivedReorderTop.test.ts` / `derivedSearchTopOrder.test.ts` notes,
`censusAtHead.test.ts` row 11 `effectIds`, `mutants.ts` `what` strings. **No
registry row, no program, no id map entry.** The row is genuinely unbuilt.

## FAMILY CENSUS, RE-DERIVED FROM REMOTE D1 `luminous` (2026-08-15)

`instr(<col>,'in any order') > 0` over all three text columns:
**15 printings / 11 legal / 7 distinct sentences** — the inherited pair CONFIRMED.
Split: `effect` 8/6, `attacks_json` 7/5, `abilities_json` 0/0 — also confirmed.

The seven sentences, and the BUILT set re-counted from `registry.ts` + `effects.ts`:
1. `Look at the top 4 cards of your deck and put them back in any order.` — Iron Valiant (1 legal) — **BUILT** (D341, `ATTACK_REORDER_TOP`)
2. `…top 5 cards of your opponent's deck…` — Dottler + Gothorita ×2 (3 legal) — **BUILT** (D341)
3. `Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.` — Ciphermaniac ×3 + Dialga (4 legal) — **BUILT** (D342)
4. `Put 2 cards from your hand on the bottom of your deck in any order. …` — Kofu ×2 (2 legal) — **BUILT** (D343)
5. `Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.` — Deduction Kit (1 legal) — **UNBUILT, this row**
6. `Look at the top 5 cards of your deck and discard any number of them. Put the other cards back in any order.` — Raifort ×2 (**0 legal**)
7. `Look at the top 3 cards of either player's deck and put them back in any order.` — Absol ex ×2 (**0 legal**)

🛑 **THE INHERITED "five of seven BUILT" IS WRONG: IT IS FOUR OF SEVEN.** The
resume point flagged it as unreconciled and it does not reconcile because it is
one too many. Correct statement: **four of seven sentences built; of the FIVE
sentences with any legal printing, four are built and Deduction Kit is the
fifth.** After this slice: **five of seven, and EVERY LEGAL SENTENCE IN THE
FAMILY IS BUILT — the family closes on Standard.** The two survivors are both
`legal_standard = 0` and buy nothing.

## THE PRICE, RE-DERIVED — AND THE FINDING IS THAT THE PROMPT KIND WAS ALREADY SETTLED

The work order prices the `or` as "the print settles neither a caption nor a
prompt kind". Measured against the source, **the KIND half is already paid and
the CAPTION half is the whole bill** — but not by the op the cheap reading
reaches for.

* **`optional { note, then, otherwise }` (D186/D316) is a two-armed branch on a
  human answer and it is REFUSED here.** Its `confirm` park carries NO
  candidates (`{kind, note}` is the whole wire arm), and the print puts the LOOK
  **before** the `or`: *"**Look at the top 3 cards** of your deck **and** put
  them back in any order, **or** shuffle them…"*. A `confirm` ahead of the
  ordering park would make the player choose **BLIND**. That is not a caption
  difference, it is the loss of the information the sentence hands over first.
* **The prompt that asks the `or` must therefore be the prompt that DELIVERS the
  look**, which is `orderCards` (D341) — the only prompt whose `candidates` are
  the window and whose `redactPrompt` arm resolves them to the answerer alone.
* **And `confirm`'s own doc already settles the MEANING** — *"a confirm answer
  means run `then` … a fact about the program"* — so a binary answer that picks
  between two printed arms needs no new KIND anywhere. What `orderCards` lacks
  is a way to SAY the second arm, and that is a caption plus a splice.

**THE ANSWER SHAPE: the EMPTY ordering.** `{kind:"orderCards", uids: []}` is
illegal today (the validator demands a permutation of a ≥2 candidate list). It
is made legal EXACTLY when the prompt carries an alternative, and it means what
it reads: **none of these cards is being put back on top.** No new choice kind,
no new wire member, no `ONE_PER_KIND` row.

**AND `applyChoice` NEEDS NO ARM**: with `uids: []` both existing splices reduce
to the identity (`[...[], ...deck.slice(0)]` and `[...deck.slice(0,len), ...[]]`),
so the whole of arm B is the `continuationOps` splice.

### The bill

| piece | count |
|---|---|
| new `EffectOp` | **1** — `bottomDeckTop { n }` (shuffle the top `n`, append to the bottom) |
| new optional op fields on `reorderTop` | **2** — `otherwise?: EffectOp[]`, `otherwiseNote?: string` |
| new optional `EffectPrompt` field | **1** — `orderCards.alt?: string` |
| new prompt kinds / choice kinds / `validateChoice` arms | **0 / 0 / 0** (one widening inside the existing `orderCards` arm) |
| new `continuationOps` member | **1** — `reorderTop`, the FIFTH |
| new `GameEvent` + `log.ts` row | **1 + 1** — `DECK_TOP_TO_BOTTOM { seat, count }`, count-only |
| wire schema | 1 optional string on the `orderCards` member |
| dialogs | 2 (GameHud + OnlineHud) — one extra button each |
| registry | 1 `CardProgram` + 1 id map row |
| `MATCH_RECORD_VERSION` | **STAYS 20** — optional op fields are registry-side vocabulary (D343's precedent verbatim); the prompt's `alt` is an ADDED OPTIONAL FIELD on a persisted union (D125 widening, D342's precedent); events are rendered into `record.log` and are not persisted |

🛑 **`otherwise` IS A FLAT `EffectOp[]` AND THAT IS A CORRECTNESS CHOICE, NOT A
STYLE ONE.** `subPrograms` (testFixtures.ts) is a NEGATIVE predicate over an
op's **own array-valued properties**; a nested `{ note, ops }` object would be
invisible to `walkProgram` and would open a fourth instance of the
"auditor with the wrong population" defect the last three slices each repaired.
Its own doc names this exact hazard.

⚠️ **THE M1 GUARD NEEDS NO CHANGE AND THAT IS ARITHMETIC.** `top.length =
min(n, deck.length)`, so for any `n ≥ 2` the existing `top.length < 2` refusal is
*exactly* "the two arms are the same state": at `deck.length ≤ 1` arm B moves a
0- or 1-card deck onto the bottom of nothing. The one board that separates them
is `n === 1` with a long deck, which no printing spells.

## PREDICTED CENSUS MOVEMENT

### MOVED
| figure | 18835cd | predicted |
|---|---|---|
| `BUILT.trainer` | 108 | **109** (+1 legal printing, 1 card) |
| `built` | 1566 | **1567** (1198 + 252 = 1450, + 109 = 1559, + 8 = 1567) |
| `units - built` (residue) | 817 | **816** (2383 − 1567) |
| `raw.length` (registry keys) | 675 | **676** (+1 real catalog id, **no `fix-*` key** — the suite drives a LOCAL `cardPool`, D275's idiom, because `sv08` is not one of `catalogManifest`'s six sets) |
| `nonAttackRegistryIds().length` | 531 | **532** |
| `BUILT.ability + BUILT.trainer + BUILT.specialEnergy + CENSUS_NOT_LEGAL.length` | 531 | **532** (D342's named miss — the pool TOTAL is a second rung on the same +1) |
| `CENSUS_TRAINER_LEGAL.length` | — | **+1** |
| `TRAINER_TERMS.length` | 57 | **58** (+1 CARD carrying +1 printing — the two step by the SAME amount for the first time since D330, because this card has ONE printing) |
| censusAtHead row 11 `effectIds` | `["sv08-171"]` | **`[]` — THE ROW'S TRAINER COLUMN CLOSES** |
| `programWalk.test.ts` carrier pin | 4 entries | **5** — gains `["reorderTop", ["otherwise"]]`, the FIFTH branching op and the first that is not a gate |
| `enumeratedTotal` / `structuralTotal` | >900 | grows; the `missed` pin gains `sv08-171 trainer :: bottomDeckTop` (the enumerated walk knows no `reorderTop`) |
| engineVersion | 0.249.0 | **0.250.0** |
| check | 352 files / 7,215 tests | **353 / ~7,245** |
| mutation corpus | 985 | **985 + new rows** |

### MEASURED UNMOVED (each with its reason, not an assumption)
| figure | why it cannot move |
|---|---|
| `BUILT.attack` 1198 (raw 1169 / registry 16 / split 13) | `sv08-171` is `attacks_json IS NULL` (D1, this session) — no attack reader can see it |
| `BUILT.ability` 252 | `abilities_json IS NULL` (D1, this session) |
| `BUILT.specialEnergy` 8 | `category = 'Trainer'`, `trainer_type = 'Item'` (D1, this session) |
| `unbuiltAttack` 534 | no attack-column sentence is read or authored |
| `units` 2383 | the denominator; nothing is ingested |
| `MATCH_RECORD_VERSION` 20 | see the bill — no new persisted literal, no required field |
| `REVEALING` 29 / `NOT_REVEALING` 15 / `classified.size` 44 / `swept.size` 103 | `searchOps()` collects **only** `searchDeck` and `lookAtTopN`; Deduction Kit's program is `reorderTop` + `bottomDeckTop` and enters the sweep's `continue` on its first line. The population (registry ∪ pool) DOES gain `sv08-171`; the SWEEP does not. |
| `DROPPED` 2 | Deduction Kit is not a `DROPPED` row; it is a census row-11 `effectIds` entry |
| `ONE_PER_KIND` (OnlineHud.chooseAttack.dom.test.tsx) | no new `RedactedEffectPrompt` kind |
| `MAX_PRINTED_LOOK_WINDOW` | `n = 3` is inside it |

### PROSE SITES I EXPECT TO FALSIFY (grep them all — D343's finding)
* every site claiming Deduction Kit is UNBUILT / the residue of row 11
* every site claiming `reorderTop`'s window has no printed alternative
* every site claiming the `$` anchors refuse Deduction Kit *"and that refusal is
  load-bearing"* — still TRUE (the deriver must not read it; the registry does)
* `attack.ts`'s two comments quoting the carrier pin as `["optional", ["then"]]`
  — already stale at HEAD, and my pin edit sits three lines away
* the "five of seven built" clause wherever it was copied

## GRADING TARGET
Every row above is a claim. Misses to be named at the end, including any figure
that moves and is not on this page.
