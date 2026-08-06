# Simulator coverage — the STANDARD-LEGAL census (D219 re-measurement, 2026-08-04)

> # 🛑 THE HEADLINE BELOW IS SUPERSEDED — JUMP TO §"THE D233 RE-DERIVATION AT HEAD"
>
> Everything from here to the numbered backlog table was measured at **`02b839c`**
> (session #161). **Eight slices landed after it and rows 1-8 are all struck
> through.** The census was re-run at HEAD on **2026-08-06** (D233) and the current
> figures are **1,215 built / 1,168 unbuilt of 2,383** (D233 measured 1,174 /
> 1,209; **D234 read 12 attack printings off row 9, D235 read 20 off row 10 and
> D236 read 9 off row 12**), with **rows 9-16** and the
> SQL behind every one of them in §"THE D233 RE-DERIVATION AT HEAD".
>
> ✅ **KEEP READING THIS PART ANYWAY** — the D233 sweep re-ran the same method in a
> detached worktree at `02b839c` and reproduced **922 built** and the **640 / 1,732 /
> 60,467** round-trip triple exactly, so the METHOD below is sound and the
> DENOMINATORS have not moved since D187. It is only the built/unbuilt split that
> is eight slices stale.

> ## ⚠️ READ THIS BLOCK BEFORE QUOTING ANY NUMBER IN THIS FILE
>
> | | |
> |---|---|
> | **Population** | `legal_standard = 1` — **2,021 rows** over **18 sets** (of 20 in the catalog). Re-derived, unchanged from D187. |
> | **What that predicate means** | Regulation mark **H** + **I** + unmarked Basic Energy + the one `sv04-266` anomaly |
> | **Text units** | **2,383** = attack 1,732 · ability 376 · Trainer 264 · Special Energy 11. Re-derived, unchanged from D187. |
> | **Measured against** | **REMOTE Cloudflare D1** `luminous`, `database_id 735f0fb5-cdc3-494d-8b97-74a8ade0124a`, queried live over MCP on **2026-08-04** |
> | **Engine seam** | repo commit **`02b839c`**, engine **0.135.0**, measured in a **detached throwaway worktree** at that commit |
> | **Query dialect** | Every text predicate in this file uses **`GLOB`** (case-SENSITIVE) unless a row explicitly says `LIKE`. `LIKE` is case-insensitive in SQLite and has produced wrong rows in this file before — see §"What D187 got WRONG". |
>
> **⚠️ THIS FILE MEASURES A MOVING TREE AND PINS IT.** At measurement time two
> sibling agents were writing `packages/engine/src/**` (D216) and `src/**`
> (D217). Every engine figure below is measured at **`02b839c`** in a separate
> worktree, never against the dirty checkout. **In-flight work may already have
> moved the built column upward.** Re-run the sweep (§Method) before trusting the
> attack row; the ability/Trainer rows move only when `registry.ts` does.
>
> **The local `.wrangler` D1 now EXISTS and is EMPTY.** D187 recorded it absent;
> at `02b839c` `apps/api/.wrangler/.../*.sqlite` is present with a `cards` table
> holding **0 rows**. It is still not a usable source — the remote is the only one.

## Method — the built set was DERIVED by running the engine (D187's method, restated)

D187's method, reproduced so the numbers are comparable:

* **Three columns are the whole printed surface**, re-verified at `02b839c`:
  `attacks_json[].effect`, `abilities_json[].effect`, `effect`. Measured on the
  legal pool: **0** Pokémon rows carry a top-level `effect`; **0** rows carry
  more than one Ability (so an ability's coverage is exactly its card's);
  **36 of 47** legal Energy rows are Basic Energy with no `effect`.
* **A "printing" is a TEXT UNIT, not a card.**
* **BUILT for attacks** = `programFor(id)?.attack?.[index]` **OR** any text
  deriver returning non-null for the **exact printed string**. The **640
  distinct** legal attack strings were pulled from D1 and fed to the real
  exported functions by a `bun` script in the worktree.
* **BUILT for abilities** = a registry `abilities`/`passive`/`triggered`/
  `stadium`/`energy` entry; **for Trainers / Special Energy** = a registry
  `trainer`/`stadium`/`rareCandy`/`passive`/`triggered`/`energy` entry. **There
  is still no deriver for either.** The registry's ids were extracted from
  `registry.ts` and classified by calling `programFor(id)` on each, then joined
  against D1 by id.
* **Round-trip integrity check.** The 640 strings re-measure locally at
  **640 unique / 60,467 characters**, byte-for-byte the `COUNT(*)`/`SUM(LENGTH(t))`
  D1 reports for the same query. The distinct-string ordinal mapping used to turn
  sentence coverage into printing coverage was **spot-checked against D1 at six
  ordinals** (1, 38, 99, 213, 631, 640) on both length and prefix.
* **Two independent paths agree on the attack total.** A local sum over ordinals
  and an independent D1 `GROUP BY set_id` both return **922 built / 810 unbuilt**.

### ⚠️ THE METHOD HAS DRIFTED SINCE D187 — IN TWO PLACES

**1. There are SEVEN derivers now, not six.** D187 ran six. `packages/engine/src/effects.ts`
at `02b839c` exports a seventh, **`deriveAttackDamageSuppression`**, added by
**D192** (commit `faf1c4f`). All seven are exported from `index.ts`.

| D187's six | Added since |
|---|---|
| `deriveAttackEffect` · `deriveAttackDamageBonus` · `deriveAttackDamagePenalty` · `deriveAttackDamageMultiplier` · `deriveAttackCoinFlip` · `deriveAttackRequirement` | **`deriveAttackDamageSuppression`** (D192) |

**2. D187's shortcut "built attack = derived attack" is now FALSE.** D187 could
write it because *zero* registry-authored attacks were Standard-legal. At
`02b839c` **four legal ids carry a registry `attack` program** — `sv09-068#0`
(Lillie's Comfey), `sv10-050#0` and `sv10-194#0` (Misty's Lapras), `sv10-083#0`
(Steven's Baltoy). **None of the four texts is derivable** (all carry an
owner-prefix filter), so a pure deriver sweep undercounts by 4. The
`programFor(id)?.attack?.[index]` read is now load-bearing and must be
**index-precise**: each of those programs authors index 0 only, and
`sv09-068` has a second attack at index 1 that is *not* built. Marking a whole
id built instead of a single index inflated an intermediate result here by 1
before it was caught.

**Both a like-for-like and a corrected figure are reported below.**

## Result — the new headline, with D187's delta

**Population: 2,021 legal rows / 2,383 text units. Legality: `legal_standard = 1`.
Commit `02b839c`, engine 0.135.0.**

| | Units | Built (D187) | **Built (now)** | Unbuilt (D187) | **UNBUILT (now)** |
|---|---:|---:|---:|---:|---:|
| attack effect text | 1,732 | 806 | **922** | 926 | **810** |
| ability text | 376 | 3 | **77** | 373 | **299** |
| Trainer effect text | 264 | 3 | **48** | 261 | **216** |
| Special Energy effect text | 11 | 0 | **2** | 11 | **9** |
| **total** | **2,383** | **812** | **1,049** | **1,571** | **1,334** |

**The denominators did not move.** Every population figure re-derived to exactly
D187's value (2,021 / 1,732 / 376 / 264 / 11 / 640 distinct / 60,467 chars), so
**all 237 units of movement are real coverage, not catalog churn.**

### Where the +116 attack printings came from

| Source | Printings |
|---|---:|
| new arms on **D187's original six** derivers (D181, D193, D196, D200, D202, …) | **+78** |
| the **new seventh** deriver `deriveAttackDamageSuppression` (D192) | **+34** |
| **registry `attack` programs on legal ids** — a seam that was empty at D187 (D199) | **+4** |
| **total** | **+116** |

* **Like-for-like (D187's exact method: its six derivers + the registry attack read): 888 built / 844 unbuilt.**
* **Corrected (all seven derivers + the registry attack read): 922 built / 810 unbuilt.**

The suppression deriver's 34 printings are exactly the four sentences D187
priced as "main-hit suppression, 34 attack printings" — measured, not assumed:
*"…isn't affected by any effects on your opponent's Active Pokémon."* (15),
*"…isn't affected by Resistance."* (9), *"…isn't affected by Weakness or
Resistance, or by any effects…"* (8), *"…isn't affected by Weakness or
Resistance."* (2).

### The other two headline numbers

| | D187 | **Now** |
|---|---:|---:|
| distinct unbuilt sentences (union over the three columns) | 784 | **697** |
| ↳ attack / ability / Trainer+SE | 464 / 166 / 157 | **431 / 139 / 130** |
| legal cards carrying ≥1 unbuilt unit (of 2,021) | 1,363 | **1,212** |

697 = 431 + 139 + 130 − **3** strings printed in two different columns (measured
by `INTERSECT`, not assumed; the ability↔Trainer overlap is **0**).

## ⭐ THE NUMBER THAT REPLACES "6 of 651 / 0.9 %"

D187's most-quoted finding was *"only 6 of 651 Standard-legal Ability/Trainer/
Special-Energy printings are built — 0.9 %"*. **It is stale.**

> ⚠️ **STALE BY 8 SINCE D221 (2026-08-05) — the figure below is `02b839c`'s and
> Teal Mask Ogerpon ex's 8 ability printings landed after it: read it as
> **135 of 651, 20.7 %**. Corrected here rather than rewritten in place, because
> the whole point of the block above is that a number without its measurement
> commit is not a fact.
>
> ## **127 of 651 — 19.5 %**
> **Population:** the 651 non-attack legal text units (376 ability + 264 Trainer
> + 11 Special Energy). **Legality:** `legal_standard = 1`. **Built** = a
> registry program on the card's id with a matching surface, via `programFor`.
> Breakdown: **ability 77/376 (20.5 %)** · **Trainer 48/264 (18.2 %)** ·
> **Special Energy 2/11 (18.2 %)**.

That is a **21×** improvement, and it is the single largest change in this file.
It came from the registry growing from **178 ids to 350** (294 real card ids +
56 synthetic/`fix-` keys) across D190, D199, D204–D208.

⚠️ **What would make this figure wrong:** it counts a registry row as built if
`programFor(id)` exposes a surface of the right kind. It does **not** assert the
program is *behaviourally correct*, and no test was run here to check that. If a
row exists but its ops are wrong, this number is optimistic. **It is a coverage
figure, not a correctness figure** — the same caveat D187 flagged and never
retired.

## Per-set breakdown

Sets with legal rows carrying rules text. `mfb`, `sv01`, `sv02`, `sv03`,
`sv03.5`, `sve` contribute legal rows but **every one is a Basic Energy with no
rules text** (re-verified: 0 text units in all six). `sv04.5` and `swsh10.5` have
**0 legal rows**.

| Set | Attack units | Attack unbuilt | Ability (unbuilt/units) | Trainer (unbuilt/units) | SE |
|---|---:|---:|---:|---:|---:|
| `sv10` | 214 | **115** | 37/50 | 23/32 | 1/1 |
| `sv08` | 234 | **115** | 25/39 | 39/43 | 1/1 |
| `sv06` | 215 | **102** | 41/45 | 35/37 | 2/2 |
| `sv05` | 197 | **89** | 29/37 | 26/29 | 2/2 |
| `sv10.5w` | 149 | **77** | 17/22 | 8/10 | 1/1 |
| `sv10.5b` | 160 | **72** | 23/27 | 6/9 | 1/1 |
| `sv08.5` | 107 | **55** | 31/37 | 31/42 | — |
| `sv07` | 131 | **54** | 21/24 | 16/21 | — |
| `sv09` | 140 | **52** | 23/37 | 16/19 | 0/2 |
| `svp` | 99 | **46** | 30/33 | 5/5 | — |
| `sv06.5` | 86 | **33** | 22/25 | 11/17 | — |
| `sv04` | — | — | — | — | 1/1 (`sv04-266` Reversal Energy) |
| **total** | **1,732** | **810** | **299/376** | **216/264** | **9/11** |

## ⚠️ TIER 0 IS EXHAUSTED — D187's cheapest tier no longer exists

D187's Tier 0 was **22 printings for 9 registry map entries and no code**, its
best ratio by an order of magnitude. **Re-running its equality sweep at
`02b839c` returns ZERO rows.**

The sweep: every legal **unbuilt** non-attack unit whose text is byte-identical
to text already authored on a registry id, across all three columns. Result:
**empty**. Re-running the same sweep *without* the unbuilt filter returns **25
printings, and every one of their ids is in the built set** — D190 landed exactly
this work (its commit claims "3 registry programs + 22 alias printings").

**There is no remaining zero-code alias win in the Standard pool.** Anything
cheaper than "one registry program" is gone. This is the most important
structural change since D187 and it invalidates D187's §"The five to build next"
row 1 outright.

---

# The remaining backlog, ranked CHEAPEST-FIRST by LEGAL PRINTINGS PER EDIT

Replaces D187's tiers. Every count is **legal unbuilt printings at `02b839c`**,
measured. "Edits" is regex arms + union members + registry programs — an
estimate, and flagged as such.

> ✅ **ROW 1 IS BUILT (D221, 2026-08-05) — struck through rather than deleted, so
> the estimate stays legible beside what it cost.** It is also this table's first
> demonstration of the **PRICING LESSON two sections down**: the *"zero engine
> code"* column was the census speaking about an engine it had not re-read, and
> the slice that finally took the row paid **two optional op fields** for it.
> ⚠️ **The 8 printings still moved as predicted** — the estimate was wrong about
> the COST, not about the YIELD. **The non-attack built figure below (127 of 651,
> 19.5 %) is therefore STALE BY 8 as of D221: it is 135 of 651, 20.7 %.**
> Every other number in this file is still measured at `02b839c`.

> ✅ **AND THE OWNER-PREFIX WORK ORDER'S CHEAPEST ROW IS BUILT (D224, 2026-08-05)** —
> Team Rocket's Proton (`sv10-177`/`-227`, **2 legal**), which was never in this
> table: it lives in `ownerPrefix.test.ts`'s `DROPPED` list, whose remaining total
> falls **10 → 8** legal printings. It cost **one registry object and zero engine
> code**, because D223's `trainerFirstTurnExempt` and D200's `ownerPokemon` filter
> both already existed — *an engine piece transfers across cards; a registry row
> does not*, in the direction that pays. **The non-attack built figure is
> therefore STALE BY 2 on top of the note above: 144 of 651, 22.1 %.**

> ✅ **AND D190's `DROPPED` TABLE IS NOW EMPTY (D226, 2026-08-05).** N's Plan
> (`sv10.5b-083`/`-163`/`-170`, **3 legal**) was the last of the four the D190
> census over-priced, and all four are built: **18 printings, four predictions,
> every one correct TO THE FIELD.** Two of the four under-priced in the same
> direction — right about the field, silent about its READ SITES (D222's
> `programPlayable` gate, D223's two HUD mirrors) — so N's Plan was priced against
> its readers up front and the grep still turned up a third client site the row had
> not named. **A `needs` string prices a FIELD; a slice pays for its READ SITES,
> and the only way to know them is to grep.** **The non-attack built figure is
> therefore STALE BY 5 in total: 147 of 651, 22.6 %.**

| # | Family | Legal unbuilt printings | Edit estimate | Printings/edit | Notes |
|---:|---|---:|---|---:|---|
| ~~**1**~~ | ~~**Teal Mask Ogerpon ex** ability~~ — ✅ **BUILT at D221** | ~~8~~ | ~~1 registry program. Zero engine code.~~ **1 program + TWO op fields** | — | ⚠️ **THE "ZERO ENGINE CODE" PRICE WAS WRONG AND D190 HAD ALREADY SAID SO.** *"Every op (`attachEnergyFrom`, §9.2 `recordAs`/`recordGate`, `drawCards`) exists"* — **two of them did not**: `attachEnergyFrom` had no SELF target (its riders all name a CLASS, and *"this Pokémon"* is a UID question) and no `recordAs` slot (so the §9.2 gate had nothing to read). Both landed at D221 with the row; see `tealDance.test.ts` |
| ~~**2**~~ | ~~**Carmine** Trainer~~ — ✅ **BUILT at D223** | ~~4~~ | ~~1 registry program~~ **1 program + 1 `CardProgram` field, read at THREE sites** | — | 🛑 **THE `Notes` CELL THIS ROW USED TO CARRY WAS FLATLY FALSE**: *"the first-turn clause is **inert** — no going-first Supporter lock exists to lift"*. The lock has existed since M4 (`cardplay.ts` returns `FIRST_TURN_SUPPORTER` on `state.turn === 1`), so the program alone would have REFUSED the card on the one turn it is printed for. `trainerFirstTurnExempt` landed at D223 — and its price was not the field but its **read sites**: the engine gate **plus both HUD row-lighting mirrors** (`redact.ts`, `GameHud.tsx`). See `carmine.test.ts` |
| ~~**3**~~ | ~~**N's Plan** Trainer~~ — ✅ **BUILT at D226** · ~~**Iono's Kilowattrel** ability — ✅ **BUILT at D222**~~ | ~~3~~ + ~~3~~ | ~~1 program each~~ **1 program + 1 op field + 1 prompt field, read at FIVE sites** | — | ✅ **THE ONLY ROW OF THE FOUR WHOSE PRICE THE `Notes` CELL GOT RIGHT** — it said *wire-validator change, not just an op change*, and that is exactly what it was. `moveEnergy.anySource` rides the OP **and** the PROMPT, because the validator, the wire schema, `redact.ts`, `projection.ts` and BOTH HUD dialogs read the prompt and never the op. ⚠️ **AND THE GREP STILL FOUND ONE MORE THAN THE ROW NAMED**: `projection.ts`'s wire→engine rebuild, whose own doc promises the round-trip is exact. **Both HUDs lose their source STAGE** — it filters the Energy list to one host, so keeping it would leave the printed answer unbuildable. See `nsPlan.test.ts`. ~~`svp-182`, `sv09-055`/`-163`~~ |
| ~~**4**~~ | ~~**Opponent-chooses SWITCH-OUT** in attack text~~ — ✅ **BUILT at D227** (13 of 14) | ~~14~~ **13** | ~~~4 regex arms + 1 op~~ **3 arms + 1 op + 1 `parkOrForce` parameter** | **3.25** | 🛑 **THE `needs` CELL WAS HALF WRONG IN THE CHEAP DIRECTION — the FOURTH on this branch to misprice.** *"Cross-seat machinery exists"* ✅; *"the op … does not"* ✅; **"the HUD offer does not" ❌ — it cost ZERO client lines**: `choosePokemon` is already dialoged on both surfaces, `acting` follows `waitingSeat`, and `redactedRefOf` carries an ABSOLUTE seat, so the answerer sees their own bodies unbadged. What the cell missed is that **`parkOrForce` had no `decider` channel** (the only prior cross-seat park hand-builds its own). ⚠️ **AND THE FOURTH ARM IS NOT AN ARM**: Grimmsnarl `sv07-096`'s damage rider is a SECOND §8.5 hit on a body that is not the captured defender, which lives in `attack.ts` in front of the interpreter — priced separately below. See `derivedOpponentSwitchOut.test.ts` |
| ~~**5**~~ | ~~**`moveEnergy` self → Bench** in attack text~~ — ✅ **BUILT at D229** (13 of 16) | ~~19~~ **16** | ~~~7 arms + 1 route value~~ **2 anchors + 1 route value** | **6.5** | 🛑 **THE FIRST ROW ON THIS PAGE TO MISPRICE IN THE *EXPENSIVE* DIRECTION, AND IT DID SO IN BOTH HALVES.** Its **19** has no population behind it — re-derived over `json_each(attacks_json)` + `GLOB` on 2026-08-05, the family is **16 legal printings over five sentences** (a three-column sweep returns ZERO ability and ZERO Trainer rows, which is also the fact the route's *"sources are the Active"* reading rests on: §8 lets only the Active attack). Its **~7 arms** is **2**: the numeric and article forms are ONE alternation (`ATTACK_DRAW`'s precedent — the absent capture group IS `max: 1`), and the two *"Move **all** Energy …"* sentences (3 legal) are **not arms at all**, deferred on `max` rather than on the endpoints — *"all"* has no static number a deriver can write and *"in any way you like"* wants the DESTINATION-side mirror of D226's `anySource`. ⚠️ **AN EDIT ESTIMATE IS A CLAIM EXACTLY AS A COUNT IS**, and this page has now been wrong about one four times cheap (D199, D221, D227, D228) and once expensive. The row's ONE true sentence was *"mirror of the built `benchToActive` route"* — which is the whole implementation: no new op, no new op FIELD, no wire/schema/client diff. See `derivedSelfEnergyMove.test.ts` |
| ~~**6**~~ | ~~**Deck-search → Bench** in attack text, no new filter~~ — ✅ **BUILT at D230** (20 of 25) | ~~22~~ **25** | ~~~9 arms~~ **1 anchor** | **20.0** | 🛑 **THE SECOND ROW RUNNING TO MISPRICE IN BOTH DIRECTIONS AT ONCE, AND THE WORST ARM ESTIMATE ON THIS PAGE.** Its **22** has no population behind it — re-derived over `json_each` + `GLOB` on 2026-08-05 and **grouped BY SENTENCE**, the attack column holds **25 legal printings over 12 distinct sentences**. Its **~9 arms** is **ONE**: every one of those sentences is the SAME sentence with a different noun phrase and a different number, so the noun is two capture groups (a literal `Basic Pokémon` alternative and a single-capitalised-word NAME) and the count is a third. **Nine "arms" was nine NOUNS.** ⚠️ **AND THE 25 IS THE SECOND FIGURE THE SLICE MEASURED** — the first sweep said 24 and was CASE-SENSITIVE on the opening verb, so it could not see `sv09-068`'s *"**You may** search…"*; the suite's arithmetic row went red on its own author. A case-sensitive `GLOB` is a floor exactly as a single-column sweep is. ✅ The `needs` cell's *"all exist"* was **RIGHT for once** — no new op, no new op FIELD, no `CardFilter` member, no interpreter/registry/wire/schema/client diff — **and both read sites it did not name priced at ZERO too**: `programPlayable` owes no bench-space arm (the interpreter already clamps to `benchSpace` before anything leaves the deck; a deck search is *playable enough* per ruling/284) and no printing of the family is a played Ability. `preventBlock.test.ts`'s §11 table went red for `searchDeck`/`shuffleDeck` as predicted. ⚠️ **THE 5 LEFT**: 2 already BUILT as registry rows (`sv10-083`, `sv09-068` — owner-narrowed nouns the anchor must REFUSE, and the reason a `(.+)` noun would have been invisible), 1 disjunctive noun (`sv08-158`, *"in any combination of Maushold and Maushold ex"*), 1 §4 going-first licence (`sv06-009`, `trainerFirstTurnExempt`'s ATTACK twin) and 1 §9.2 tail whose destination is the body just benched (`sv06-046`). See `derivedBenchSearch.test.ts` |
| ~~**7**~~ | ~~**Opponent-hand family** — reveal / random discard / shuffle-back~~ — ✅ **BUILT at D232** (21 of 31) | ~~35~~ **31** | ~~~14 arms + 2 ops~~ **4 arms + 2 ops** | **5.25** | 🛑 **THE FIRST ROW ON THIS PAGE WHOSE *EDIT* ESTIMATE HELD IN ITS LOAD-BEARING HALF AND WHOSE *COUNT* IS A NUMBER NOTHING REPRODUCES.** Its three per-sentence figures are each EXACTLY RIGHT (8 / 7 / 5) and their sum is 20 — so the **35** is not a mis-census of a sentence, it is a total nobody derived. Re-derived over `json_each` + `GLOB`, **grouped BY SENTENCE, all three text columns**, 2026-08-06: the three named sentences hold **20** in the ATTACK column; the family's whole set of verbs holds **31** there (17 reveal-compounds, 9 random-discard, 5 shuffle-back), **6** in abilities, **6** in `effect`, **43** across all three. **35 is none of them.** ⚠️ *A count without a COLUMN is as broken as a count without a POPULATION.* ✅ **"2 ops" IS EXACT** — the first edit estimate here to survive contact since row 3 — and "~14 arms" is **4**. The reason this family did NOT collapse to one anchor the way rows 5/6/8 did is the transferable part: **those sentences differed in a NOUN, these differ in the VERB**, and a verb selects the op. 🛑 **THE `needs` CELL WAS RIGHT AND STILL MISSED THE CHEAPEST PRINTING ON THE PAGE**: N's Purrloin `sv09-096` prints **Ortega's Trainer text verbatim as an ATTACK**, and `bottomFromOpponentHand` has carried an OPTIONAL `filter` since M5 — so that one is a bare anchor over an op, a field and an interpreter case that all already existed, unread for eighty slices because nobody grouped the census by SENTENCE. ✅ **AND `redact.ts` PRICED AT ZERO, WHICH IS THE OPPOSITE OF WHAT THIS ROW'S PROSE PREDICTED** (*"a hand REVEAL … must reach the opponent's snapshot"*): a printed reveal is INSTANTANEOUS, so the unconditional face-down hand is the CORRECT projection and the reveal's whole channel is the LOG — driven from all three viewpoints. `log.ts` took one arm. 🛑 **THE `rng.ts` QUESTION ANSWERS *NO BUMP*, ASKED BEFORE THE OP WAS WRITTEN**: `rngState` is a `GameState` field and `MatchRecord` persists the whole `GameState`, so a random pick replays exactly — but `rng.ts` did take its first diff since D145 (`randomIndex`, the scaling arithmetic `shuffle` has used since M1, EXTRACTED so the engine has one spelling of it). ⚠️ **THE 10 LEFT ARE ALL COMPOUNDS, not nouns**: a damage scaler over a hidden zone (3), a forced bench play out of the opponent's hand (2), a chosen discard from the revealed hand (2), a filtered sweep (1), running another card's Supporter effect (1), and `programPerHeads` over the built op (1). See `opponentHandFamily.test.ts` |
| ~~**8**~~ | ~~**Deck-search → hand** in attack text, no new filter~~ — ✅ **BUILT at D231** (28 of 42) | ~~25~~ **42** | ~~~15 arms~~ **1 anchor + 1 noun table + 3 filter members** | **28.0** | 🛑 **THE WORST POPULATION ESTIMATE ON THIS PAGE, AND THE THIRD ROW RUNNING TO MISS IN BOTH DIRECTIONS AT ONCE.** Its **25** has no population behind it — re-derived over `json_each` + `GLOB '*[Ss]earch your deck*'` (case class on the verb) on 2026-08-06 and **grouped BY SENTENCE**, the attack column holds **42 legal printings over 23 distinct sentences**, and it is **ONE anchor**: eight noun phrases resolved through a CLOSED TABLE (`OPPONENT_ENERGY_SCALE`'s shape, not D230's group-per-noun — sixteen groups otherwise), a count capture, an optional `You may` opener and an optional printed `reveal it/them`. ⚠️ **AND 42 CORRECTS A FIGURE THIS REPO HAD ALREADY WRITTEN DOWN**: `derivedBenchSearch.test.ts`'s *"41 legal printings search into the HAND"* is the **`effect` (Trainer) column**, not the attack one — two denominators one word apart inside one family. 🛑 **THE `needs` CELL'S *"all exist"* IS THE ONE PART THAT IS FALSE**: three members were missing — **`item`** (4 legal), **`stadium`** (1) and **`anyCard`** (7), the last of which is what makes the `reveal` rider FALSIFIABLE (every no-reveal printing searches for uncategorised *"cards"*, so without it a hard-coded `reveal: true` is an unkillable mutant). ✅ **Both read sites the row did not name priced at ZERO, measured**: `log.ts`'s `DECK_SEARCHED` arm (D225 wired the rider; this is the first ATTACK to produce the event) and `redact.ts` (its answerer gate keys on the PHASE, not on the producer). ⚠️ **THE 14 LEFT ARE ALL A NOUN**: typed Pokémon (3), `ownerPokemon` (2), a typed disjunction (2), *"any number of"* at an unbounded max (2), a braced energy code (1), *"of different types"* (1), a board-dependent type (1), a DYNAMIC max (1), a §9.2 leading clause (1). ⚠️ **`^` IS UNREACHABLE FROM THIS CATALOG** — every printed leading clause LOWERCASES the verb — found by a surviving mutant, closed with a labelled construction. See `derivedHandSearch.test.ts` |

> ✅ **AND THE SPLIT-OUT ROW IS BUILT TOO (D228, 2026-08-05) — 8 of 8**, so backlog
> row 4's family is **complete at 21 of 22 legal printings**: the only one left is
> Malamar `sv06.5-034`, whose third sentence wants both the trailing-requirement
> COMPOSITION seam (D192's deferral) and a *"which Supporter did you play this
> turn"* fact `allowances` does not keep. ⚠️ **AND THE FOLLOW-UP BELOW IS NOW THE
> WHOLE REMAINDER OF THE FAMILY**: the ABILITY twin `sv10.5w-023`/`-107` (2 legal).
>
> 🛑 **AND ITS PRICE WAS MEASURED AT D229 AND IS *ZERO ENGINE CODE*, WHICH IS WHY
> THAT SLICE WENT ELSEWHERE.** The follow-up below says the twin *"still wants the
> `programPlayable` arm D227 declined to write speculatively"* — **it does not, and
> neither does anything else in the pool.** The Ability's program is
> `switchActive {recordAs}` → `recordGate {then: [opponentSwitchOut]}`, and
> `programPlayable` descends into **`coinFlipGate.then` only** (ruling/906's
> flip-is-procedure argument, which a §9.2 gate does not share), so the op is never
> at top level; its ANTECEDENT is a `switchActive` the gate already refuses on an
> empty own Bench, which is also the printed behaviour. **Both HUD row-lighting
> mirrors are therefore unaffected too** — they call the same predicate with the
> same arguments. So the twin is **1 registry object for 2 legal printings and
> nothing else**, and the arm stays unwritten because *a gate no printing reaches
> is a vacuous guard*. Pinned red-able in `derivedSelfEnergyMove.test.ts`
> ("NO NEW `programPlayable` ARM WAS OWED"), not in prose.
>
> ✅ **AND ROW 4 IS BUILT (D227, 2026-08-05) — 13 of its 14, struck through above.**
> Two things it produced that belong here rather than in the row:
> * 🛑 **A NEW SPLIT-OUT ROW, MEASURED: "this attack does N damage to the NEW
>   Active Pokémon" — 8 legal printings, ONE mechanism.** Grimmsnarl `sv07-096`
>   (the 14th of row 4) plus four gust sentences (`…does 30/20/40/70 damage to the
>   new Active Pokémon.`, 2+2+2+1 legal). It is a **second §8.5 hit against a body
>   that is not the captured defender** — Weakness, Resistance and every damage
>   modifier apply to it — and the §8.5 pipeline lives in `attack.ts` **in front
>   of** the interpreter with no channel back from a program. `damageActive` is
>   NOT it: that op places COUNTERS, which is a different thing under §11 and
>   under W/R. Listed in the separately-priced table below.
> * ⚠️ **AND SWEEPING ALL THREE TEXT COLUMNS FOUND 2 LEGAL PRINTINGS ROW 4 DID NOT
>   COUNT**, because the row censused attack text only: `sv10.5w-023`/`-107` print
>   the **ABILITY twin** of Iron Bundle's compound — *"Once during your turn, you
>   may switch your Active Pokémon with 1 of your Benched Pokémon. If you do,
>   switch out your opponent's Active Pokémon to the Bench. (…)"*. **The op now
>   exists**, so this is 1 registry object for 2 legal printings — but an activated
>   Ability is a card PLAY, so it goes through `programPlayable`, which has no arm
>   for `opponentSwitchOut` and deliberately did not get a speculative one. **That
>   arm plus the row is the whole of the follow-up.**
> **The non-attack built figure is unmoved by D227** (it is an attack-text slice):
> still 147 of 651, 22.6 %.

---

# THE D233 RE-DERIVATION AT HEAD (2026-08-06) — rows 9-16, each WITH ITS QUERY

> 🛑 **THIS SECTION EXISTS BECAUSE FOUR ROWS RUNNING CARRIED A COUNT NOBODY COULD
> REPRODUCE.** D229 (19→16), D230 (22→25), D231 (25→42) and D232 (35→31). D232's
> diagnosis is the one to keep: its three PER-SENTENCE figures were each exactly
> right and their sum was 20, so its *35* was **a total nobody derived**.
> **Every row below carries the SQL that produced it**, and the same numbers are
> re-computed from the printed sentences by `packages/engine/src/censusAtHead.test.ts`
> on every `bun run check` — a count in a markdown cell has nothing behind it.

**Measured against the REMOTE Cloudflare D1 `luminous`, `database_id
735f0fb5-cdc3-494d-8b97-74a8ade0124a`, over MCP on 2026-08-06. Engine seam:
branch HEAD `862e8af`, engine 0.149.0. `legal_standard = 1`.**

## The method reproduces D187's headline, which is why the new one is believable

The sweep was run twice: once at HEAD, and once in a **detached throwaway
worktree at `02b839c`** — the commit this page's old headline names.

| Run | derived printings | + registry `attack` | **built** | page says |
|---|---:|---:|---:|---|
| `02b839c` | 918 | 4 | **922** | **922** ✅ |
| **HEAD `862e8af`** | **1,023** | 4 | **1,027** | *(new)* |

The round-trip triple is unchanged too: **640 distinct attack sentences / 1,732
printings / 60,467 characters**, byte-for-byte D187's. **The denominators have not
moved since D187.**

## The new headline

| | Units | Built (D187) | Built (`02b839c`) | Built (D233) | Built (D235) | Built (D236) | **Built (D237)** | **UNBUILT (D237)** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| attack effect text | 1,732 | 806 | 922 | 1,027 | 1,059 | 1,068 | **1,078** | **654** |
| ability text | 376 | 3 | 77 | 88 | 88 | 88 | **88** | **288** |
| Trainer effect text | 264 | 3 | 48 | 57 | 57 | 57 | **57** | **207** |
| Special Energy effect text | 11 | 0 | 2 | 2 | 2 | 2 | **2** | **9** |
| **total** | **2,383** | 812 | 1,049 | 1,174 | 1,206 | 1,215 | **1,225** | **1,158** |

⚠️ **THE D235-D237 COLUMNS ARE SLICES, NOT RE-SWEEPS.** D233's figures were
measured; every column after it is those plus what one anchor read (D234 +12 off
row 9, D235 +20 off row 10, D236 +9 off row 12, **D237 +10 off row 13**). `censusAtHead.test.ts` re-computes all of them from the printed sentences on
every `bun run check`. The next full re-derivation should still be run rather than
inherited — that is D233's whole finding.

```sql
-- THE POPULATION (all four figures, one query). Re-derives to D187's values.
SELECT (SELECT COUNT(*) FROM cards WHERE legal_standard=1)                      AS legal_rows,
       (SELECT COUNT(*) FROM cards c, json_each(c.attacks_json) j
          WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')) AS atk_units,
       (SELECT COUNT(*) FROM cards c, json_each(c.abilities_json) j
          WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')) AS abil_units,
       (SELECT COUNT(*) FROM cards
          WHERE legal_standard=1 AND effect NOT IN ('')) AS eff_units;
-- 2021 | 1732 | 376 | 275   (275 = 264 Trainer + 11 Special Energy, split by cards.category)
```

**BUILT is DERIVED, never read off a doc.** The 640 distinct attack sentences are
pulled from D1 and fed to the seven exported readers (`deriveAttackEffect`,
`…DamageBonus`, `…DamagePenalty`, `…DamageMultiplier`, `…CoinFlip`,
`…Requirement`, `…DamageSuppression`); the non-attack columns are `programFor(id)`
joined against D1 by id, because **there is still no deriver for either**.

### ✅ The running non-attack total the page carried by hand was RIGHT

Since D221 this page has been decrementing *"147 of 651, 22.6 %"* by hand across
five slices. Re-measured: **88 + 57 + 2 = 147 of 651**. **Exactly right — the only
running total on this page that survived re-derivation.**

### 🛑 The attack total was NOT — and the gap is ONE sentence no row claimed

The eight slices since `02b839c` claim **103** attack printings between them
(D227 13 · D228 8 · D229 13 · D230 20 · D231 28 · D232 21). The sweep measures
**+105**. Diffing the two unbuilt sets sentence-by-sentence, the residue is a
single string:

> *"Move all damage counters from 1 of your Benched Pokémon to 1 of your
> opponent's Pokémon."* — **2 legal printings**, made derivable by **D216**'s
> `moveCountersChosen`, which was a *chosen-destination counter move* slice and
> counted nothing.

⚠️ **A SLICE CAN MOVE PRINTINGS IT NEVER COUNTED, AND ONLY A RE-DERIVATION FINDS
THEM.** This is the mirror image of the four bad counts above: those were numbers
with no measurement behind them; this is a measurement no number went looking for.

## Rows 9-16 — ranked by MEASURED unbuilt printings, not by an estimated ratio

⚠️ **THE ORDER IS BY THE NUMBER THAT WAS MEASURED.** Eight rows in, this page's
record is: **the op count is usually right, and the arm count and the printing
count are usually wrong** (D232). So the rows are ordered by the *printings*
column, which is measured, and the *edit* column is marked as an estimate and
kept out of the sort. Ratios are shown but **not** trusted.

⚠️ **THE ATTACK COLUMN IS THE ONLY ONE A DERIVER CAN REACH.** An ability or a
Trainer printing is a hand-authored registry row, forever — so a row's *attack*
figure is what one anchor buys, and its *ability*/*effect* figures are what N
registry programs buy. Both are given; do not add them and call it a ratio.

```sql
-- THE SHAPE EVERY ROW BELOW USES. Substitute the row's GLOB for <PATTERN>.
-- ⚠️ GLOB, never LIKE (SQLite's LIKE is case-insensitive and has cost this file a
-- census); a CASE CLASS on any leading verb ('[Ss]earch') because a case-sensitive
-- GLOB is a FLOOR (D230's first sweep was 24 where the truth was 25).
WITH u AS (
  SELECT 'attack'  AS col, c.id AS id, json_extract(j.value,'$.effect') AS t
    FROM cards c, json_each(c.attacks_json)  j WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')
  UNION ALL
  SELECT 'ability', c.id, json_extract(j.value,'$.effect')
    FROM cards c, json_each(c.abilities_json) j WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')
  UNION ALL
  SELECT 'effect',  id, effect FROM cards WHERE legal_standard=1 AND effect NOT IN ('')
)
SELECT col, COUNT(*) AS printings, COUNT(DISTINCT t) AS sentences, group_concat(DISTINCT id) AS ids
  FROM u WHERE t GLOB '<PATTERN>' GROUP BY col;
```

The **UNBUILT** split is then taken locally: **attack** = the sentence is refused
by all seven readers; **ability / effect** = `programFor(id) === undefined`. Both
halves are pinned in `censusAtHead.test.ts`, which fails the moment either moves.

> ⚠️ **THE ROWS WERE MEASURED THROUGH A `CASE … WHEN` CHAIN, SO A SENTENCE BELONGS
> TO THE FIRST FAMILY THAT CLAIMS IT.** Re-ordering the patterns re-attributes
> overlapping printings. The chain order is A→B→C→D→E→F→G (row 10, 9, 11, 13, 16,
> the blocked evolve family, 15) with row 12's pattern run standalone and verified
> disjoint. `censusAtHead.test.ts` asserts the disjointness rather than assuming it.

| # | Family | Legal UNBUILT printings (attack · ability · effect) | Edit estimate — **AN ESTIMATE** | Printings/edit | Query + what was CHECKED |
|---:|---|---|---|---:|---|
| ~~**9**~~ | ~~**Attach from the DISCARD PILE** — `attachEnergyFrom`, source side~~ — ✅ **ATTACK HALF BUILT at D234 (12 of 17)**; the ability/Trainer half is untouched and now sits in the residue row below | ~~**34** = 17 (12 sentences) · 12 · 5~~ → **22** = 5 · 12 · 5 | ~~~1 anchor~~ → **exactly 1 anchor** | ~17 → **12 for one arm** | ✅ **THE ONLY ROW ON THIS PAGE WHOSE COUNT SURVIVED RE-DERIVATION UNCHANGED, AND THE ONLY ONE WHOSE *PREDICTION* DID.** The row said 17 (12 sentences) · 12 · 5 and the re-run returned attack 17/12, ability 13/6, effect 6/4 — the two non-attack figures minus the one already-authored printing in each (`sv09-024`; N's PP Up `sv09-153`). It also predicted ONE anchor from D232's noun-versus-verb rule, in writing, so a successor could falsify it; one anchor is what it cost. ✅ Both read-site prices held: `programPlayable` ZERO for the attack half, `preventBlock.test.ts` §11 owed a row and got one. ⚠️ **AND A THIRD READ SITE NOBODY HAD PRICED WENT RED** — `counterBenchPut.test.ts` sweeps every derived op with a string `source` and asserts `"attack"`; `attachEnergyFrom.source` is a ZONE, so the guard's predicate was wider than its subject. Partitioned, not narrowed. See `derivedDiscardAttach.test.ts` |
| ~~**10**~~ | ~~**Deck-search that ATTACHES** — `attachFromDeck`~~ — ✅ **ATTACK HALF BUILT at D235 (20 of 28)**; the ability/Trainer half is untouched | ~~**33** = 28 (17 sentences) · 4 · 1~~ → **13** = 8 (5 sentences) · 4 · 1 | ~~~1 anchor + 1 destination table + 1 new subgroup rider~~ → **exactly 1 anchor + 1 optional group + 1 destination table; NO new rider** | ~11 → **20 for one arm** | ✅ **THE ONLY ROW ON THIS PAGE WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION — not just the attack half.** The re-run returned attack 28/17, ability 5/3, effect 5/2; the row's `28 (17) · 4 · 1` is those minus what is already authored (`sv10-136`; the four-printing Janine sentence). **33 = 33**, two rows running. 🛑 **BUT ITS *PREDICTION* WAS GRADED WRONG, WHICH IS THE FIRST TIME AND THE POINT OF WRITING ONE DOWN.** The arm count was right (one anchor, D232's rule a third time); the printing count was 23 predicted / 20 delivered, because **A DESTINATION TABLE IS NOT PORTABLE BETWEEN TWO OPS JUST BECAUSE ITS KEYS ARE** — `attachEnergyFrom` has `count` (a batch pinned to ONE body, D205) and `attachFromDeck` does not, so *"attach **them** to **1 of** your Pokémon"* is expressible one op over and NOT here. ✅ Both read-site prices held: `programPlayable` ZERO (twice over — attacks skip it AND this op is ungated), §11 owed a row and got one. ⚠️ **AND TWO CONTROLS EXPIRED**: Okidogi ex `sv06.5-036` is a REAL pool printing whose index 0 is this family's §9.2-tail sentence, and `clauseTable.test.ts` asserted it unbuilt twice — re-homed, not deleted. See `derivedDeckSearchAttach.test.ts` |

| **11** | **Look at the top N** — `lookAtTopN` | **33** = 15 (7 sentences) · 5 · 13 | ~2 anchors (the *"put them back in any order"* shape and the *"you may put/attach/discard what you find"* shape) | ~16 (attack half ~7.5) | `GLOB '*[Ll]ook at the top*'`. **The most EVENLY SPREAD family on the page — 13 of its 33 are Trainers**, so most of its value is registry rows a deriver can never reach. ✅ `lookAtTopN` exists and `log.ts` already has its `DECK_TOP_REVEALED` arm (2 hits). 🛑 **§11 row owed.** ⚠️ **AND ITS FIDELITY DEBT IS ALREADY ON THIS PAGE** — the *"printed reveal"* row below names `lookAtTopN`/`DECK_TOP_REVEALED` as the twin debt; taking this row without it ships a look that the opponent never sees |
| ~~**12**~~ | ~~**Attach from the HAND** — `attachEnergyFrom`, hand side~~ — ✅ **ATTACK HALF BUILT at D236 (9 of 16)**; the ability half (10 printings, including the 4-printing *heal 30* Ability the row named) is untouched | ~~**26** = 16 (8 sentences) · 10 · 0~~ → **17** = 7 (4 sentences) · 10 · 0 | ~~~1 anchor + a destination table~~ → **1 anchor (a FACTORY shared with row 9) + 1 optional group + 1 new op FIELD** | ~13 → **9 for one arm** | ✅ **THE THIRD ROW RUNNING WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION.** `GLOB '*ttach*Energy card*from your hand*'` (run standalone; verified disjoint from rows 9-11) returns attack **16 / 8 sentences** · ability 29 / 8 · effect **0 / 0**; the row's `16 (8) · 10 · 0` is the attack half exact on BOTH figures, the ability half minus the 19 already authored, and a Trainer column that is a MEASURED zero. **26 = 26.** ✅ **AND IT WAS THE CONTROL FOR D235's RULE, WHICH SURVIVES AS STATED** — same op, so `DISCARD_ATTACH_DESTINATIONS` ports **VERBATIM** (not one new key; the destination with 0 legal printings at D234 has 2 here and worked first run). 🆕 **BUT THE PORTABILITY BOUGHT ALMOST NOTHING, AND THAT IS THE FINDING: A SOURCE-ZONE MIRROR TRANSFERS THE *ANCHOR*, NOT THE *FAMILY*.** The same shape read 12 of 17 one zone over and 9 of 16 here — **six of the sixteen are blocked by a LEADING CLAUSE or an UNBOUNDED COUNT, categories the discard side does not print even once.** 🛑 A third clause of D235's prediction is **VACUOUS rather than confirmed**: no attack printing here spells *"up to N … to 1 of your …"*, so `count` — D235's whole blocker — has nothing to do. 🛑 **AND THIS SLICE'S OWN PREDICTION LOST ON THE FIELDS**: `healTarget` is the first new op field in three slices, because `recordGate` → `healChosen` PARKS and would let the player heal a Pokémon the card never named. ⚠️ One expired *"unbuilt"* control re-homed in `derivedDiscardAttach.test.ts`. See `derivedHandAttach.test.ts`.  ⚠️ **THE ABILITY HALF CONTAINS THE CHEAPEST SINGLE PROGRAM LEFT IN THE POOL**: `sv07-014`/`-156`/`-167`/`sv08.5-011` (**4 legal**) print *"attach a Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, **heal 30** damage from that Pokémon"* — the BUILT 8-printing group `svp-166`/… is the same sentence with **draw a card** instead of heal, so this is D221's `attachEnergyFrom {recordAs}` → `recordGate` shape with `healChosen` in the tail. **One registry object, zero engine code — CHECK THAT CLAIM BEFORE BELIEVING IT** (this page has been wrong about *"zero engine code"* four times) |
| ~~**13**~~ | ~~**The discard pile into the hand or onto the Bench** — `discardPileRetrieval`~~ — ✅ **ATTACK HALF BUILT at D237 (10 of 16)**; the ability/Trainer half is untouched | ~~**23** = 16 (8 sentences) · 4 · 3~~ → **13** = 6 (3 sentences) · 4 · 3 | ~~~1 anchor + a noun table~~ → **1 anchor + 1 `CardFilter` member + 1 new op `dest` + 2 tables** | ~11 → **10 for one arm** | ✅ **THE FOURTH ROW RUNNING WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION.** `GLOB '*[Pp]ut*from your discard pile*'` returns attack **16 / 8 sentences** · ability **4 / 2** · effect 8 / 5; the row's `16 (8) · 4 · 3` is the attack half exact on BOTH figures, the ability half RAW, and the Trainer half the 8 minus the 5 already authored. **23 = 23** — and four rows running means the METHOD rather than the luck is what fixed these counts. 🛑 **BUT THE ROW'S *EDIT ESTIMATE* WAS SHORT BY A WHOLE OP DESTINATION, AND OVER-COUNTED THE THING IT DID NAME.** *"~1 anchor + a noun table"*: the noun table was **already built** (D231's `HAND_SEARCH_NOUNS` is exactly it, one row short), and what it did not price is `discardPileRetrieval.dest: "bench"` + its `retrieveMove` arm + its bench-space clamp + its `DISCARD_RETRIEVED` value + the `log.ts` row. **Two slices running have under-priced by exactly one mechanism.** 🛑 **AND THE PREDICTION IT WAS CHOSEN TO TEST LOST, TAKING D236's CLAIM WITH IT.** *"Grammar is a property of the ZONE, so the arm reaches ≥ 12 of 16 and every blocker is a NOUN"* — it reads **10**, and no arm could reach 12. Four of the six refusals ARE nouns (**ONE blocker, the printed BRACE CODE, wearing two of them** — and the same blocker `derivedHandSearch` already names in its own residue); the other two are the leading *"Flip 3 coins."*, which D236 called a category *"the discard side does not print even once"* — **it prints it TWICE, in both verbs**, here and in D234's own residue. 🆕 **So a leading clause is a property of neither the ZONE nor the VERB — it is a property of the per-heads FOLD.** 🆕 **`CardFilter.trainerCard` IS THE CATEGORY, NOT A DISJUNCTION OF THE FOUR SUBTYPES** (Wailord `sv08-087`): it reads `category` alone, so a fifth printed subtype is admitted the day it is ingested. ⚠️ One expired *"unbuilt"* control re-homed in `derivedHandSearch.test.ts`. ✅ Read sites priced by grep and **ONE WAS NOT ZERO**: `log.ts` owed a THIRD arm and its absence was a live CONTRADICTION (a Bench put announced as a shuffle into the deck); §11 owed a row + probe; `programPlayable` ZERO for §8's reason, not the row's — the arm the row priced belongs to its ABILITY half. **10 legal, 26 CATALOG** — the widest legal-to-catalog spread any row on this page has shown. See `derivedDiscardRetrieval.test.ts` |
| **14** | **The ABILITY column's three biggest reprint groups** — three registry programs, six legal printings each | **18** = 0 · 18 · 0 | **3 registry programs** | **6.0** | `GROUP BY` on the ability column with the registry ids subtracted (see §"the shape every row uses"; `col='ability'`). The three: *"This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play"* (`svp-205`/`-216`/`sv10-081`/`-213`/`-231`/`-240`) — `preventAttack` + a `BoardCondition` over `ownerPokemon`, **both exist**; *"Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken"* (`svp-177`/…) — an attack-cost delta over the `opponentPrizesTaken` count source, **both exist**; and *"When you play this Pokémon from your hand onto your Bench … you may switch it with your Active Pokémon. If you do, you may move **any amount** of Energy from your other Pokémon to this Pokémon"* (`svp-128`/…) — a §9 triggered on-bench program whose tail is **D226's `moveEnergy.anySource`**. ⚠️ **6.0 IS THE CEILING FOR A REGISTRY ROW AND IT IS THE HONEST COMPARISON** — a registry program buys its reprint group and nothing else, forever |
| **15** | **Prevent all damage by ATTACKER CLASS** — `preventDamage.fromClass` | **17** = 9 (3 sentences) · 8 · 0 | Widen `fromClass` from the single literal `"Basic"` to a class table; a separate damage-CAP arm for the 3 printings that say *"if that damage is 40/60 or less"* | ~8.5 | `GLOB '*[Pp]revent all damage*by attacks from*'`. ✅ **THE ONLY ROW HERE THAT OWES NO §11 ROW** — `preventDamage` is already classified (10 hits in `preventBlock.test.ts`), so this is the one family whose read sites genuinely price at ZERO, measured. 🛑 **AND ITS TYPED HALF IS THE COST**: the op's `fromClass?: "Basic"` is a single string literal, and the printed classes are *Basic non-{C}* (7), *Ancient* (1) and *Pokémon ex* (1) — the last two are the **SUPPLY-side absence** `conventions.md` warns about (`Ancient`/`Future` are demand-only in this catalog), so re-read D205/D207 before designing the predicate |
| **16** | **Copy an attack** — *"…and use it as this attack"* | **13** = 13 (6 sentences) · 0 · 0 | **A genuinely new mechanism — no seam exists** | — | `GLOB '*use it as this attack*'`. Listed as a row because it is the biggest single attack-column family with no cheaper sibling, and flagged so nobody re-prices it as an anchor. It needs an attack to RESOLVE ANOTHER PRINTED ATTACK — cost, coin flips, §8.5 fold and all — from four different sources (a Benched owner-prefixed body, the opponent's Active, the top of a deck, and a revealed pile). D232 already left one of these on its own family (*"use the effect of a Supporter card you find there"*, 1 printing); this is the same missing seam |

~~**Rows 9-16 account for 114 of the 705 unbuilt attack printings — 16 %.**~~
~~**At D234: 102 of 693 — 15 %.**~~ ~~**At D235: 82 of 673 — 12 %.**~~ ~~**At D236: 73 of 664 — 11 %.**~~ **At D237: 63 of 654 — 10 %.** That number is pinned in `censusAtHead.test.ts`
and it is the point: **D187's backlog was fat families; what is left is a long
tail, and eight rows of it is a seventh.**

⚠️ **THE FRACTION FELL RATHER THAN ROSE, AND IT WILL KEEP FALLING — THAT IS THE
SHAPE OF EVERY SLICE FROM HERE.** Taking a NAMED row shrinks the named part of the
backlog faster than it shrinks the whole, because the unnamed 267-string tail
below is untouched by anything an anchor can do. **A rising "% named" would mean
the census had found new fat families; a falling one means the work is going where
the page says it should.**

### 🆕 D234's RESIDUE — the 5 legal attack printings row 9 could not reach (measured, 4 blockers)

**Written back as its own row rather than left as "the rest of row 9", because the
five are FOUR different blockers and only one of them is an anchor's job.** Each is
pinned derived-to-null in `derivedDiscardAttach.test.ts` with the reason.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| *"Attach a Basic {F} Energy card from your discard pile to **each of** your Benched Pokémon."* | **2** | A spread attach with **no decision in it**. `attachEnergyFrom` attaches to ONE `ref`, and the *"in any way you like"* expansion D234 built still asks WHERE each card goes. Wants a `toEachBench` rider (or a new op) that walks the Bench and takes one matching card per body. ⚠️ **The rotated *"Choose up to 2 of your Benched Pokémon and attach … to each of them"* is the same blocker wearing a leading clause** — 0 legal, but it is what a `toEachBench` rider would generalise to |
| *"Attach **an** Energy card from your discard pile to this Pokémon."* | **1** | `attachableEnergies` (interpreter.ts) admits `card.energyType === "Normal"` only, i.e. BASIC Energy. This is out of reach of the **OP**, not of the anchor: it wants an `anyEnergy` rider read at that helper — which is also read by `firstAttachableEnergy`, i.e. by `programPlayable` and **both HUD row-lighting mirrors**. ⚠️ **Price the READ SITES, not the field** (D190/D222) |
| *"Attach up to 3 Energy cards from your **opponent's** discard pile to **their** Pokémon in any way you like."* | **1** | `source` names a **ZONE**, never a SEAT, and every ref `attachEnergyTargets` produces is `ctx.seat`'s. Needs an owner axis on both ends. Also needs the `anyEnergy` rider above (its noun is unqualified). **The most expensive printing in the family and the only one that is 1 card for 2 mechanisms** |
| *"**Flip 3 coins.** Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."* | **1** | A `programPerHeads` whose `ops` **PARK** — and `deriveAttackCoinFlip` owns it, a different reader from the one D234 touched. Both existing `programPerHeads` printings expand to `discardDeckTop`, which never parks, so *"can the per-heads expansion carry a parking op at all"* is an **unanswered question about `attack.ts`'s fold**, not an anchor. ⚠️ **Answer that before pricing it as one regex** |

### 🆕 D235's RESIDUE — the 8 legal attack printings row 10 could not reach (measured, 4 blockers)

**Written back as its own row rather than left as "the rest of row 10".** 🛑 **AND
THE HEADLINE IS THAT ROW 10 PRICED ONLY TWO OF THE FOUR BLOCKERS UP FRONT** — it
named the Future/Tera subgroup and the *"of different types"* filter, and it missed
both of the others. **A row that prices its own blockers is still only as good as
the op vocabulary its author had in mind.** Each is pinned derived-to-null in
`derivedDeckSearchAttach.test.ts` with the reason.

| Printed sentence | Legal | What it actually needs | Row priced it? |
|---|---:|---|---|
| *"Search your deck for up to 2 Basic Energy cards and attach **them** to **1 of** your Pokémon. Then, shuffle your deck."* (`sv08.5-014`/`-146`) | **2** | **A batch pinned to ONE chosen body.** `attachFromDeck`'s park is the compound `attachCards` prompt whose answer is a MAP from card to target, so nothing stops a split; the field that would say it is `attachEnergyFrom.count`, on the OTHER op. Adding it here is a PROMPT field — a wire-schema change plus a validator arm plus **both HUD renderers** — i.e. a slice, not a rider. ⚠️ At `max: 1` the phrase IS expressible and D235 reads all four singular printings, which is why this row is 2 rather than 6 | 🛑 **NO** |
| *"…up to 2 Basic {P} Energy cards and attach them to **1 of** your **Benched** Pokémon…"* (`sv08-075`) | **1** | The same gap wearing a `benchOnly` | 🛑 **NO** |
| *"…up to 2 Basic Energy cards and attach them to your **Future** Pokémon in any way you like…"* (`svp-092`, `sv05-121`) | **2** | A SUBGROUP target. `targetType` reads `card.types` and *Future* is not a type — and `conventions.md`'s SUPPLY-side warning bites: **name the column before designing the predicate** | ✅ yes |
| *"…up to 3 Basic Energy cards **of different types** and attach them to your **Tera** Pokémon in any way you like…"* (`sv08-161`) | **1** | **BOTH blockers on one printing**: the Tera subgroup above AND a distinctness constraint no `CardFilter` kind expresses. ⚠️ The row counted these as 3 + 1 = 4 and they OVERLAP, so the subgroup blocker is 3 printings and this one is a strict subset of it | ✅ yes |
| *"…up to 2 Basic {G} Energy cards **and** up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like…"* (`sv07-050`/`-150`) | **2** | A **SECOND printed noun** — a different sentence SHAPE, so its own arm by D232's rule. Plausibly two `attachFromDeck` ops (one per type, each "up to N"), which is *reachable today* and is the cheapest thing left in this table — but it is an arm, and D235 predicted in writing that it would not build one | 🛑 **NO** |

### 🆕 D236's RESIDUE — the 7 legal attack printings row 12 could not reach (measured, 4 blockers)

**Written back as its own row rather than left as "the rest of row 12".** 🆕 **AND
THE HEADLINE IS THAT NOT ONE OF THE FOUR IS ABOUT THE DESTINATION** — every one
names a phrase `DISCARD_ATTACH_DESTINATIONS` already spells, which is D235's rule
holding, and **six of the seven printings are blocked by a shape the SIBLING zone
never prints at all.** That is what "a source-zone mirror transfers the anchor, not
the family" means in printings. Each is pinned derived-to-null in
`derivedHandAttach.test.ts` with the reason.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| *"**You may** attach **any number** of Basic Energy cards from your hand to your Pokémon in any way you like."* (`sv08-133`/`-225`/`-242`/`-248`) | **4** | **An UNBOUNDED count.** The spread branch grows the program one op per printed unit and *"any number"* names no unit. ⚠️ **THE SHAPE EXISTS ONE OP OVER**: `attachFromTop.max: "any"`, whose park is the compound `attachCards` prompt answering with a MAP from card to target — so this wants an `attachEnergyFrom` variant that parks like `attachFromTop`, i.e. a SOURCE axis on that op rather than a rider on this one. **The row's largest sentence, and the cheapest of the four to price next** |
| *"Attach **an** Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon."* (`sv06-136`) | **1** | `attachableEnergies` admits `card.energyType === "Normal"` only, i.e. BASIC Energy — **D234's residue, printed again one zone over**, and still an `anyEnergy` rider read at that helper (and therefore at `programPlayable` and BOTH HUD row-lighting mirrors). ⚠️ Its heal tail is already expressible: `healTarget: 60` with `toSelf`, so this printing is **one blocker away**, not two |
| *"**Switch this Pokémon with 1 of your Benched Pokémon. If you do,** attach up to 2 Basic {L} Energy cards from your hand to this Pokémon."* (`sv08-068`) | **1** | A LEADING clause, and a gated one. ⚠️ **EVERY OP IT NEEDS EXISTS**: `switchActive {recordAs}` → `recordGate` → `attachEnergyFrom {count: 2, toSelf}` is D206's authored shape verbatim. It is a different SENTENCE SHAPE and therefore its own arm (D232), which makes it **the cheapest single printing left in this family** |
| *"This attack does 30 damage for each {W} Energy attached to this Pokémon. **Before doing damage,** you may attach any number of Basic {W} Energy cards from your hand to this Pokémon."* (`sv10-056`) | **1** | **Two sentences, an unbounded count AND an ORDERING clause no reader in this engine can honour** — the multiply fold reads the board at DECLARATION, and this card asks the attach to land first. Already named in `effects.ts` as the one printing that could make "read at declaration" observable. **The most expensive printing in the family and the only one that is 1 card for 3 mechanisms** |

### Measured but NOT a row — evolve out of the DECK (13 legal printings)

`GLOB '*deck for a card that evolves*'` — **13 printings over 5 attack sentences**,
which would have ranked between rows 12 and 13. It is not a row because
**`registry.ts`'s own `CardProgram` doc forbids the shape**: Rare Candy *"runs no
op program (it evolves, which the interpreter must never do — `flow.ts` owns every
Knock Out)"*, so a mid-attack evolve wants the dedicated-action treatment Rare
Candy got, not an `EffectOp`. Recorded here with its blocker so the next census
does not re-price it as cheap.

**Priced separately — biggest single payoff, but genuinely new mechanism:**

| Family | Printings | Why it is not in the table above |
|---|---:|---|
| ~~🆕 **"This attack does N damage to the NEW Active Pokémon"**~~ — ✅ **BUILT at D228 (8 of 8)** | ~~8~~ | 🛑 **THE ROW'S COUNT WAS EXACT AND ITS DIAGNOSIS WAS WRONG, IN THE EXPENSIVE DIRECTION.** It said the family *"wants a channel from the interpreter back into the §8.5 fold, or the fold re-entered per promoted body"* — **neither was needed**: `snipeActive` has re-entered that pipeline from INSIDE a program since D96 (Hail Blade's `damageDefender`), and it reads `activeTop` off the LIVE state, so a body promoted one op earlier is addressed by simply asking who is Active. **1 op + 2 anchors, no addressing machinery.** ⚠️ **THE LESSON, AND IT IS THIS FILE'S:** the row was written after grepping `attack.ts` (where the fold lives) and not the interpreter's damage sites (where it is already re-entered) — **a price that names a MISSING CHANNEL must be checked against the ops that already cross it.** ✅ Its one true warning held: `damageActive` is not it (counters, not damage), and a build that used it would have printed 160 where Weakness owes 320. See `derivedNewActiveDamage.test.ts` |
| **Black Belt's Training** — turn-scoped attack-damage aura from a Supporter | **9** | `svp-219`/`-220`, `sv08.5-096`–`-099`, `sv09-143`–`-145`. **Still the largest single Trainer family in Standard.** Needs a per-turn effect channel that does not exist; `damageBonusBeforeWRIfTarget` is the right shape but is a passive on a Tool |
| **`discardStadium`** | **11** | Must also stop the Stadium's continuous effects and needs its own public event |
| **Multi-status** (*"is now X and Y"*) | **12** | `applyStatus` takes one status |
| **Damage-scaling `for each` residual** | **135** over **65 distinct** | The *cheap* count sources are **built** — `energyOnSelf` is now 22/27. What is left is the hard tail: per-filter discard-pile counts, board counts, and owner-prefix counts, most of them 1–2 printings each |
| 🛑 **The printed "reveal" on a deck search** (D224, 2026-08-05) — **NOT a coverage row: a FIDELITY row over printings this file already counts as BUILT** | **37 of 41** | ⚠️ **A DEBT NOBODY HAD COUNTED, BECAUSE FOUR REGISTRY DOC COMMENTS ASSERT IT IS FREE.** *"A search that ends in the hand is public by construction"* / *"reveal them implicit in a to-hand search"* — **measured false**: the `chooseCards` prompt is redacted to the ANSWERER alone, the hand is withheld, and the only thing crossing the wire is a **count-only** `DECK_SEARCHED` log row. 16 authored rows drop the clause today. ⚠️ **AND THE ONE-LINE FIX IS DEAD ON THE NUMBERS: 4 of the 41 Standard-legal to-hand search printings print NO reveal** (Cassiopeia `sv06.5-056`/`-086`/`-094`, Amulet of Hope `sv08-162` — all four search unfiltered *"cards"*, where a reveal is a real leak), so **the reveal is a property of the printed SENTENCE, not of the DESTINATION**. Wants an optional rider on the op read at the log site (`log.ts`); the twin debt sits on `lookAtTopN`/`DECK_TOP_REVEALED`. Pinned red-able in `proton.test.ts` |

## ⚠️ THE SHAPE OF THE BACKLOG HAS CHANGED: IT IS NOW A LONG TAIL

This is the finding that should govern planning, and it is new.

* D187's largest unbuilt attack string was **35 printings**. **The largest today is 10.**
* Of the **431** distinct unbuilt attack sentences, **267 fall outside every named
  family above**, and they account for **458 of the 810 unbuilt attack printings**.
* Their size histogram: **146 strings appear exactly once**, 79 appear twice,
  27 three times. Only **15** of the 267 appear four or more times.

**The fat families have been eaten.** More than half the remaining attack
backlog is singletons and doubletons, where a regex arm buys 1–2 printings.
**Printings-per-edit for the remaining work is structurally worse than anything
D187 priced**, and a plan that assumes D187-era ratios will overrun.

## ⚠️ PRICING LESSONS THIS SESSION LEARNED — FOLD THESE IN BEFORE QUOTING ANY ROW ABOVE

Three independent instances, all measured:

1. **A "large" item can collapse on contact.** D186's *"You may"* optional
   wrapper was priced at **78 printings**. It landed and was worth **12**.
   Re-measured here: the wrapper family is **78 units, 12 built, 66 still
   unbuilt** — because the wrapper is **a gate only** and each row still needs
   its body op. D187 said so; the number was quoted anyway.
2. **The same again at D200** — an 80-printing filter was worth **6**.
3. **A flag can OVERSTATE a cost as easily as it understates a gap.** D199 priced
   a union member as new that was already in the tree; **7 printings were hidden
   behind one word** in a `needs` string. **Re-derive the *needs* column, not
   only the ids and counts.**

**The rule:** a family's printing count is an *upper bound on the payoff*, never
the payoff. Before quoting any row in the table above, check whether it is a
**gate** (unlocks nothing alone) or a **body** (unlocks its rows).

**And its mirror, from D187's own addendum:** **when a family is served by a
PARAMETERISED anchor, its coverage is a property of the pattern, not of the rows
you enumerated.** Price a parameterised arm by running it over the pool. The
draw family measures **36 of 37 built** here from four anchors.

---

# ⚠️ THE DEAD-DATUM CLASS — RE-VERIFIED, AND THE SCHEMA CLAIM CORRECTED

**Carried forward from D187/D205/D207, re-derived at `02b839c`. The conclusion
HOLDS. D187's supporting schema list was WRONG and is corrected here.**

**The correct column list** (`PRAGMA table_info(cards)`, 25 columns):
`id, set_id, local_id, name, category, illustrator, rarity, regulation_mark, hp,
stage, evolve_from, types_json, retreat, abilities_json, attacks_json,
weaknesses_json, resistances_json, trainer_type, energy_type, effect,
legal_standard, legal_expanded, variants_json, updated, image_url`.

⚠️ **D187 listed `variants` (it is `variants_json`) and listed a `suffix` column
that DOES NOT EXIST.** A query against `suffix` errors with
`no such column`. This **strengthens** the dead-datum conclusion — there is even
less classifying surface than D187 credited.

**The three columns that could plausibly classify a card carry no banner value:**
`stage` ∈ {Basic, Stage1, Stage2, VSTAR, VMAX, null} · `trainer_type` ∈
{Supporter, Item, Tool, Stadium, null} · `energy_type` ∈ {Normal, Special, null}.

### D207's demand/supply framing — kept, and re-measured

**EVERY OCCURRENCE OF THESE BANNERS IS *DEMAND*. THE *SUPPLY* SIDE IS ABSENT.**

| Banner | Legal text units DEMANDING it (attack / ability / Trainer+SE) | Rows NAMED for it |
|---|---:|---:|
| **Tera** | **23** (4 / 7 / 12) | 9 legal — all Terapagos (a species) + Tera Orb (a Trainer that *asks*) |
| **Future** | **18** (7 / 10 / 1) | 0 legal |
| **Ancient** | **11** (10 / 0 / 1) | 0 legal |

All three re-derived with **`GLOB`** and match D187's 23 / 18 / 11 exactly.

**The proof is still a single card.** **Charizard ex `sv03-125` IS a Tera
Pokémon**, and its catalog row is `Stage2 / Darkness / 330 HP / evolve_from
Charmeleon` — **field-for-field indistinguishable from a non-Tera Stage 2**. The
predicate has readers and no writers.

⚠️ **A naive string sweep WILL find these words and read this section as rot. It
is not rot — the sweep is counting the demand.** What does not exist is a column
a predicate can *read* to decide whether the card in front of the engine carries
the banner.

⚠️ **WHY IT MATTERS MORE THAN "UNBUILT": an op authored over an absent datum has
a permanently empty candidate set, which `programPlayable` turns into a card that
can never be played.** That is strictly worse than leaving the printing unbuilt —
a silent dead print rather than a loud absence — and it will pass every test
written against it, because the tests are written by whoever believed the datum
existed.

**THE RULE: BEFORE YOU DESIGN A PREDICATE, NAME THE FIELD IT READS AND CONFIRM
IT IS IN THAT 25-COLUMN LIST.** These **52 legal text units** are blocked on the
**INGEST**, not the engine, and should be priced as a schema column + a
re-ingest.

### The CONTRAST that makes the rule usable — owner prefixes are NOT a dead datum

The owner prefix **is** readable: it is in `name`. That is exactly why D199 could
build four of them. Supply and demand both exist:

| | Measured |
|---|---|
| **Supply** — legal **Pokémon** rows whose `name` carries an owner prefix | **11 owners / 182 legal printings**: Team Rocket's 69, N's 17, Hop's 15, Ethan's 13, Cynthia's 13, Iono's 12, Marnie's 9, Lillie's 9, Arven's 9, Steven's 8, Misty's 8 |
| **Demand** — legal text units naming an owner-prefixed subgroup | **78 units over 11 owners** (Team Rocket's 31, Ethan's 11, Iono's 6, N's 6, Cynthia's 5, Hop's 5, Misty's 4, Arven's 3, Steven's 3, Marnie's 2, Lillie's 2) |

## What D187 got WRONG, and what could not be re-derived

D187 warned that this file "has already been wrong in ways that cost slices".
Four more errors were found while re-deriving it.

| D187's claim | Status |
|---|---|
| Verb ledger: *"hand refresh · `name LIKE '%Marnie%'` · **ZERO rows** — still true, now over 3,786 rows"* | ❌ **FALSE.** `LIKE '%Marnie%'` returns **9 rows**; `GLOB '*Marnie*'` also returns **9**, all Standard-legal (Marnie's Grimmsnarl ex, Impidimp, Liepard, Morgrem, Morpeko, Purrloin, Scrafty, Scraggy). **Since the population re-derived byte-identically, the catalog never changed — the row was simply wrong when written.** It is not a `LIKE`/`GLOB` artifact either; both agree |
| Column list includes **`suffix`**, and `variants` | ❌ **WRONG.** No `suffix` column exists (query errors); the column is `variants_json`. Corrected above |
| *"Zero registry-authored attacks are Standard-legal, so built attack = derived attack"* | ❌ **NO LONGER TRUE.** Four legal ids carry registry attack programs. Corrected above |
| Owner-prefix table: **8 prefixes / 67 text units** | ⚠️ **SHORT.** Measured **11 prefixes / 78 units** — adds **Hop's, Marnie's, Arven's**, and N's is 6 not 5. D187's per-owner figures were all-column totals, so **D200's "never attack-only" correction is confirmed** |
| D200's *"short by five owners"* | ⚠️ **NOT REPRODUCED.** On the Pokémon-subgroup predicate I measure **three** missing owners, not five. D200 may have counted owner-prefixed **Trainer** names (Black Belt's, Janine's, Bianca's, Clemont's, … — a different predicate, and not a `CardFilter` over Pokémon). **Marked UNVERIFIED rather than carried forward** |
| Tier 0 = 22 printings / 9 map entries | ✅ **Correct when written, now CONSUMED.** Sweep returns zero |
| Suppression family = 34 attack printings | ✅ **Confirmed exactly** — and now BUILT (D192) |
| *"You may" wrapper = 78 printings, a gate only* | ✅ **Confirmed** — 78 units, and the gate landed for **12** |
| Population figures (2,021 / 1,732 / 376 / 264 / 11 / 640 / 60,467) | ✅ **All re-derived exactly** |
| Structural claims (0 top-level Pokémon `effect`; 0 cards with 2+ abilities; 36/47 Basic Energy) | ✅ **All re-verified** |
| `sv04-266` Reversal Energy is the one legality anomaly | ✅ **Re-verified** — legal, unbuilt, sole `sv04` row |
| Per-family row lists in D187's Tiers 1–3 (exact id enumerations) | ⚠️ **NOT individually re-derived.** Only the families quoted in the ranking above were re-measured. **Treat D187's other id lists as UNVERIFIED** |
| *"whether any registry row is behaviourally correct"* | ⚠️ **STILL UNMEASURED**, as at D187. Coverage ≠ correctness |
| Expanded legality (`legal_expanded`) | ⚠️ **STILL UNANALYSED** |

## ⚠️ What would make THIS file's headline figures wrong

Stated so they can be falsified — eight vacuous-guard instances this session came
from claims nobody could check.

1. **`1,049 built / 1,334 unbuilt` is wrong if** the seven-deriver sweep is not
   the engine's real acceptance path — i.e. if `resolveAttack` consults a reader
   this census did not call. **Test:** enumerate `derive*` exports at HEAD and
   diff against the seven named above. A newly added eighth deriver silently
   makes this file under-count, exactly as D192's did to D187.
2. **`127 of 651 / 19.5 %` is wrong if** a `programFor` surface exists but the
   program is behaviourally wrong, or if a surface name was added to
   `CardProgram` that this census did not test for. **Test:** diff
   `CardProgram`'s field list against the eight this file checks
   (`attack, abilities, trainer, triggered, passive, stadium, energy, rareCandy`).
3. **Every attack figure is wrong if** the ordinal mapping between the local
   string list and D1's `ROW_NUMBER() OVER (ORDER BY t)` diverges — e.g. a
   collation change. **Test:** the six-ordinal spot check in §Method, plus the
   `640 / 60,467` round-trip.
4. **The whole file is wrong if** the catalog is re-ingested. **Test:** the
   population line. If `2,021 / 1,732 / 376 / 264 / 11` still holds, the
   denominators are intact; if not, **every** figure here is void.
5. **The dead-datum section is wrong if** an ingest adds a classifying column.
   **Test:** `PRAGMA table_info(cards)` against the 25-column list above. A
   string sweep finding the words "Tera"/"Ancient"/"Future" does **not**
   falsify it — that is the demand side.
6. **The ranking is wrong if** a family is a gate rather than a body. **Test:**
   for each row, name the op that executes the printed sentence and confirm it
   exists. See §Pricing lessons.

## Structural notes for whoever builds next

* **810 of the 1,334 unbuilt printings are ATTACK text** — derivable, payable in
  regexes. **299 are Abilities and 225 are Trainers/Special Energy, and those
  have no deriver at all**: each is a hand-authored registry row forever.
* **A REGISTRY ROW and a DERIVER ARM must never be priced on the same scale.**
  An arm is a text parser and its sentences transfer across sets; a row is keyed
  by card id and serves exactly the printings it names. **This is the single most
  useful thing the census establishes, and it survived re-measurement** — but its
  corollary has flipped: the non-attack surface is no longer 0.9 %, it is 19.5 %,
  because 172 registry ids were added on *legal* cards.
* **The cheap work is nearly gone.** Tier 0 is empty, the fat attack families are
  built, and 458 of 810 unbuilt attack printings sit in a 267-string long tail.
* **UNMEASURED, and named as such:** (a) whether `legal_standard` tracks the
  *current* official rotation — taken as authoritative, with the `sv04-266`
  disagreement flagged; (b) behavioural correctness of any registry row;
  (c) `legal_expanded`; (d) D187's per-family id enumerations outside the eight
  ranked families above.

### 🆕 D237's RESIDUE — the 6 legal attack printings row 13 could not reach (measured, **2** blockers)

**Written back as its own row rather than left as "the rest of row 13".** 🆕 **AND
THE HEADLINE IS THAT IT IS THE SMALLEST RESIDUE ANY ROW ON THIS PAGE HAS LEFT
BEHIND — TWO blockers over three sentences, and the larger of the two is SHARED
with a family this deriver already reads.** Each is pinned derived-to-null in
`derivedDiscardRetrieval.test.ts` with the reason.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| *"Put up to 3 **{W}** Pokémon from your discard pile onto your Bench."* (`svp-131`, `sv06.5-012`, `sv06.5-080`) | **3** | **A TYPE-NARROWED POKÉMON `CardFilter`, and the reason the shared noun table cannot carry the phrase is a CONTRACT rather than an omission**: `HAND_SEARCH_NOUNS`' two strings ARE `retrieveNoun`'s output, and that function writes a type out IN FULL ("a Water Pokémon"), because a dialog caption spelling `{W}` would be the engine quoting a symbol the player is reading off the card. So the fix is a filter member **plus** a decision about which spelling the table holds — and `targetType` (the board rider) is NOT it: this is a CARD predicate over `card.types` |
| *"Put a Basic **{G}** Energy card from your discard pile into your hand."* (`sv06-021`) | **1** | **THE SAME BLOCKER WEARING A DIFFERENT NOUN**, which is why the two are one row and not two. ⚠️ **AND IT IS ALREADY NAMED ONE FAMILY OVER**: `derivedHandSearch.test.ts`'s own residue lists *"up to 3 Basic {G} Energy cards"* (1 legal) for the identical reason, and D237 re-homed that suite's expired control ONTO this blocker. **One fix, three printings, two families** — the cheapest thing left on this page |
| *"**Flip 3 coins.** Put a number of cards up to the number of heads from your discard pile into your hand."* (`sv10.5w-076`/`-156`) | **2** | A `programPerHeads` whose `ops` **PARK** — owned by `deriveAttackCoinFlip`, a different reader. 🛑 **THIS IS D234's RESIDUE ROW #4 PRINTED AGAIN ONE VERB OVER**, and the two together are what falsify D236's *"the discard side does not print a leading clause even once"*. **The category is a property of the per-heads FOLD, not of the zone and not of the verb** — and *"can the per-heads expansion carry a parking op at all"* is still an unanswered question about `attack.ts`, now owed by two families instead of one |
