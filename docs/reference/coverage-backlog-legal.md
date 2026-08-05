# Simulator coverage — the STANDARD-LEGAL census (D219 re-measurement, 2026-08-04)

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
| **7** | **Opponent-hand family** — reveal / random discard / shuffle-back | **35** | ~14 arms + 2 ops | **2.2** | *"Discard a random card from your opponent's hand."* (8), *"Your opponent reveals their hand."* (7), *"Choose a random card…shuffles it into their deck."* (5). The reveal EVENT and redaction path exist inside `bottomFromOpponentHand`; a standalone op does not |
| **8** | **Deck-search → hand** in attack text, no new filter | **25** | ~15 arms | **1.7** | Filter kinds (`anyPokemon`/`supporter`/`basicEnergy`/`toolCard`) all exist |

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
