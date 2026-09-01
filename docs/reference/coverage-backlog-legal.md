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

🆕 **D290 — TIER 0 IS EXHAUSTED ON A SECOND, INDEPENDENT KEY.** D190's sweep
(and the re-run above) is keyed on the printed **SENTENCE** and crosses card
names. D290 ran the complementary census, keyed on the **PRINTING** and crossing
set codes: over all **452** `nonAttackRegistryIds()`, **44** catalog identities
are incomplete and **81** printings are unauthored — and
**`sum(legal_standard) = 0` over every one of them**, `sum(legal_expanded) = 81`,
**one** regulation mark (**G**). 🛑 **SO THE PRINTING AXIS AGREES WITH THE
SENTENCE AXIS: zero legal, zero-code alias wins remain.** The two scopes overlap
on 16 ids and neither subsumes the other (D190 holds 9 this cannot reach; this
holds 65 D190 never recorded; union **90**). The full table and the standing
refusal live in `packages/engine/src/reprintAliasLegal.test.ts`
(`PRINTING_ALIAS_CENSUS`, `SENTENCE_ONLY_SKIPS`). ⚠️ **RARE CANDY
`sv04.5-089` IS ONE OF THE 81 AND IS NOT A BACKLOG ROW** — it rode four handoffs
labelled *"the cheapest measured row on this page"* before anyone re-read D190's
rule that a registry row's price is its LEGAL count, not its catalog count.

🆕 **D291 — THE ACE SPEC POPULATION, MEASURED, AND THE ONE ROW IT LEAVES.**
Remote D1 `luminous`, 2026-08-08, ONE query — `rarity LIKE '%ACE SPEC%'` with **no
legality filter**, split by `trainer_type` and by registry membership: **33
printings**, Item **20** (8 already carry a registry row) / Tool **8** (2) /
Stadium **2** (1) / **Energy 3** (2). **Every one is `legal_standard = 1` and
regulation mark H**, `rarity` takes **exactly one** distinct ACE SPEC value, and
**ZERO of the 33 is a Supporter and ZERO is a Pokémon**. The inherited "33 legal
rows", carried unqueried through six handoffs, is EXACT.

🛑 **BUT A TOTAL IS NOT A POPULATION.** D291's bar reaches **30 of the 33**: the
three ACE SPEC **Special Energy** printings (`sv05-162` Neo Upper Energy,
`sv08-191` Enriching Energy, `sv06-167`) are played by `attachEnergy` (turn.ts),
which asks **no hand-play bar of any kind**. **NEW ROW, AND IT IS THE CHEAPEST
MEASURED ONE ON THIS PAGE: an ENERGY-SURFACE PLAY-FROM-HAND GATE, 3 legal
printings, 2 of them already registered.** The missing mechanism is **CODE, not a
catalog fact** — the same seam the POKÉMON surface sat at until D285 built
`pokemonPlayBarred`. ⚠️ **AND THE FUNNEL ALREADY ANSWERS CORRECTLY**:
`aceSpecBar.test.ts` §5 asserts `handPlayBarred(state, seat, "Item", aceEnergy)`
is `true` on the very board where the Energy attaches anyway, so only the CALL
SITE is missing. 🛑 **Price the `klass` argument before you take it** — a Special
Energy is not a `HandPlayClass`, so this is a second small funnel (D285's
precedent) or a nullable class, and that is a design call rather than a one-liner.

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
| ~~**7**~~ | ~~**Opponent-hand family** — reveal / random discard / shuffle-back~~ — ✅ **BUILT at D232** (21 of 31), 🆕 **+2 at D297**, 🆕🆕 **+5 at D445 → 28 of 31** | ~~35~~ **31** | ~~~14 arms + 2 ops~~ **4 arms + 2 ops** | **5.25** | 🛑 **THE FIRST ROW ON THIS PAGE WHOSE *EDIT* ESTIMATE HELD IN ITS LOAD-BEARING HALF AND WHOSE *COUNT* IS A NUMBER NOTHING REPRODUCES.** Its three per-sentence figures are each EXACTLY RIGHT (8 / 7 / 5) and their sum is 20 — so the **35** is not a mis-census of a sentence, it is a total nobody derived. Re-derived over `json_each` + `GLOB`, **grouped BY SENTENCE, all three text columns**, 2026-08-06: the three named sentences hold **20** in the ATTACK column; the family's whole set of verbs holds **31** there (17 reveal-compounds, 9 random-discard, 5 shuffle-back), **6** in abilities, **6** in `effect`, **43** across all three. **35 is none of them.** ⚠️ *A count without a COLUMN is as broken as a count without a POPULATION.* ✅ **"2 ops" IS EXACT** — the first edit estimate here to survive contact since row 3 — and "~14 arms" is **4**. The reason this family did NOT collapse to one anchor the way rows 5/6/8 did is the transferable part: **those sentences differed in a NOUN, these differ in the VERB**, and a verb selects the op. 🛑 **THE `needs` CELL WAS RIGHT AND STILL MISSED THE CHEAPEST PRINTING ON THE PAGE**: N's Purrloin `sv09-096` prints **Ortega's Trainer text verbatim as an ATTACK**, and `bottomFromOpponentHand` has carried an OPTIONAL `filter` since M5 — so that one is a bare anchor over an op, a field and an interpreter case that all already existed, unread for eighty slices because nobody grouped the census by SENTENCE. ✅ **AND `redact.ts` PRICED AT ZERO, WHICH IS THE OPPOSITE OF WHAT THIS ROW'S PROSE PREDICTED** (*"a hand REVEAL … must reach the opponent's snapshot"*): a printed reveal is INSTANTANEOUS, so the unconditional face-down hand is the CORRECT projection and the reveal's whole channel is the LOG — driven from all three viewpoints. `log.ts` took one arm. 🛑 **THE `rng.ts` QUESTION ANSWERS *NO BUMP*, ASKED BEFORE THE OP WAS WRITTEN**: `rngState` is a `GameState` field and `MatchRecord` persists the whole `GameState`, so a random pick replays exactly — but `rng.ts` did take its first diff since D145 (`randomIndex`, the scaling arithmetic `shuffle` has used since M1, EXTRACTED so the engine has one spelling of it). ⚠️ **THE 10 LEFT ARE ALL COMPOUNDS, not nouns**: a damage scaler over a hidden zone (3), a forced bench play out of the opponent's hand (2), a chosen discard from the revealed hand (2), a filtered sweep (1), running another card's Supporter effect (1), and `programPerHeads` over the built op (1). 🆕🆕 **D445 TOOK FIVE OF THOSE TEN (and D297 took two before it), SO THE ROW STANDS AT 28 OF 31 AND THE THREE LEFT ARE THE THREE THAT WERE ALWAYS GOING TO BE LAST.** ⚠️ **AND THE `needs` CELL WAS RIGHT ABOUT BOTH OF THEM, WHICH IS WORTH RECORDING BECAUSE THIS PAGE'S ESTIMATES USUALLY ARE NOT**: *"a damage scaler over a hidden zone"* became `DamageCountSource.cardsInOpponentHand` (the seventeenth member, and the FIRST in that union over a zone the other player cannot see), and *"a chosen discard from the revealed hand"* became one new `dest` VALUE on `bottomFromOpponentHand` — no new op, no new prompt kind, no new `CardFilter` member. 🛑 **WHAT THE CELL DID NOT SAY, AND IT IS THE WHOLE INTEREST OF THE SLICE: the *hidden zone* is not an obstacle, it is the MECHANISM.** A public damage number folded over a private zone is an information channel, and the printed reveal is what closes it — so the same string is claimed by TWO readers (`deriveAttackEffect` for the reveal, `deriveAttackDamageMultiplier` for the fold), the first sentence in the 640-row column with two owners. A slice that read only the fold would have shipped the leak while `BUILT.attack` stepped. ⚠️ **AND THE FAMILY WAS BIGGER THAN THIS ROW'S OWN COUNT**: corpus row 564 (*"This attack does 30 damage for each card in your opponent's hand."*, 1 legal) carries NO reveal at all, so it is outside this row's verb sweep entirely — it was found by a `hand` × `does N damage` grep over the committed corpus, and it is the CONTROL that makes the reveal's role provable rather than asserted (an unfiltered count reads hand SIZE, which is already public). 🛑 **THE TWO REFUSALS ARE D445's AND EACH HAS ITS OWN FALSIFIER**: the *filtered sweep* (1) is refused for its SHAPE and not its filter — the `anyOf` is free, but a mandatory TOTAL sweep has no offer to collapse and no question to ask, while this op's whole middle is a park; the *Supporter copy* (1) is refused as a member of row 16's family, RE-ARGUED for a Supporter rather than inherited, and the reasons come out stronger (a Supporter's program is a registry row keyed by card id, so a copy op would answer for nothing outside the 82 authored rows). See `opponentHandScaling.test.ts` §6 for both, driven. |
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

| | Units | Built (D187) | Built (`02b839c`) | Built (D233) | Built (D235) | Built (D236) | Built (D237) | Built (D238) | **Built (D239)** | **UNBUILT (D239)** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| attack effect text | 1,732 | 806 | 922 | 1,027 | 1,059 | 1,068 | 1,078 | 1,086 | **1,093** | **639** |
| ability text | 376 | 3 | 77 | 88 | 88 | 88 | 88 | 88 | **88** | **288** |
| Trainer effect text | 264 | 3 | 48 | 57 | 57 | 57 | 57 | 57 | **57** | **207** |
| Special Energy effect text | 11 | 0 | 2 | 2 | 2 | 2 | 2 | 2 | **2** | **9** |
| **total** | **2,383** | 812 | 1,049 | 1,174 | 1,206 | 1,215 | 1,225 | 1,233 | **1,240** | **1,143** |

⚠️ **THE D235-D237 COLUMNS ARE SLICES, NOT RE-SWEEPS.** D233's figures were
measured; every column after it is those plus what one anchor read (D234 +12 off
row 9, D235 +20 off row 10, D236 +9 off row 12, D237 +10 off row 13).
`censusAtHead.test.ts` re-computes all of them from the printed sentences on
every `bun run check`.

✅ **THE D238 COLUMN IS A RE-SWEEP, NOT A SLICE — the first since D233, and it
AGREES.** The seven readers were run over all 640 distinct legal attack sentences
(1,732 units) **twice**: in a detached worktree at `163ba4e` and at HEAD.

| Run | derived printings | + registry `attack` | **built** | column above says |
|---|---:|---:|---:|---|
| `163ba4e` (D237's HEAD) | 1,074 | 4 | **1,078** | **1,078** ✅ |
| **HEAD (D238)** | **1,082** | 4 | **1,086** | *(new)* |

So five slices of hand-incremented columns re-derive to the digit, and D238's own
delta (**+8**, over 271 → 276 distinct sentences) is exactly the 8 legal printings
its three suites drive — nothing was added to the unexplained residue of 2. **The
next full re-derivation should still be RUN rather than inherited; this one was.**

⚠️ **THE D239 COLUMN IS A SLICE, NOT A RE-SWEEP** (D238's is still the last full
one). Its **+7** is unusually easy to be sure of without one, and that is worth
recording as a shape rather than as an excuse: **all seven printings are ONE CARD**
— Terapagos ex *"Crown Opal"*, attack INDEX 1, across seven set codes — so the
yield is a REPRINT GROUP rather than a sentence family, and the delta has no room
to hide a second string. 🆕 **A one-sentence yield is self-auditing; a
multi-sentence one is not.** The next slice should still run the worktree sweep.

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
| ~~**9**~~ | ~~**Attach from the DISCARD PILE** — `attachEnergyFrom`, source side~~ — ✅ **ATTACK HALF BUILT at D234 (12 of 17), D246 (a 13th, free) and D248 (2 more, off a MAP KEY — 15 of 17)**; the ability/Trainer half is untouched and now sits in the residue row below | ~~**34** = 17 (12 sentences) · 12 · 5~~ → **22** = 5 · 12 · 5 | ~~~1 anchor~~ → **exactly 1 anchor** | ~17 → **12 for one arm** | ✅ **THE ONLY ROW ON THIS PAGE WHOSE COUNT SURVIVED RE-DERIVATION UNCHANGED, AND THE ONLY ONE WHOSE *PREDICTION* DID.** The row said 17 (12 sentences) · 12 · 5 and the re-run returned attack 17/12, ability 13/6, effect 6/4 — the two non-attack figures minus the one already-authored printing in each (`sv09-024`; N's PP Up `sv09-153`). It also predicted ONE anchor from D232's noun-versus-verb rule, in writing, so a successor could falsify it; one anchor is what it cost. ✅ Both read-site prices held: `programPlayable` ZERO for the attack half, `preventBlock.test.ts` §11 owed a row and got one. ⚠️ **AND A THIRD READ SITE NOBODY HAD PRICED WENT RED** — `counterBenchPut.test.ts` sweeps every derived op with a string `source` and asserts `"attack"`; `attachEnergyFrom.source` is a ZONE, so the guard's predicate was wider than its subject. Partitioned, not narrowed. See `derivedDiscardAttach.test.ts`. ✅✅ **D263 TOOK THE ABILITY HALF AND THE COUNT MOVED 22 → 12** — and the arithmetic had to be RE-DERIVED rather than decremented, because the cell's attack term was **stale**. `22 = 5 · 12 · 5` was written at D234 (17 − 12 = 5) and never updated when D246 took a 13th printing and D248 took two more; the honest attack residue is **2**, which is exactly what `censusAtHead.test.ts`'s row-9 `attack` array holds and has held since D248. So the row is **`12 = 2 · 5 · 5`** ✅✅ **D346 TOOK MAGNETON ×3 AND THE ROW IS `9 = 2 · 2 · 5`** — the ability residue falls **5 → 2** and the whole remainder of that arm is now Lycanroc `sv09-085`/`sv09-166` alone. **3 legal printings, ONE sentence, ONE program object, ZERO engine code** — `registry.ts` is the entire diff, and the pieces were `source: "discard"` (D234), `targetType` (D235) and `knockOutSelf` (D345, ONE DECISION OLD). 🛑🛑 **AND THE SLICE'S FINDING IS ABOUT THIS PAGE'S GENRE AGAIN, AT A NEW ANGLE: A WORK ORDER ROTS IN THREE DIRECTIONS, NOT TWO.** D263 recorded the first two — a row that gets BUILT and is not removed (caught by an assertion), and a row whose PIECE is bought by a slice that never opens the file (caught by nothing). **This is the third: a row whose blocker is SPENT and whose note is then REWRITTEN to name a different one.** D263 priced Magneton correctly (*"the attach IS expressible — 3 ops, `targetType: "Lightning"` — but no op in the engine knocks out its own host"*); D345 shipped `knockOutSelf`, spending exactly that blocker, and replaced the note with a claim that the *"in any way you like"* distribution was a second blocker — in **NINE FILES**. It never was: that phrase at a PRINTED COUNT is N `attachEnergyFrom` ops, which is D263's own `ASSEMBLE_ALLOY` and D205's `count` doc. **A STALE NOTE DISAGREES WITH THE CODE AND RE-DERIVES; A REWRITTEN ONE DISAGREES WITH NOTHING**, carries a fresh decision's authority, and routes the next slice past a card that is already buildable. **WHEN A SLICE SPENDS A BLOCKER, DELETE THE NOTE — do not re-point it without re-running the method's step (3) against the code.** See `overvoltDischarge.test.ts`, and it is the FIRST time this row's ability figure has moved at all. 🆕 **A CELL CAN GO STALE IN A TERM NOBODY TOUCHED: the machine-checked array moved and the prose beside it did not** — the same drift `legalNonAttackPrograms.test.ts` recorded at D249 between its narrative count and its assertion, one file over. 🛑 **NOT BY WIDENING THE ANCHOR — BY AUTHORING, WHICH IS WHAT D234's OWN NOTE SAID WOULD HAVE TO HAPPEN** (*"an Ability or a Trainer is a hand-authored registry row forever, so an anchor buys none of them"*). **3 registry programs, 7 legal printings on 3 sentences, ZERO engine code**: Archaludon ex `sv08-130`/`-224`/`-241` "Assemble Alloy" (3, an `onEvolve` trigger over TWO `attachEnergyFrom` ops — the printed *"in any way you like"*, D205's expansion and NOT `count: 2`), Team Rocket's Spidops `sv10-020`/`-187` "Charging Up" (2, `toSelf`), Eelektrik `sv10.5b-031`/`-114` "Dynamotor" (2, `energyType` + `benchOnly`). ⚠️ **THE LADDER'S PRESCRIBED FIRST RUNG RETURNED ZERO** — `%from your discard pile%attach%` matches nothing, because the verb is printed FIRST on all 38 rows; rung 2 `%attach%discard pile%` is the real one. 🛑 **THE 5 ABILITY PRINTINGS LEFT ARE TWO SENTENCES AND TWO SEAMS, PRICED AGAINST THE CODE**: Magneton `svp-153`/`svp-159`/`sv08-059` (3) needs an op that KNOCKS OUT ITS OWN HOST (none exists, grepped), and Lycanroc `sv09-085`/`sv09-166` (2) needs a card named by **NAME** (`attachEnergyFrom` narrows by `energyType`/`anyEnergy` only, and D246 refused it a `CardFilter` for a measured reason). 🆕 **AND THE SLICE'S TRANSFERABLE FINDING IS ABOUT THIS PAGE'S OWN GENRE: A WORK ORDER ROTS IN BOTH DIRECTIONS.** "Charging Up" sat in `DROPPED` asking for `attachEnergyFrom`'s SELF target — **built at D221, thirty-eight decisions earlier**, and reaching the discard zone for free because `source` is a field on the op and not a fork in it. A row that gets BUILT and is not removed is caught by an assertion; a row whose PIECE is bought by an unrelated slice is caught by nothing. **Re-check any blocked cell against the CODE, not against its own string.** See `legalNonAttackPrograms.test.ts` |
| ~~**10**~~ | ~~**Deck-search that ATTACHES** — `attachFromDeck`~~ — ✅ **ATTACK HALF BUILT at D235 (20 of 28)**; the ability/Trainer half is untouched | ~~**33** = 28 (17 sentences) · 4 · 1~~ → ~~**13** = 8 (5 sentences) · 4 · 1~~ → 🆕 **D347: 10** = 8 (5 sentences) · **1** · 1 | ~~~1 anchor + 1 destination table + 1 new subgroup rider~~ → **exactly 1 anchor + 1 optional group + 1 destination table; NO new rider** | ~11 → **20 for one arm** | ✅ **THE ONLY ROW ON THIS PAGE WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION — not just the attack half.** The re-run returned attack 28/17, ability 5/3, effect 5/2; the row's `28 (17) · 4 · 1` is those minus what is already authored (`sv10-136`; the four-printing Janine sentence). **33 = 33**, two rows running. 🛑 **BUT ITS *PREDICTION* WAS GRADED WRONG, WHICH IS THE FIRST TIME AND THE POINT OF WRITING ONE DOWN.** The arm count was right (one anchor, D232's rule a third time); the printing count was 23 predicted / 20 delivered, because **A DESTINATION TABLE IS NOT PORTABLE BETWEEN TWO OPS JUST BECAUSE ITS KEYS ARE** — `attachEnergyFrom` has `count` (a batch pinned to ONE body, D205) and `attachFromDeck` does not, so *"attach **them** to **1 of** your Pokémon"* is expressible one op over and NOT here. ✅ Both read-site prices held: `programPlayable` ZERO (twice over — attacks skip it AND this op is ungated), §11 owed a row and got one. ⚠️ **AND TWO CONTROLS EXPIRED**: Okidogi ex `sv06.5-036` is a REAL pool printing whose index 0 is this family's §9.2-tail sentence, and `clauseTable.test.ts` asserted it unbuilt twice — re-homed, not deleted. See `derivedDeckSearchAttach.test.ts` |

| ~~**11**~~ | ~~**Look at the top N** — `lookAtTopN`~~ — ✅ **ATTACK HALF BUILT at D241 (10 of 15)** and 🆕🆕 **CLOSED-BUT-ONE at D341 (4 more — the whole ORDERED-ANSWER mechanism)**; the ability/Trainer half (5 · 13) has been worked down by D333/D334/D335/D336 | ~~**33** = 15 (7 sentences) · 5 · 13~~ → ~~**23** = 5 (3 sentences) · 5 · 13~~ → 🆕 **19** = 1 (1 sentence) · 5 · 13 | ~~~2 anchors~~ → **3 anchors + 1 op field + 1 event field + 2 §11 verdicts; NO new op, NO new prompt kind** → 🆕 **D341: 1 anchor + 1 NEW op + 1 NEW prompt kind + 1 NEW choice kind + 1 validateChoice arm + 1 redact arm + 1 wire member + 1 projection arm + 2 HUD dialogs + 1 event + 1 log row + 1 §11 verdict** | ~16 → **10 for three arms** → 🆕 **4 for one** | ✅ **THE EIGHTH ROW RUNNING WHOSE COUNT SURVIVED RE-DERIVATION, AND THE FIRST WHERE THE FIGURE UNDER TEST WAS THIS PAGE'S OWN INHERITED ONE.** `GLOB '*[Ll]ook at the top*'` over `json_each` + all three text columns, `legal_standard = 1`, GROUPED BY SENTENCE (2026-08-06): attack **15 / 7 sentences** (3·3·3·2·2·1·1) — exactly the `15 (7 sentences)` this cell has carried unverified since D233. ⚠️ **AND THE VERB WAS SWEPT WIDER THAN THE ROW** (D239's rule, third slice running): `'*top card of your deck*'`, `'*top card of your opponent*'`, `'*[Rr]eveal*deck*'` and `'*top * cards of*'` return **32 further sentences and NOT ONE is this family** — the mill, the deck search's printed reveal, row 16's copy-an-attack and two damage scalers. **"Look at" and "Reveal" are different verbs and they select different OPS.** 🛑 **THE EDIT ESTIMATE'S ARM COUNT LOST IN BOTH DIRECTIONS AT ONCE.** It named *"the put-them-back-in-any-order shape"* and *"the you-may-put/attach/discard shape"*: the first is the one arm this slice CANNOT write, and the second is **three** destinations (Bench, an `attachFromTop` attach, and the discard), not one. 🛑 **AND THE FIDELITY DEBT IT NAMED WAS REAL BUT MIS-LOCATED.** *"Ships a look the opponent never sees"* is true, and it is not about `redact.ts` (priced at **ZERO** — the `chooseCards` prompt resolves identities to the ANSWERER ALONE and the looked-at cards go back under a shuffle, so **D232's hand-reveal ruling transfers to the deck top intact**). The defect was that `DECK_TOP_REVEALED` **only ever fired when cards MOVED**, so the WHIFF and the DECLINE — the two paths where a look becomes pure private knowledge — emitted nothing at all. Fixed at the push site, flagged as an assumption, pinned by a mutant installing the other reading. 🆕 **A READ-SITE CENSUS PRICES THE SITES THAT EXIST; IT CANNOT FIND AN EVENT THAT IS NEVER PUSHED.** ✅ `programPlayable` **ZERO** (deliberately — `attachFromTop`'s ruling/284 argument: every printing carries a leftovers clause that always resolves); §11 owed **two** rows and probes (`lookAtTopN`, `attachFromTop` — the FIFTH time this page has caught reachable-but-unclassified ops); `log.ts` non-zero twice over. 🆕 **A CEILING IS A QUANTITY, NOT A NUMBER** — Lapras ex prints *"the top **20** cards"*, so `MAX_PRINTED_LOOK_WINDOW` (30) had to be its own constant beside `MAX_PRINTED_ATTACH_COUNT` (10) or three printings would have derived to null silently. 🆕 **A NEAR-MISS TABLE CAN BE FULL AND PROVE NOTHING ABOUT THE LAYER IT NAMES** — two mutants survived their first run for this reason (every malformed window was refused by the GUARD, not the capture class; and the trailing-clause case existed on one of three anchors). **Three anchors need three of every case.** See `derivedLookAtTop.test.ts` — and 🆕🆕 **D341, `derivedReorderTop.test.ts`.** ✅✅ **THE ROW'S OWN 2024-ERA RESIDUE NOTE PRICED D341's SLICE TO THE LINE, AND THAT IS THE MOST USEFUL THING ON THIS PAGE.** It said the ordered answer needs *"a new prompt kind, a new wire schema member, a new redact arm, a new projection arm and two new dialogs"* and predicted BOTH riders — *"a `whose` fork and the event's `actor` field both arrive with those printings and not before"*. All seven landed unchanged (`orderCards`, the zod member, `redactPrompt`, `projection.ts`, `GameHud`/`OnlineHud`, `reorderTop.side`, `DECK_TOP_REORDERED.actor`). 🛑 **A RESIDUE NOTE THAT NAMES THE MECHANISM IS A PRICE A LATER SLICE CAN SPEND; THE ONES THAT ROT NAME A CARD** — which is the same finding D340 reached from the other end, and this row is the positive instance beside its four negatives. 🛑 **AND THE ROW'S *UNIT* WAS WRONG FOR FOUR SESSIONS WHILE ITS MECHANISM WAS RIGHT.** D336-D339 each re-priced this residue as *Deduction Kit `sv08-171`, **1 legal*** and each correctly concluded that no arrangement of `chooseCards` caps yields an order. The construction census — `instr(<col>,'in any order')` over all three text columns — is **15 printings / 11 legal / 7 sentences**, and **Deduction Kit is not the cheapest member of its own family**: it prints the buildable sentence PLUS *"**, or** shuffle them and put them on the bottom of your deck"*. The four printings D341 built print the ordering ALONE. **CENSUS THE SENTENCE, THEN CHECK WHETHER THE CARD YOU WERE SENT FOR IS THE CHEAPEST THING THAT SENTENCE BUYS.** 🆕 **AND THE MISSING PIECE WAS NEVER THE ANSWER'S SHAPE.** `chooseCards` has answered with a `string[]` since M5; what did not exist was a CONSUMER THAT READS THE INDICES — every `chooseCards` consumer iterates the answer to MOVE cards, so two answers naming the same uids are the same board and the validator is free to treat the array as a set. **A prompt kind is a claim about what an answer MEANS, not about what it is made of.** ⚠️ **WHAT IS LEFT OF THE ATTACK HALF IS ONE PRINTING ON ONE SENTENCE AND IT IS A DIFFERENT MECHANISM**: Inkay `sv06.5-033`, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."* — `reorderTop.side` already reads a second seat's deck, so the ZONE is no longer the blocker; what still blocks it is the two-seat CONSENT (the actor asks, the owner shuffles), i.e. `opponentMayDraw`'s shape pointed at a deck. |
| **11-R** 🆕 | **The deck-top REORDER — row 11's measured residue** (D241) | **5** = 5 (3 sentences) · 0 · 0 | **1 new PROMPT KIND (an ordered answer) + a `whose` fork + the event's `actor` field** | **5** | 🛑 **ONE MECHANISM, NOT THREE SENTENCES.** *"Look at the top 5 cards of your opponent's deck and put them back in any order"* (**3** — `sv10-088`, `sv10.5w-042`/`-125`), the same on your OWN deck (**1** — `sv05-080`), and *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck"* (**1** — `sv06.5-033`). Every prompt this engine has answers with a **SET** (`chooseCards`, `choosePokemonMulti`, `attachCards`, `moveEnergy`); a reorder needs a SEQUENCE, which is a new `EffectPrompt` member, a new wire schema member, a new `redact.ts` arm, a new `projection.ts` arm and **two new dialogs**. ⚠️ **AND 4 OF THE 5 REACH THE OPPONENT'S DECK**, which `stepOp` cannot do at all today (it slices `state.players[ctx.seat].deck` and nothing else) — so a `whose` fork (the `discardDeckTop` shape) and `DECK_TOP_REVEALED.actor` (the `DECK_TOP_DISCARDED` shape) both arrive with these printings and were deliberately NOT built at D241 as unread fields. Pinned derived-to-null in `derivedLookAtTop.test.ts` |
| ~~**12**~~ | ~~**Attach from the HAND** — `attachEnergyFrom`, hand side~~ — ✅ **ATTACK HALF BUILT at D236 (9 of 16)**; the ability half (10 printings, including the 4-printing *heal 30* Ability the row named) is untouched | ~~**26** = 16 (8 sentences) · 10 · 0~~ → **17** = 7 (4 sentences) · 10 · 0 | ~~~1 anchor + a destination table~~ → **1 anchor (a FACTORY shared with row 9) + 1 optional group + 1 new op FIELD** | ~13 → **9 for one arm** | ✅ **THE THIRD ROW RUNNING WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION.** `GLOB '*ttach*Energy card*from your hand*'` (run standalone; verified disjoint from rows 9-11) returns attack **16 / 8 sentences** · ability 29 / 8 · effect **0 / 0**; the row's `16 (8) · 10 · 0` is the attack half exact on BOTH figures, the ability half minus the 19 already authored, and a Trainer column that is a MEASURED zero. **26 = 26.** ✅ **AND IT WAS THE CONTROL FOR D235's RULE, WHICH SURVIVES AS STATED** — same op, so `DISCARD_ATTACH_DESTINATIONS` ports **VERBATIM** (not one new key; the destination with 0 legal printings at D234 has 2 here and worked first run). 🆕 **BUT THE PORTABILITY BOUGHT ALMOST NOTHING, AND THAT IS THE FINDING: A SOURCE-ZONE MIRROR TRANSFERS THE *ANCHOR*, NOT THE *FAMILY*.** The same shape read 12 of 17 one zone over and 9 of 16 here — **six of the sixteen are blocked by a LEADING CLAUSE or an UNBOUNDED COUNT, categories the discard side does not print even once.** 🛑 A third clause of D235's prediction is **VACUOUS rather than confirmed**: no attack printing here spells *"up to N … to 1 of your …"*, so `count` — D235's whole blocker — has nothing to do. 🛑 **AND THIS SLICE'S OWN PREDICTION LOST ON THE FIELDS**: `healTarget` is the first new op field in three slices, because `recordGate` → `healChosen` PARKS and would let the player heal a Pokémon the card never named. ⚠️ One expired *"unbuilt"* control re-homed in `derivedDiscardAttach.test.ts`. See `derivedHandAttach.test.ts`.  ⚠️ **THE ABILITY HALF CONTAINS THE CHEAPEST SINGLE PROGRAM LEFT IN THE POOL**: `sv07-014`/`-156`/`-167`/`sv08.5-011` (**4 legal**) print *"attach a Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, **heal 30** damage from that Pokémon"* — the BUILT 8-printing group `svp-166`/… is the same sentence with **draw a card** instead of heal, so this is D221's `attachEnergyFrom {recordAs}` → `recordGate` shape with `healChosen` in the tail. ✅ **D249 BUILT IT — AND THE FOUR-TIMES-WRONG *"ZERO ENGINE CODE"* PRICE HELD FOR THE FIRST TIME**: 1 registry program + 4 id rows + 1 fixture demonstrator, with `effects.ts`, `interpreter.ts` and `cardplay.ts` BYTE-IDENTICAL after the slice. The count re-derived at **4** on a query run over the SENTENCE and not these ids (`LIKE '%if you attached energy to a pok%in this way%'`, all three text columns, `legal_standard = 1`, GROUPED BY SENTENCE, 2026-08-07) — SIXTEENTH row running. 🛑 **BUT THIS CELL'S PRESCRIBED SHAPE WAS WRONG**: it said *"D221's `attachEnergyFrom {recordAs}` → `recordGate` shape with `healChosen` in the tail"*, and the shipped program carries **no `recordAs`, no `recordGate` and no `healChosen`** — it is ONE op with `healTarget: 30`, D236's rider, because `recordAs` files ENERGY uids and a §9.2 gate could only reach a heal that PARKS. 🆕 **A CELL CAN BE RIGHT ABOUT THE OBSTACLE AND WRONG ABOUT THE ROAD — the fourth failure mode found on a `needs`-style claim.** ⚠️ The widening found two other sentences and BOTH are false positives (the 8-printing Teal Dance group, BUILT at D221; a 3-printing DECK-search ATTACK with a status tail). **The ability half is now 6, and the row's attack half stands at 1.** See `ripeningCharge.test.ts`. ✅ **D250 TOOK THE ABILITY HALF'S TRIGGERED THIRD AND THE SAME PRICE HELD A SECOND TIME**: `sv06.5-025`/`sv08.5-054` Bloodmoon Ursaluna *"Battle-Hardened"* — *"When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon"* (**2 legal**, byte-identical reprints) is **1 registry program + 2 id rows and NOTHING ELSE** — ZERO fixtures, ZERO decks, and `effects.ts` / `interpreter.ts` / `cardplay.ts` / `triggers.ts` BYTE-IDENTICAL after the slice. Every field it needs was left lying around by another slice for another card: `onPlayToBench` (M4 slice 6), `count` (D205), `toSelf` (D221), `energyType`. The count re-derived at **2** on the SHAPE and not these ids (`LIKE '%when you play this pok%onto your bench%attach%'`, all three text columns, `legal_standard = 1`, GROUPED BY SENTENCE, 2026-08-07) — SEVENTEENTH row running. ✅ **AND THE FLAGGED LOSS POINT — `ctx.sourceUid` ON THE TRIGGER DISPATCH PATH — HELD**: `runBoardTrigger` already passes it, so `toSelf` cost no engine line. 🆕 **THE FINDING IS THAT WIDENING A ROW'S QUERY IS A LADDER, NOT A MOVE**: at the width prescribed (opening + the verb *"attach"*) the sweep returns ONE other sentence (`sv06-132`, a Pokémon-Tool deck search); at the bare printed opening it returns SIX, two of them BUILT. **The rung you stop on decides whether you measure the MECHANISM or the IDIOM.** **The ability half is now 4** — the 3-printing `svp-116`/`sv06-033`/`sv06-173` DISJUNCTION (*"a Basic {R} Energy card, a Basic {F} Energy card, **or 1 of each** … in any way you like"* — a disjunction over energy TYPES `attachFromHand.filter` has no spelling for, plus a cap D247's op deliberately has none of) and `sv09-107`'s *"**whenever you attach** an Energy card from your hand"* (a TRIGGER KIND `triggers.ts` does not have) — **and the row's attack half still stands at 1.** See `battleHardened.test.ts`. ✅✅ **D351 TOOK THE DISJUNCTION AND THE ABILITY HALF MOVED 4 → 1** — Infernape `svp-116`/`sv06-033`/`sv06-173` "Pyro Dance" (**3 legal**, the whole population of the sentence) is BUILT. 🛑 **AND THIS CELL WAS RIGHT ABOUT THE OBSTACLE AND WRONG ABOUT THE ROAD, WHICH IS THE SECOND TIME THAT HAS HAPPENED ON THIS ROW** (D249's `healTarget` was the first, and the cell that failed then is three sentences up). It said the sentence needed *"a disjunction over energy TYPES `attachFromHand.filter` has no spelling for, plus a cap D247's op deliberately has none of"*. It needed **NEITHER**: *"in any way you like"* is N independent `attachEnergyFrom` ops (`ASSEMBLE_ALLOY`'s reading since D263), and TWO such ops with two `energyType`s are the disjunction AND the cap at once — `attachFromHand` was never the road at all. What was actually missing was **one predicate in `cardplay.ts`**: `programPlayable` asked its attach question ONE OP AT A TIME, so a hand holding the second type and not the first greyed the Ability out on a board the print names as one of its three outcomes. It is now PROGRAM-scoped (`attachAlternativesAllWhiff`), and the defect was unreachable from a printed row until this one — every earlier multi-op producer is HOMOGENEOUS (Koraidon) or a TRIGGER (Archaludon). 🆕 **THE ROW WAS FOUND BY CENSUSING THE CLAUSE, WHICH SPANS TWO ROWS OF THIS TABLE**: `instr(col,'or 1 of each')` is `effect` **0** / `abilities_json` **4 printings / 4 legal / 2 sentences** / `attacks_json` **0** (remote D1, keyed on `$.effect`, 2026-08-15), and the fourth printing is **row 10's** Steven's Metagross ex `sv10-145`, refused because it ALSO prints a disjunction on the TARGET axis (*"to your {P} Pokémon **and** {M} Pokémon"*) where `AttachTargetRiders.targetType` is a single `string`. ⚠️ **ONE PRINTED CHOICE IS NOT EXPRESSED AND IT IS RECORDED RATHER THAN GLOSSED**: `choosePokemon` has no decline (where `attachCards`/`chooseCards`/`moveEnergy` do), so a controller holding one of each attaches BOTH — inherited behaviour, identical on `ASSEMBLE_ALLOY`'s *"up to 2"* since D263, whose doc claimed the opposite in prose and is now struck. **The ability half is 1 and the attack half is 1; the row is two printings from empty.** See `pyroDance.test.ts`. ✅✅ **D356 TOOK THE LAST ABILITY PRINTING AND THE ABILITY HALF IS NOW 0** — Magearna `sv09-107` "Auto Heal" (*"**As long as this Pokémon is in the Active Spot,** whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon."*, **1 legal printing**) is BUILT, and with it **the `ROWS` table's LAST LIVE RESIDUE falls 1 → 0**. 🛑 **AND THIS CELL WAS WRONG ABOUT THE ROAD FOR THE THIRD TIME ON THIS ONE ROW** — D249's `healTarget` was the first, D351's disjunction the second. It said the sentence needed *"a TRIGGER KIND `triggers.ts` does not have"*. `triggers.ts` had it: `onEnergyAttach` has been a `TriggerTiming` since D319, the moment was already fired at turn.ts §6.2, `triggersOf` had partitioned self/opponent, and `activeOnly` predates all of it — **only the SELF DIRECTION was unpopulated**, which D319's own comment in `registry.ts` said in as many words (*"spelled and unpopulated, exactly like a union member waiting for its first printing"*). What was owed was a self-direction sweep and ONE new op (`healSubject`, `damageSubject`'s pronoun twin — the seat comes off the printed POSSESSIVE, not the scan direction). 🛑 **D354 AND D355 EACH REFUSED THIS ROW ON THE RATIO AND THE RATIO WAS CORRECT**: *"whenever you attach"* re-censused at D356 is **3 printings / 0 / 0 with 1 legal** over the three columns. **A POPULATION AND A PRICE ARE DIFFERENT MEASUREMENTS, AND THIS ROW WAS REFUSED TWICE BECAUSE ONLY ONE OF THEM WAS EVER TAKEN.** ⚠️ **THE REACH WAS MEASURED RATHER THAN ASSUMED AND IT IS ZERO FURTHER LEGAL PRINTINGS**: the sweep also reaches Minior `sv04-099`/`sv04-201` (rotated; same timing, switch consequent, additionally blocked on a BENCHED-only gate that does not exist), the op also reaches Medical Energy `sv04-182` (rotated), and wiring the self sweep at the two OTHER watched moments would reach nothing at all. ⚠️ **AND A COUNT READ OFF THE CONSEQUENT WOULD HAVE PRICED THE OP AT 8**: *"heal N damage from that Pokémon"* is 11 printings / 8 legal, but seven of the eight perform their own attach and are already built through `attachEnergyFrom.healTarget` (Hydrapple ex ×4, Leafeon ×3). **A SHARED CONSEQUENT IS NOT A SHARED MECHANISM.** **The ability half is 0 and the attack half still stands at 1.** See `autoHeal.test.ts` |
| ~~**13**~~ | ~~**The discard pile into the hand or onto the Bench** — `discardPileRetrieval`~~ — ✅ **ATTACK HALF BUILT at D237 (10 of 16) AND D238 (4 more, the BRACE CODE — 14 of 16)**; 🆕 **ABILITY AND TRAINER HALVES BUILT AT D264 (5 of 7)** and 🆕 **THE LAST NON-ATTACK SENTENCE AT D265 (Alomomola's HP threshold)** — the row is down to **2 = 2 (attack, per-heads) · 0 · 0** | ~~**23** = 16 (8 sentences) · 4 · 3~~ → ~~**13** = 6 (3 sentences) · 4 · 3~~ → ~~**4** = 2 (1 sentence) · 2 · 0~~ → **2** = 2 (1 sentence) · 0 · 0 | ~~~1 anchor + a noun table~~ → **1 anchor + 1 `CardFilter` member + 1 new op `dest` + 2 tables** | ~11 → **10 for one arm** | ✅ **THE FOURTH ROW RUNNING WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION.** `GLOB '*[Pp]ut*from your discard pile*'` returns attack **16 / 8 sentences** · ability **4 / 2** · effect 8 / 5; the row's `16 (8) · 4 · 3` is the attack half exact on BOTH figures, the ability half RAW, and the Trainer half the 8 minus the 5 already authored. **23 = 23** — and four rows running means the METHOD rather than the luck is what fixed these counts. 🛑 **BUT THE ROW'S *EDIT ESTIMATE* WAS SHORT BY A WHOLE OP DESTINATION, AND OVER-COUNTED THE THING IT DID NAME.** *"~1 anchor + a noun table"*: the noun table was **already built** (D231's `HAND_SEARCH_NOUNS` is exactly it, one row short), and what it did not price is `discardPileRetrieval.dest: "bench"` + its `retrieveMove` arm + its bench-space clamp + its `DISCARD_RETRIEVED` value + the `log.ts` row. **Two slices running have under-priced by exactly one mechanism.** 🛑 **AND THE PREDICTION IT WAS CHOSEN TO TEST LOST, TAKING D236's CLAIM WITH IT.** *"Grammar is a property of the ZONE, so the arm reaches ≥ 12 of 16 and every blocker is a NOUN"* — it reads **10**, and no arm could reach 12. Four of the six refusals ARE nouns (**ONE blocker, the printed BRACE CODE, wearing two of them** — and the same blocker `derivedHandSearch` already names in its own residue); the other two are the leading *"Flip 3 coins."*, which D236 called a category *"the discard side does not print even once"* — **it prints it TWICE, in both verbs**, here and in D234's own residue. 🆕 **So a leading clause is a property of neither the ZONE nor the VERB — it is a property of the per-heads FOLD.** 🆕 **`CardFilter.trainerCard` IS THE CATEGORY, NOT A DISJUNCTION OF THE FOUR SUBTYPES** (Wailord `sv08-087`): it reads `category` alone, so a fifth printed subtype is admitted the day it is ingested. ⚠️ One expired *"unbuilt"* control re-homed in `derivedHandSearch.test.ts`. ✅ Read sites priced by grep and **ONE WAS NOT ZERO**: `log.ts` owed a THIRD arm and its absence was a live CONTRADICTION (a Bench put announced as a shuffle into the deck); §11 owed a row + probe; `programPlayable` ZERO for §8's reason, not the row's — the arm the row priced belongs to its ABILITY half. **10 legal, 26 CATALOG** — the widest legal-to-catalog spread any row on this page has shown. See `derivedDiscardRetrieval.test.ts`. 🆕 **D264 SWEPT THE ABILITY AND TRAINER HALVES FOR THE FIRST TIME AND THE ROW'S WHOLE COUNT RE-DERIVED A THIRD TIME.** The zone ladder run wide (rung 0 `%discard pile%`, all three columns, `legal_standard = 1`, grouped by `json_extract(value,'$.effect')`, 2026-08-07) is **98 printings / 57 sentences** — ability 23/11, attack 52/30, effect 23/16 — and the row's own verb leaves exactly the **7 unbuilt ids `censusAtHead.test.ts` already named**. D264 took **5 of the 7 on 2 sentences**: Lana's Aid `sv06-155`/`-207`/`-219` (3, Supporter) and Arven's Greedent `sv10-159`/`-205` (2, Ability, on D250's `onEvolve`). **ZERO new ops, ZERO new op fields, ZERO anchors** — the whole cost is TWO OPTIONAL `CardFilter` RIDERS, `anyPokemon.noRuleBox` and `byName.cardNoun`. 🛑 **AND THE ROW'S EDIT ESTIMATE WAS OVER-PRICED THIS TIME RATHER THAN UNDER**: the cell asked for *"1 anchor + 1 `CardFilter` member + 1 new op `dest` + 2 tables"* and the non-attack halves needed **no anchor at all** (there is no ability/Trainer deriver) and **no new member** (two riders on members that existed). 🛑 **WHAT IS LEFT IS 2 ATTACK PRINTINGS ON THE PER-HEADS FOLD AND 2 ABILITY PRINTINGS ON AN HP THRESHOLD** — Alomomola `sv10.5b-024`/`-108`, whose `DROPPED` `needs` string D264 found WRONG IN BOTH DIRECTIONS (it asked for `dest: "bench"`, built at D238, and counted Bianca's Devotion as a sibling when that is a BOARD read of REMAINING HP). Re-priced: an HP-threshold rider is **5 printings on 2 sentences across 2 ops** (this row 2 + Buddy-Buddy Poffin 3, `searchDeck`). 🆕 **D265 BUILT IT AND THE RE-PRICING WAS EXACT — THE ROW'S NON-ATTACK HALF IS NOW EMPTY.** `basicPokemon.maxHp`, ONE optional rider, ONE `matchesFilter` conjunct, ONE `retrieveNoun` phrase; ZERO new ops, ZERO new op fields, ZERO anchors, ZERO deriver arms. 🛑 **AND IT IS THE FIRST ROW ON THIS PAGE WHOSE VOCABULARY PAID OUT IN A DIFFERENT ROW**: Buddy-Buddy Poffin is `searchDeck` over the DECK and belongs to the deck-search family, not to this zone — so **3 of the 5 printings this rider bought are not counted anywhere in this cell**. A per-row price cannot see a vocabulary item's real yield. **The row is down to 2 = 2 (attack, per-heads fold) · 0 · 0** |
| ~~**14**~~ | ~~**The ABILITY column's three biggest reprint groups**~~ — ✅ **TWO OF ITS THREE PROGRAMS BUILT at D242 (12 of 18)**; the third is a whole mechanism and is now row **14-R** | ~~**18** = 0 · 18 · 0~~ → **6** = 0 · 6 · 0 | ~~3 registry programs~~ → **2 registry programs, but ONE of them cost 1 `BoardCondition` member + 1 `PassiveEffects` field + 2 readers + 3 read sites** | 6.0 | ✅ **THE NINTH ROW RUNNING WHOSE COUNT SURVIVED RE-DERIVATION.** `GROUP BY` over `json_each(abilities_json)`, `legal_standard = 1`, GROUPED BY SENTENCE, ranked by printings, with the registry ids subtracted by running `programFor` locally (2026-08-06): the row's three sentences are **6 · 6 · 6 = 18**, its own figure exactly. 🛑 **BUT ITS SUPERLATIVE IS FALSE, AND ITS OWN QUERY FALSIFIES IT — the second time this page has lost on a claim beside the count** (row 15's damage-cap arm). *"The three biggest"* is not what these three are: the biggest UNBUILT ability group is **SEVEN** (Festival Grounds, row **14-B** below) and there are **FOUR** six-printing groups, not three (the Future aura, also 14-B). 🆕 **A SUPERLATIVE IS A THIRD CLAIM, AFTER THE COUNT AND THE COMPOSITION, AND IT IS THE ONE NO QUERY OVER THE ROW'S OWN IDS CAN CHECK** — run the `GROUP BY` WITHOUT them and read what sits above. 🛑 **AND "THREE REGISTRY PROGRAMS, ZERO ENGINE CODE" LOSES ON TWO OF THE THREE — the FIFTH time this page has been wrong about that** (its own warning, on row 12). *Power Saver*: the cell said `preventAttack` + a `BoardCondition` over `ownerPokemon`, *"both exist"*, and **NEITHER DOES** — `preventAttack` is an attack-installed OP writing a one-turn stamp, this is an always-on printed Ability a §9 lock must SILENCE, and `BoardCondition`'s 22 members held no subgroup COUNT. **PRICE THE CHANNEL, NOT THE TOKEN.** *Seasoned Skill*: ✅ genuinely zero engine code — and the finding is that **D199 had DECLINED it in `legalNonAttackPrograms.test.ts`'s `DROPPED` table on a fact about the card that was never queried** (*"would discount the card's OTHER attack"* — it has none; all six printings are one attack, named Blood Moon). 🆕 **A DECLINE IS A CLAIM TOO, AND IT ROTS THE SAME WAY A COUNT DOES.** ✅ `programPlayable` **ZERO**; §11 owed **ZERO** (the first row in six, measured — this slice adds no `EffectOp`); `log.ts`, `projection.ts` and `MATCH_RECORD_VERSION` all **ZERO**. 🛑 The prediction's `redact.ts` clause named the WRONG FUNCTION: `redactedAbilitiesOf` owes zero (a `passive` has nothing to activate), `redactedAttacksOf` owes a clause. See `abilityAttackGate.test.ts` |
| ~~**14-R**~~ | ~~**Iron Leaves ex's on-bench switch — row 14's measured residue**~~ (D242) — ✅ **BUILT AT D244**, and the whole of row **14** is now closed | ~~**6** = 0 · 6 · 0~~ → **0** | ~~1 SELF-promote + `moveEnergy` off its single-source coupling + a destination pinned to `ctx.sourceUid`~~ → **exactly that, plus a fourth piece the row did not enumerate (`max: number | "any"`)** | 6.0 | ✅ **THE ELEVENTH ROW RUNNING WHOSE COUNT SURVIVED RE-DERIVATION** (`GROUP BY` over `json_each(abilities_json)`, `legal_standard = 1`, 2026-08-06: **6 on 1 sentence**, exactly the six ids). ✅ **AND THE FIRST `needs` COLUMN ON THIS PAGE TO SURVIVE BEING BUILT.** Ten slices running found a row's price wrong; this row asked for (1) a switch naming the body the trigger fired on, (2) `moveEnergy` off its single-source coupling, (3) a destination pinned to the source uid — and all three shipped verbatim as `switchActive.fromSource`, `anySource` at its second route, and `moveEnergy.route: "othersToSelf"`. 🆕 **A `needs` STRING IS A CLAIM ABOUT THE ENGINE AND A DECLINE IS A CLAIM ABOUT THE CARD, AND THEY ROT INDEPENDENTLY** — D242's Blood Moon decline was wrong about a card while its grammar was right; this one was right about the code. 🛑 **BUT THE COLUMN MOVED BY SEVEN, NOT SIX.** Widening the row's own query from its six IDS to the printed PRONOUN (`LIKE '%you may switch it with your active pok%'`) returns **7 legal printings on 2 sentences** — Meowscarada `sv09-018` "Showtime" prints the same clause as a once-per-turn ACTIVATED Ability, and it is what makes the `programPlayable` read site drivable at all (a TRIGGER never passes through that gate). 🆕 **A ROW IS A SET OF IDS AND AN OP FIELD IS A SET OF SENTENCES; ONLY THE SECOND PREDICTS THE COLUMN.** 🆕 **AND A FLAGGED EQUIVALENCE IS RECORDED RATHER THAN GLOSSED**: behind the switch, `othersToSelf` is byte-identical to `benchToActive` + `anySource` on all six printed boards (the tail runs behind the `recordGate`, so the source is always the Active by then). The route is spelled anyway — `moveNote` needs a token for the printed WORDS regardless — and the other reading is installed as the mutant `D244-othersToSelf-is-benchToActive`, killed only by a CONSTRUCTED board (`fix-othersmove`). ✅ `MATCH_RECORD_VERSION` **ZERO** (the prediction's flagged clause held): `max: "any"` is clamped at the park, so the prompt still carries the number every downstream reader reads. See `benchSwitchTrigger.test.ts` |
| ~~**14-B**~~ 🆕 | ~~**The two big ability groups row 14's SUPERLATIVE missed**~~ (D242) — ✅ **THE AURA MECHANISM IS BUILT at D243 and (b)'s NAMED HALF IS UNBUILDABLE**; what shipped is 7 printings of the SAME family on a different three sentences | ~~**13** = 0 · 13 · 0~~ → **13** = 0 · 13 · 0 (7 unchanged; 6 BLOCKED) | ~~2 registry programs, both needing engine work~~ → (a) still a second ATTACK DECLARATION; (b) **1 `PassiveEffects` field + 1 seat scan + 1 read site, DONE — and its own six printings still need an INGEST change** | 6.5 | 🆕 **FOUND BY RUNNING ROW 14's OWN QUERY WITHOUT ROW 14's IDS IN IT.** (a) *"If Festival Grounds is in play, this Pokémon may use an attack it has **twice**…"* — **7 legal** (`sv06-018`/`-044`/`-089`/`-170`/`sv08.5-010`/`-020`/`-021`), **the biggest unbuilt group in the whole ability column**, and it needs a second ATTACK DECLARATION inside one turn plus a re-entry after the opponent promotes: closer to row 16's missing seam than to a registry object. **UNTAKEN.** (b) *"Attacks used by your **Future** Pokémon, except any Iron Crown ex, do 20 more damage…"* — **6 legal** (`svp-146`/`sv05-081`/`-191`/`-206`/`-216`/`sv08.5-158`). 🛑 **STILL 6 UNBUILT AFTER D243, AND THE REASON IS THE INGEST RATHER THAN THE ENGINE.** D243 built the aura this row said it needed — a seat-wide pre-W/R bonus whose SOURCE and BENEFICIARY are different bodies — and the `Future` sentence **cannot ride it**: the narrowing is a `CardFilter`, every member of which reads an INGESTED COLUMN, and the Ancient/Future banner is printed on the card FACE and is in NO column (`SELECT suffix, COUNT(*) FROM cards WHERE legal_standard=1 GROUP BY 1` → **NULL 1668 · ex 353**, re-verified at HEAD 2026-08-06, not inherited from D146/D204/D205). 🆕 **A "CHEAPEST ENTRY POINT" IS A CLAIM ABOUT WHAT COMES AFTER IT, AND IT ROTS LIKE A COUNT OR A SUPERLATIVE DOES** — this cell priced the entry point exactly right and the thing it was an entry TO was already known-unbuildable, in this repo's own comments, two decisions earlier. 🆕 **AND A SLICE CAN BUILD A ROW'S MECHANISM AND MOVE ITS COUNT BY ZERO**, a third way a row and a build disagree (after D238's residue and D240's born-and-died row). What D243 shipped instead is row **14-B(b)-BUILT** below. See `seatDamageAura.test.ts` |
| **14-B(b)-BUILT** 🆕 | ✅ **The SEAT-WIDE pre-W/R damage AURA — BUILT at D243** (7 of the family's 16) | **0** = 0 · 0 · 0 (was 7) | **1 `PassiveEffects` field (`seatDamageBonusBeforeWR`, OUTSIDE `passivesOf`) + 1 own-side scan (`seatPreWRDamageBonus`) + 1 read site (`attackerPreWRBonus`) + 3 registry programs** | 7.0 | ✅ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE TENTH ROW RUNNING**, and the sweep was WIDER than the row (D239's rule): the printed idiom *"Attacks used by your … do N more damage to your opponent's Active …"* over `json_each` on **all three text columns** with `legal_standard = 1`, GROUPED BY SENTENCE (2026-08-06) returns **SEVEN sentences / 16 printings** in the ability column, of which the row named two. Built: *"Attacks used by your Pokémon do 20 more damage…"* (Serperior ex "Regal Cheer", `sv10.5b-003`/`-156`/`-164`, **3**), *"…your **Cynthia's** Pokémon do 30 more…"* (`sv10-008`/`-184`, **2**) and *"…your **Hop's** Pokémon do 30 more… **The effect of Extra Helpings doesn't stack.**"* (`svp-184`/`sv09-117`, **2**). ✅ **THE RESUME POINT'S MECHANISM CALL WAS RIGHT**: every existing pre-W/R bonus field is folded by `passivesOf(attacker)` and modifies its HOLDER only, so this needed `seatDamageReductionAfterWR`'s scan shape pointed at the BONUS seam — the aura-scan family's TENTH member. ✅ **AND ITS `redact.ts` ZERO HELD, after losing twice in the opposite direction** — the FUNCTIONS are `redactedAbilitiesOf` (lists ACTIVATED abilities; a `passive` has none) and `redactedAttacksOf` (reports COST; a damage number is not a payability fact), driven by a byte-equality case. 🛑 **BUT "TWO READ SITES" WAS ONE**: `attack.ts`'s main hit and `snipeActive` both take a **ZERO** diff because the attacker's card is resolved inside `attackerPreWRBonus`, and the interpreter's other damage sites owe zero **structurally** — the printed clause says *"to your opponent's ACTIVE Pokémon"* and those are the bench-reaching sites. 🆕 **`noStack` IS A KEYED CAP, NOT A BOOLEAN** — *"The effect of Extra Helpings doesn't stack"* names ONE Ability, so two Snorlax are 30 and a Snorlax beside a Serperior is 50; a boolean would silently merge two different non-stacking auras. See `seatDamageAura.test.ts` |
| ~~**14-B(b)-R**~~ ✅ | ~~**The aura family's three DEFERRED singles — D243's measured residue**~~ — ✅ **BUILT AT D245, ALL THREE, PLUS A FOURTH SENTENCE THE ROW COULD NOT SEE** | ~~**3** = 0 · 3 · 0~~ → **0** = 0 · 0 · 0 (**6** printings shipped, not 3) | **1 `CardFilter` disjunction · 1 `typedPokemon.stage` widening · 1 TARGET-side narrowing** | 4.0 | Each is one field-widening away from D243's `beneficiary`, and each names a DIFFERENT widening, which is why they are a residue rather than a rider: (1) `sv09-007` *"…your **{G} Pokémon and {R} Pokémon** do 20 more…"* — a **DISJUNCTION** of two `typedPokemon` filters, which `CardFilter` cannot spell (it is a flat union, not a combinator); (2) `sv08-021` *"…your **Evolution {R}** Pokémon do 10 more…"* — `typedPokemon.stage` admits only `"basic"`, where `ownerPokemon.stage` admits both, so the two stage riders disagree by construction and one of them is wrong; (3) `sv07-038` *"…do 30 more damage to your opponent's **Active Evolution** Pokémon"* — narrows the **TARGET** rather than the beneficiary, i.e. `damageBonusBeforeWRIfTarget`'s seam (which stores a `PokemonSuffix`, not a stage) and not this one. ⚠️ **NONE of the three is blocked on data** — all three read `types_json` / `stage`, columns the catalog has — which is exactly what separates them from the six `Future` printings above. ✅ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE TWELFTH ROW RUNNING** (1 · 1 · 1 on three sentences, exactly these ids) **AND THE PREMISE HOLDS** — `SELECT types_json, stage FROM cards WHERE id IN (…)` returns `["Grass"]`/Stage1, `["Fire"]`/Basic, `["Water"]`/Stage2, so all three are answerable from columns the catalog has. ✅ **THE `needs` COLUMN IS RIGHT ON TWO OF THREE**: `anyOf` is the union's first COMBINATOR, and the stage riders really did disagree with `typedPokemon` the wrong one. 🛑 **THE THIRD IS WRONG — `damageBonusBeforeWRIfTarget` IS A `passivesOf(attacker)` FOLD**, so its source and beneficiary are one body; Primal Knowledge is an aura and needs a `target` rider on the SEAT-SCANNED field. 🆕 **A `needs` COLUMN CAN NAME A REAL FIELD, DESCRIBE ITS PAYLOAD CORRECTLY, AND STILL BE WRONG, BECAUSE THE FIELD IT NAMES IS ON THE OTHER SIDE OF A FOLD.** 🛑 **AND THE ROW IS 3 WHERE THE COLUMN MOVED 6.** Running `typedPokemon.stage`'s OWN query rather than this row's (`LIKE '%evolution {%'`, `json_each` over all three text columns, `legal_standard = 1`, 2026-08-06) returns **2 sentences / 4 printings**: Genesect ex "Metallic Signal" (`sv10.5b-067`/`-161`/`-169`) is a DECK SEARCH demanding the same field value, and it had been sitting in `legalNonAttackPrograms.test.ts`'s `DROPPED` list since D199 with a `needs` string that D238 satisfied. 🆕 **A ROW IS A SET OF IDS, AN OP FIELD IS A SET OF SENTENCES, AND A FIELD *VALUE* IS A SET OF MECHANISMS.** See `auraNarrowing.test.ts` || ~~**15**~~ | ~~**Prevent all damage by ATTACKER CLASS** — `preventDamage.fromClass`~~ — ✅ **ATTACK HALF BUILT at D239 (7 of 9)**; the remaining **2 are a PERMANENT FLOOR, not a remainder**, and the ability half (8) is untouched | ~~**17** = 9 (3 sentences) · 8 · 0~~ → **10** = 2 (2 sentences) · 8 · 0 | ~~Widen `fromClass` to a class table + a separate damage-CAP arm~~ → **exactly 1 optional group on the EXISTING anchor + 1 new interface + 3 retyped fields + 1 structural comparator + 1 log renderer** | ~8.5 → **7 for one group** | ✅ **THE SIXTH ROW RUNNING WHOSE *WHOLE* COUNT SURVIVED RE-DERIVATION.** `GLOB '*[Pp]revent all damage*by attacks from*'` returns attack **10 / 4 sentences** · ability **8 / 4** · effect **1 / 1**; subtract the 1 attack sentence already read since 0.95.0 and the 1 effect printing already authored (`sv06.5-060` Neutralization Zone, a `stadium` program) and the row's `9 (3) · 8 · 0` is exact on **every** figure. **17 = 17.** ✅ Its ZERO-§11 prediction held — the first row in six to owe none, measured. 🛑 **BUT THE ROW'S *COMPOSITION* CLAIM WAS FALSE, AND ITS OWN QUERY FALSIFIES IT.** *"a separate damage-CAP arm for the 3 printings that say if that damage is 40/60 or less"* — **zero of the 9 say it**: those 3 never contain *"by attacks from"* and were never inside this GLOB. 🆕 **A COUNT AND A COMPOSITION ARE TWO CLAIMS AND ONLY THE FIRST IS UNDER THE QUERY.** They are now row **17** below. 🛑 **AND THE 2 SURVIVORS ARE NOT AN UNWRITTEN ARM**: `Ancient` (`sv06.5-009`) and Miraidon `sv08-069` are both blocked on a SUPPLY-SIDE ABSENCE, and 🆕 **the second one's blocker is not its class token at all** — *"Pokémon ex"* is answerable today (`pokemonSuffixOf`); what it cannot spell is its TARGET (*"each of your **Future** Pokémon"*, a block over a SET of bodies, over a second demand-only banner, with a trailing leave-the-spot terminator the turn stamp does not carry). **The row priced the token and not the noun, which is why its prediction said 8 and the answer is 7.** 🆕 **`MATCH_RECORD_VERSION` 12 → 13 was the eighth read site and no list named it** — the SAME FIELD produced a no-bump at D146 (a key ADDED) and a bump here (the key RETYPED). See `typedClassBlock.test.ts` |
| ~~**17**~~ | ~~**Prevent all damage UP TO A CAP** — `preventDamage`, a `maxDamage` field~~ — ✅ **THE ATTACK COLUMN IS BUILT WHOLE at D240 (3 of 3)**; the 1 ability printing is the OPPOSITE POLARITY on a different CHANNEL and is not a remainder this row can reach | ~~**3** = 3 (2 sentences) · 1 · 0~~ → **0** = 0 · 1 · 0 | ~~1 anchor + 1 op field + 1 `AttackBlock` field + a DAMAGE-AMOUNT parameter threaded through the four §8.5 read sites~~ → **exactly that, plus 1 event field, 1 log suffix and a FIFTH call site the estimate did not name** | **3** | ✅ **THE SEVENTH ROW RUNNING WHOSE COUNT SURVIVED RE-DERIVATION, AND THE FIRST TO BE BORN AND DIE WITHOUT EVER ENTERING `censusAtHead.test.ts`'s `ROWS`.** `GLOB '*if that damage is*'` over `json_each` + all three text columns, `legal_standard = 1`, GROUPED BY SENTENCE (2026-08-06): attack **3 / 2** · ability **1 / 1** · effect **0 / 0** — the row's own figures exactly. **3 = 3.** ⚠️ **AND THE VERB WAS SWEPT WIDER THAN THE ROW** (D239's rule): `'*damage*'` AND (`'*or less*'` OR `'*or more*'`) over the same three columns returns eleven further sentences and every one is a damage SCALER or a heal filter. There is no fourth cap printing in the pool. 🛑 **THE EDIT ESTIMATE WAS RIGHT ABOUT THE HARD PART AND SHORT BY TWO SITES.** *"the four §8.5 read sites"* is **five** — `attackEffectRefused` reads the same block and now passes `undefined` **on purpose** (an EFFECT has no damage for a cap to be about, so a capped block never refuses one) — and it named no event field and no log row, both of which a capped block owes: a row saying only *"protected"* is a lie about a 90-damage attack. 🛑 **THE RULES QUESTION IT FLAGGED IS SETTLED AND STILL FLAGGED.** The sentence prints NO parenthetical, so §8.5's step list decides it: prevention and reduction share ONE step, and the cap is read against **the number that would actually be placed** (post-W/R, post-reduction, floored at 0). The counter-argument is recorded beside the code and pinned by a named case plus a mutant that installs the other reading. 🆕 **A COMPARATOR IS A TOKEN, NOT A SHAPE** — `(less|more)` is captured and `more` is REFUSED, because the pool prints that exact polarity (`sv07-044`). ⚠️ **AND THE ABILITY PRINTING IS NOT A REMAINDER THIS ROW CAN TAKE**: it is an always-on ABILITY, i.e. a `passivesOf` CATALOG aura rather than an `AttackBlock` INSTALLATION, so it could not ride this record even with the comparator stored. **Price the CHANNEL, not the token.** See `damageCapBlock.test.ts` |
| **16** | **Copy an attack** — *"…and use it as this attack"* | **13** = 13 (6 sentences) · 0 · 0 | **A genuinely new mechanism — no seam exists** | — | `GLOB '*use it as this attack*'`. Listed as a row because it is the biggest single attack-column family with no cheaper sibling, and flagged so nobody re-prices it as an anchor. It needs an attack to RESOLVE ANOTHER PRINTED ATTACK — cost, coin flips, §8.5 fold and all — from four different sources (a Benched owner-prefixed body, the opponent's Active, the top of a deck, and a revealed pile). D232 already left one of these on its own family (*"use the effect of a Supporter card you find there"*, 1 printing); this is the same missing seam |

~~**Rows 9-16 account for 114 of the 705 unbuilt attack printings — 16 %.**~~
~~**At D234: 102 of 693 — 15 %.**~~ ~~**At D235: 82 of 673 — 12 %.**~~ ~~**At D236: 73 of 664 — 11 %.**~~ ~~**At D237: 63 of 654 — 10 %.**~~ ~~**At D238: 59 of 646 — 9 %.**~~ ~~**At D239: 52 of 639 — 8 %**~~ ~~**At D240: 52 of 636 — 8 %**~~ **At D241: 42 of 626 — 7 %** 🆕 **D241 MOVES BOTH HALVES TOGETHER (52 → 42, 636 → 626), WHICH IS THE ORDINARY SHAPE AND IS WORTH NAMING BESIDE THE TWO ANOMALIES BELOW**: row 11 was in the ranked table before the slice and is still in it after, so its 10 printings leave the numerator and the denominator at once. ⚠️ **AND D240 WAS THE FIRST SLICE SINCE D233 NOT TO MOVE THIS FRACTION AT ALL, WHICH WAS CORRECT RATHER THAN A STALL.** Row 17's 3 printings were measured into the doc by D239 and deliberately kept OUT of the fraction it reported; D240 built all three, so the row never entered the ranked table and the NUMERATOR stands still while the denominator falls by 3. **A row can be born and die without ever appearing here** — the mirror of D238's residue finding (work that moved `BUILT.attack` and not `inRows`), and the same cause: this table is a snapshot, not a ledger (the new row 17's 3 are counted from the next slice, not retro-fitted into a fraction measured before it existed). 🆕 **AND D238 IS THE FIRST SLICE TO MOVE `BUILT.attack` BY MORE THAN IT MOVED THIS FRACTION** — half its yield (4 of 8) was in `derivedHandSearch`'s RESIDUE, which has had no ranked row since D231 took row 8, so `BUILT.attack` moved 8 while `inRows` moved 4. **A residue is a measured backlog too, and taking one does not show up in the ranked table at all.** That number is pinned in `censusAtHead.test.ts`
and it is the point: **D187's backlog was fat families; what is left is a long
tail, and eight rows of it is a seventh.**

⚠️ **THE FRACTION FELL RATHER THAN ROSE, AND IT WILL KEEP FALLING — THAT IS THE
SHAPE OF EVERY SLICE FROM HERE.** Taking a NAMED row shrinks the named part of the
backlog faster than it shrinks the whole, because the unnamed 267-string tail
below is untouched by anything an anchor can do. **A rising "% named" would mean
the census had found new fat families; a falling one means the work is going where
the page says it should.**

### 🆕 D234's RESIDUE — ✅ **D246 TOOK ONE FOR FREE AND D248 TOOK THE SPREAD; 2 legal attack printings remain (2 blockers)**

**Written back as its own row rather than left as "the rest of row 9", because the
five are FOUR different blockers and only one of them is an anchor's job.** Each is
pinned derived-to-null in `derivedDiscardAttach.test.ts` with the reason.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| ✅ ~~*"Attach a Basic {F} Energy card from your discard pile to **each of** your Benched Pokémon."*~~ (`sv05-092`/`sv05-175` Mudsdale) | ~~2~~ **BUILT (D248)** | 🆕 **THE CELL NAMED THE RIGHT BLOCKER, THE RIGHT PRICE AND THE WRONG *LOCATION*, AND THE LOCATION WAS THE WHOLE SLICE.** *"A spread attach with no decision in it"* is exactly right, and *"`attachEnergyFrom` attaches to ONE `ref`"* is true of the **APPLY** and was never true of the **ANCHOR** — which is the half nobody checked for fourteen slices. The destination is a `([^.]+)` capture resolved through `DISCARD_ATTACH_DESTINATIONS`, so this phrase had been MATCHING since D234 and the only missing thing was a **MAP KEY**. `deriveAttackEffect` is byte-identical after the slice. 🆕 **A ROW THAT LOOKS LIKE A MISSING ARM CAN BE A MISSING MAP KEY — price a table-driven destination by asking which KEY is missing before asking which ANCHOR is.** 🛑 And the cell's `toEachBench` is the one thing it got wrong: what shipped is **`toEach` beside the EXISTING `benchOnly`**, two orthogonal fields, because the printed word *"Benched"* already had a spelling on this op. 🛑 **AND ITS PARENTHETICAL IS FALSE**: the rotated *"…to each of them"* sibling is **2 LEGAL**, not 0 — Glass Trumpet `sv07-135`/`sv08.5-110`, in the **`effect` column** (a TRAINER), behind *"You can use this card only if you have any Tera Pokémon in play"*. 🆕 **A "0 LEGAL" MEASURED IN ONE COLUMN IS NOT A FACT ABOUT THE POOL.** It is still not this reader's — there is no Trainer deriver — and its LEADING CLAUSE is a real second blocker: a bounded player-chosen subset, which `toEach`'s "the eligible set IS the count" reading contradicts outright. See `derivedDiscardAttach.test.ts` |
| ✅ ~~*"Attach **an** Energy card from your discard pile to this Pokémon."*~~ (`sv08-110` Landorus) | ~~1~~ **BUILT (D246), AT ZERO COST TO THIS ROW** | The cell was RIGHT about the blocker and about the read sites, and it was **the only place on this page that named it** — the row-12 twin (`sv06-136`) sat 40 lines below with the same reason and nothing joined them. D246 built `anyEnergy` for the HAND printing and this one arrived free, because the NOUN is in the clause both zones share. 🆕 **A WIDENED NOUN TRANSFERS ACROSS EVERY ZONE THE FACTORY SERVES.** ⚠️ Found by widening the row's query from its ids to the printed sentence — third time in four slices that move has paid |
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

### 🆕 D236's RESIDUE — ✅ **D246 TOOK TWO OF THE FOUR, D247 TOOK THE LARGEST; 1 legal attack printing remains**

**Written back as its own row rather than left as "the rest of row 12".** 🆕 **AND
THE HEADLINE IS THAT NOT ONE OF THE FOUR IS ABOUT THE DESTINATION** — every one
names a phrase `DISCARD_ATTACH_DESTINATIONS` already spells, which is D235's rule
holding, and **six of the seven printings are blocked by a shape the SIBLING zone
never prints at all.** That is what "a source-zone mirror transfers the anchor, not
the family" means in printings. Each is pinned derived-to-null in
`derivedHandAttach.test.ts` with the reason.

✅ **D246 BUILT ROWS 2 AND 3 AND BOTH `needs` CELLS WERE RIGHT — the first time two
cells in one slice have been.** `sv06-136` really was "one `anyEnergy` rider away"
and `sv08-068`'s "EVERY OP IT NEEDS EXISTS" survived being checked **field by
field** rather than by name (`toSelf` reads `sourceRef`, which finds the attacker
wherever it sits — load-bearing, because that card switches itself to the Bench
before it feeds itself). What is left is **5 printings on ONE blocker**, an
UNBOUNDED COUNT, which is the shape the sibling zone never prints — so D236's
finding gets stronger rather than expiring.

✅ **D247 THEN BUILT THE UNBOUNDED COUNT AND THIS ROW IS ONE PRINTING FROM EMPTY.**
The remaining printing is the two-mechanism outlier (`sv10-056`), which is an
unbounded count **and** an ORDERING clause. 🆕 **THE CELL WAS HALF-RIGHT IN A NEW
WAY: it named the right blocker and the wrong remedy.** *"The shape exists one op
over"* pointed at `attachFromTop.max: "any"`; what was actually portable is the
compound `attachCards` **park**, and the axis separating the two ops that produce
it is the candidate **ZONE**. A third zone is a third OP. **When a cell says "the
shape exists one op over", ask which BYTE of that op is the shared part and which
is the argument** — the same question D246's noun/zone finding asks, arriving at
the level of ops rather than of clauses.

🛑 **AND THE WIDENED QUERY FOUND TWO MORE SENTENCES, BOTH ALREADY BUILT** (the
top-20 deck look, 3 legal, D241's; *"Attach up to 2 Basic {P} …"*, 2 legal,
D236's). 🆕 **WIDENING A ROW'S QUERY FINDS PRINTINGS THAT ARE ALREADY BUILT AT
LEAST AS OFTEN AS IT FINDS NEW ONES.** Three of the last four slices found new
ones; this one found none. **Run it anyway — its yield is a CHECK on the row's
premise first and a source of printings second.**

🆕 **AND THE SLICE MOVED A ROW IT WAS NOT SENT TO.** `sv06-136`'s blocker is the
printed NOUN, and the noun lives in the clause BOTH source zones share — so
Landorus `sv08-110` *"Attach an Energy card from your **discard pile** to this
Pokémon."* (row 9's residue, 1 legal) came free, with no arm of its own. **A
WIDENED NOUN TRANSFERS ACROSS EVERY ZONE THE FACTORY SERVES**, which is the exact
converse of D236's own finding that a widened ZONE transfers the anchor and not the
family: mirror the argument and you get one family; widen the shared part and you
get all of them. **Widening the row's query from its two ids to the printed
sentence is what joined them** — nothing on this page connected the two cells,
though both were written correctly.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| ✅ ~~*"**You may** attach **any number** of Basic Energy cards from your hand to your Pokémon in any way you like."*~~ (`sv08-133`/`-225`/`-242`/`-248`) | ~~4~~ **BUILT (D247)** | The cell had the BLOCKER right and the REMEDY wrong, which is a new way for this page to be half-right. The unbounded count was indeed what stopped it. But *"the shape exists one op over as `attachFromTop.max: \"any\"`"* priced the wrong thing: what was portable is the compound `attachCards` PARK, and what separates the two ops that produce it is the candidate **ZONE** (a deck-top window vs the whole deck) — so a THIRD zone is a THIRD OP, `attachFromHand`, not a source axis on either. ✅ **AND THE PARK REALLY WAS FREE**: `validateChoice`'s `attachCards` arm reads `prompt.candidates`/`prompt.targets` and NOTHING off the op, so zero wire fields, zero validator arms, zero HUD lines. 🛑 **THE FIXTURE ALREADY HELD THE SENTENCE** (index 47, fielded by D236 as its own refusal's live subject), so the slice appended nothing — grep the demonstrator for the BLOCKER STRING, not the row |
| ✅ ~~*"Attach **an** Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon."*~~ (`sv06-136`) | ~~1~~ **BUILT (D246)** | The cell was RIGHT: `attachableEnergies` admitted `"Normal"` only, and `attachEnergyFrom.anyEnergy` lifts it at that one helper — so `programPlayable` and both HUD row-lighting mirrors came along for free, exactly as the cell said. Its heal tail cost the tail's two new axes (a printed NUMBER, and the pronoun *"**this** Pokémon"* refereed against the destination) |
| ✅ ~~*"**Switch this Pokémon with 1 of your Benched Pokémon. If you do,** attach up to 2 Basic {L} Energy cards from your hand to this Pokémon."*~~ (`sv08-068`) | ~~1~~ **BUILT (D246)** | The cell was RIGHT, and it is the first "EVERY OP IT NEEDS EXISTS" on this page to survive. ⚠️ **THE CLAUSE IT DID NOT PRICE WAS THE `If you do` GATE**, which is the whole card on an empty Bench — a build with the two ops and no gate accelerates where the printed card does nothing |
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
| 🛑 **The printed "reveal" on a deck search** (D224, 2026-08-05) — **NOT a coverage row: a FIDELITY row over printings this file already counts as BUILT** | **37 of 41** | ⚠️ **A DEBT NOBODY HAD COUNTED, BECAUSE FOUR REGISTRY DOC COMMENTS ASSERT IT IS FREE.** *"A search that ends in the hand is public by construction"* / *"reveal them implicit in a to-hand search"* — **measured false**: the `chooseCards` prompt is redacted to the ANSWERER alone, the hand is withheld, and the only thing crossing the wire is a **count-only** `DECK_SEARCHED` log row. 16 authored rows drop the clause today. ⚠️ **AND THE ONE-LINE FIX IS DEAD ON THE NUMBERS: 4 of the 41 Standard-legal to-hand search printings print NO reveal** (Cassiopeia `sv06.5-056`/`-086`/`-094`, Amulet of Hope `sv08-162` — all four search unfiltered *"cards"*, where a reveal is a real leak), so **the reveal is a property of the printed SENTENCE, not of the DESTINATION**. Wants an optional rider on the op read at the log site (`log.ts`); ~~the twin debt sits on `lookAtTopN`/`DECK_TOP_REVEALED`~~ ✅ **THE TWIN DEBT IS SETTLED AT D241, AND IT WAS NOT WHERE THIS ROW SAID IT WAS.** The `reveal` rider on `lookAtTopN` was already built (D225); what was missing was that `DECK_TOP_REVEALED` **only fired when cards MOVED**, so the WHIFF and the DECLINE — the two paths where a look becomes pure private knowledge — announced nothing at all. 🆕 **AND `redact.ts` PRICED AT ZERO, WHICH IS THE OPPOSITE OF WHAT THIS ROW'S SIBLING PROSE PREDICTED, FOR THE SECOND TIME** (D232 found the same on the HAND): a deck-top look never made anything face-up to anyone but the looker and the leftovers go back under a shuffle, so **the LOG is the whole channel and the answerer-only `chooseCards` gate is already correct**. The defect was COVERAGE, not ROUTING — and no read-site grep can find an event that is never pushed. Pinned red-able in `proton.test.ts` and driven in `derivedLookAtTop.test.ts` |

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

### ~~D237's RESIDUE~~ → 🆕 **D238 TOOK THE BRACE CODE — row 13's residue is now 2 printings on ONE blocker**

**The smallest residue any row on this page has ever had, and it is not a noun at
all.** D237 left 6 printings on 2 blockers and named the larger of them — *one
mechanism, two families* — as the next slice; D238 took it. What is left belongs
to a **different reader** and to an unanswered `attack.ts` question, so no further
work on `ATTACK_DISCARD_RETRIEVAL` can reach it. Pinned derived-to-null in
`derivedDiscardRetrieval.test.ts`.

| Printed sentence | Legal | What it actually needs |
|---|---:|---|
| ~~*"Put up to 3 **{W}** Pokémon … onto your Bench."*~~ (`svp-131`, `sv06.5-012`, `sv06.5-080`) | ~~3~~ | ✅ **BUILT at D238** — `CardFilter.typedPokemon`, resolved through D234's `POKEMON_TYPE_BY_CODE` |
| ~~*"Put a Basic **{G}** Energy card … into your hand."*~~ (`sv06.5-013`) | ~~1~~ | ✅ **BUILT at D238**, and it needed **NO new filter**: `basicEnergy.energyType` has carried a type since Chien-Pao and only the ANCHOR was ever in the way |
| *"**Flip 3 coins.** Put a number of cards up to the number of heads from your discard pile into your hand."* (`sv10.5w-076`/`-156`) | **2** | A `programPerHeads` whose `ops` **PARK** — owned by `deriveAttackCoinFlip`, a different reader. 🛑 **THIS IS D234's RESIDUE ROW #4 PRINTED AGAIN ONE VERB OVER**, and the two together are what falsify D236's *"the discard side does not print a leading clause even once"*. **The category is a property of the per-heads FOLD, not of the zone and not of the verb** — and *"can the per-heads expansion carry a parking op at all"* is still an unanswered question about `attack.ts`, now owed by two families |

### 🆕 D238's OWN FINDING — a residue table is a census of ITS OWN SLICE, not of what an arm will serve

Three suites between them named **ONE** rotated brace-coded printing. The
catalog-wide sweep over the SAME anchors returns **FOUR**, on three sentences —
and two of those sentences appear on no page in this repo:

| Printed sentence | Catalog | Legal | Named by |
|---|---:|---:|---|
| *"Put up to 3 Basic **{W}** Energy cards from your discard pile into your hand."* | 2 | 0 | **nobody** |
| *"Put up to 2 Basic **{M}** Energy cards from your discard pile into your hand."* | 1 | 0 | **nobody** |
| *"Search your deck for a Basic **{G}** Pokémon and put it onto your Bench…"* | 1 | 0 | `derivedBenchSearch.test.ts`'s near misses |

⚠️ **This is why *"an arm transfers across sets"* has to be RE-MEASURED per slice
rather than inherited from the row that named the legal half.** The legal count
(8) was exact — the fifth row running to re-derive to the digit — and the CATALOG
count was under by 3. The two are different questions and the residue tables only
ever answer the first.

⚠️ **AND THE CEILING WAS NOT THE YIELD, WHICH THE ROW ITSELF PREDICTED.** The raw
sweep `GLOB '*{[GRWLPFDMYNC]} Pok*'` returns **attack 32 / 16 sentences · ability
28 / 12 · effect 25 / 15**; **6** of those 32 attack printings are CARD predicates
this slice could reach. The other 26 are BOARD targets (*"1 of your Benched {L}
Pokémon"*), damage scalers (*"30 damage for each of your {G} Pokémon in play"*)
and conditional-damage clauses — `targetType` and three other readers own them,
and `matchesFilter` cannot reach an `InPlayPokemon` at all. **Separate the CARD
predicate from the BOARD rider before pricing either.**

### 🆕 D255's RESIDUE — the `%prevent all damage%` ABILITY column, measured to the digit

**The ladder, run against the remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`)
on 2026-08-07 with `legal_standard = 1`, GROUPED BY SENTENCE, on ALL THREE text columns —
and the columns are reported SEPARATELY, which is the finding.**

```sql
-- rung 2, the one this slice built from
SELECT lower(json_extract(a.value,'$.effect')) AS s, COUNT(*) n, group_concat(c.id) ids
FROM cards c, json_each(c.abilities_json) a
WHERE c.legal_standard = 1
  AND lower(json_extract(a.value,'$.effect')) LIKE '%prevent all damage%'
GROUP BY s ORDER BY n DESC;                       -- 22 printings / 9 sentences

-- rung 1 and rung 3, the same query over the other two columns
--   … FROM cards c, json_each(c.attacks_json) a …   -- 34 printings / 9 sentences
--   … WHERE lower(c.effect) LIKE …                  --  1 printing  / 1 sentence
```

🛑 **THE FINDING: THE DURATED §11 SPELLING IS BIGGER THAN THE MECHANISM IT WAS EXPECTED TO
PAD.** All **34** attack-column printings are *"During your opponent's next turn, prevent all
damage…"* — an attack-INSTALLED block (`deriveAttackEffect` → `preventDamage` →
`attackBlockOf`), already built, with **no reader on the aura field at all**. The one
`effect`-column printing is Neutralization Zone `sv06.5-060`, built at D159. 🆕 **A PHRASE
CENSUS THAT DOES NOT NAME ITS COLUMN IS A CENSUS OF THE PHRASE AND NOT OF THE MECHANISM** —
D255's resume point predicted 25–40 ability printings on 12–20 sentences AND predicted the
durated spelling would be the biggest false-positive class. Both are the same fact, and the
size prediction lost because the false positives are in a column the ability figure never
included: **22 on 9, not 25–40 on 12–20.**

**The ability column's 9 sentences, with the built/unbuilt split MEASURED by running
`programFor` over every returned id (not assumed):**

| n | sentence | status |
|---|---|---|
| 5 | …by your opponent's Pokémon that have an Ability. | ✅ BUILT D251 |
| 3 | …from and effects of attacks from your opponent's **Tera** Pokémon… | 🛑 **UNBUILDABLE** |
| 3 | …by attacks from your opponent's Pokémon ex. | ✅ **BUILT D255** |
| 3 | As long as this Pokémon is on your Bench, … | ✅ BUILT D253 |
| 2 | …that have any Special Energy attached. | ✅ BUILT D252 |
| 2 | …to your Benched Pokémon that don't have a Rule Box… | ✅ **BUILT D256** |
| 2 | …by attacks from your opponent's **Basic** Pokémon ex. | ✅ **BUILT D255** |
| 1 | …from your opponent's Pokémon done to your Benched Pokémon. | ✅ BUILT D254 |
| 1 | …if that damage is 200 or more. | ✅ **BUILT D257** |

🆕 **RE-RUN AT `6b78e11` ON 2026-08-07 BY D257's SESSION AND UNCHANGED — 22 on 9 in
`abilities_json`, 34 on 9 in `attacks_json`, 1 on 1 in `c.effect`.** Nothing has been
ingested, so the LADDER is confirmed as a population and not merely as a phrase.
✅ **D256 THEN TOOK ROW 15-A's 2**, so the residue is **4 printings on 2 sentences**: the
3-printing TERA group (permanently unbuildable) and row **15-B** alone. **Row 15-B is
therefore the LAST buildable member of the whole `%prevent all damage%` ability column.**

So **11 of 22 were built coming in, D255 takes 5, and the residue is 6 on 3 sentences** —
three of which are the permanently unbuildable Tera group (D252's finding: "Tera" is in NO
ingested column; `SELECT suffix, COUNT(*) … GROUP BY suffix` returns only `null` and `ex`,
and every `name`/`effect` hit for "Tera" is DEMAND, never SUPPLY).

| row | what | printings | needs | est |
|---|---|---|---|---|
| ~~**15-A**~~ ✅ | ~~**The BENCH-WIDE Rule-Box prevention**~~ — ✅ **BUILT AT D256, AND ITS `needs` CELL IS THE FIRST ON THIS PAGE TO SURVIVE BEING BUILT WORD FOR WORD.** Everything the cell below prescribes shipped verbatim: the widening is INSIDE `benchShieldedFromDamage`'s SCAN and not a `passivesOf` fold, it is one new `PassiveEffects` boolean (`preventBenchDamageNoRuleBox`), the target filter is `cards.ts hasRuleBox` NEGATED with no new predicate written, and `scope` really was REQUIRED rather than optional. 🛑 **THE ONE THING THE CELL GOT WRONG IS THE WORD *"DISJUNCT"* — there is no scan disjunct, because the field shares Rabsca's `holders` loop** (their SOURCE clauses are identical: absent) and departs only on the HALF and the TARGET, both enforced by one conjunct pair inside that loop. 🆕 **A `needs` CELL CAN NAME THE RIGHT FIELD, THE RIGHT PREDICATE AND THE RIGHT ARGUMENT AND STILL MIS-COUNT THE CONTROL FLOW — "one new disjunct" and "one new conjunct on an existing disjunct" are different prices, and only reading the loop tells you which.** Estimated ~5 edits, delivered `continuous.ts` +70 / `registry.ts` +90 (mostly comment) and **ZERO diff at `attack.ts` and `interpreter.ts`** — the first slice in this run to touch neither. ⚠️ **AND ITS DOCUMENTATION LANDED ONE SESSION LATE**: the building session died at the commit, so D257's session wrote D256's entry from `git show 6b78e11` and re-ran its corpus (299 killed / 7 known survivors / 0 gaps / 0 skipped(dirty)). See `packages/engine/src/flowerCurtain.test.ts`. ~~Shaymin `sv10-010`/`-185` "Flower Curtain":~~ *"Prevent all damage done to your Benched Pokémon that don't have a Rule Box by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)"* | **2** = 0 · 2 · 0 | a **TARGET-filtered** widening of the `benchShieldedFromDamage` SCAN, not a `passivesOf` fold — the protected body is not the holder, so D254's fold/scan line puts it on the scan side. One new `PassiveEffects`-adjacent registry field, one scan disjunct, and a `hasRuleBox` NEGATION on the TARGET (`cards.ts` has the predicate; Neutralization Zone `sv06.5-060` already reads it the same way, on a Stadium). ⚠️ NO source clause is printed, so — like Rabsca `sv05-024` — the holder is inside its own target set iff it has no Rule Box, which means the `scope` argument D254 added is REQUIRED and not optional | ~5 |
| ~~**15-B**~~ ✅ | ~~**The DAMAGE-THRESHOLD prevention**~~ — ✅ **BUILT AT D257, AND ROW 15 IS NOW CLOSED.** ✅ **THE CELL'S `needs` COLUMN WAS RIGHT ON THE HARD PART AND WRONG ON THE PRICE, WHICH IS THE OPPOSITE OF ITS USUAL FAILURE MODE ON THIS PAGE.** Right: it IS `AttackBlock.maxDamage` inverted and moved from the §11 installation onto `passivesOf`; the number to compare against IS `wouldDeal`, D240 HAD hoisted it at all four damage arms, and the read sites needed no new binding — *"pricing it needs the `wouldDeal` grep, not a new one"* is the most accurate sentence any `needs` cell on this page has contained. 🛑 Wrong: **~4 edits** is not what a row with no funnel costs. D256 one slice earlier had one (`benchShieldedFromDamage`) and paid ZERO read-site disjuncts; this row has none, so it pays **four**, plus a new predicate, plus a new fold key, plus three fixtures and a deck — for ONE printing. 🆕 **A CELL THAT PRICES THE *ARGUMENT* CANNOT PRICE THE *PLUMBING*: the two facts that decide a prevention row's cost are whether its rule already has a funnel and whether its gate's magnitude fits the fixture pool, and neither is visible in the printed sentence.** The second one bit too — every prevention fixture tops out at 50 damage and this gate does not open below 200, so three new attack sentences had to be written and `clauseApostrophe.test.ts` moved 94 → 97. 🛑 **AND THE ROW EXPIRED A CONTROL AND EXPOSED A MISNAMED ID**: `damageCapBlock.test.ts`'s `or more` refusal was justified partly by this card being unbuilt (re-homed, not deleted — the refusal is now MORE load-bearing, because deriving it there would author one printing on two channels), and **four comment sites called `sv07-044` "Munkidori" where the catalog says "Drednaw"**, every one with the ID right and the NAME wrong. See `packages/engine/src/imperviousShell.test.ts`. ~~Drednaw `sv07-044` "Impervious Shell":~~ *"Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more."* | **1** = 0 · 1 · 0 | a **threshold conjunct on a holder aura** — `AttackBlock.maxDamage` INVERTED (that one is "if that damage is 40 or LESS") and moved from the §11 installation to `passivesOf`. The number to compare against is `wouldDeal`, which D240 already hoisted and named at all four damage arms, so the read sites need no new binding. ⚠️ A SINGLETON, and the cheapest thing about it is that D240 did the hard half: pricing it needs the `wouldDeal` grep, not a new one | ~4 |

| ~~**15-C**~~ ✅ | ~~**The COIN-FLIP DEFENSIVE ABILITY**~~ — ✅ **BUILT AT D258.** ✅ **THE CELL'S `needs` COLUMN WAS RIGHT ABOUT WHERE THE PRICE WAS AND WRONG ABOUT WHAT PAID IT, WHICH IS A SHARPER FAILURE THAN 15-B's.** Right, and worth quoting: *"the price is not the gate, it is the flip"*; a defensive coin IS drawn once per DAMAGE INSTANCE at four read sites; a spread into three holders IS three flips; the gate IS a `passivesOf` fold of D257's shape with an optional `requiresEnergyType`; and `attackerHasSpecialEnergy` IS the wrong side. 🛑 Wrong on both of the two things it told the next session to price first. **`rng.ts` took a ZERO diff** — `flipCoin` was already the right primitive, and the "threading" turned out to live in `interpreter.ts`, where two `.map`s had to become FOLDS to carry an accumulator. **`MATCH_RECORD_VERSION` did not move**, because `ABILITY_COIN_FLIP` already existed with exactly the needed shape and `rngState` has been persisted since M1 — no key added, none retyped. 🆕 **A CELL THAT SAYS "PRICE X BEFORE PROMISING THIS ROW" IS DOING ITS JOB EVEN WHEN X TURNS OUT TO COST NOTHING — but the two nouns it named were both the wrong place to look, and the RIGHT question was "does this rule have a funnel", which is 15-B's own lesson one row up.** It did not: the seven earlier prevents are four inline disjuncts each, and an RNG-consuming gate cannot be, so the slice BUILT the funnel (`continuous.ts coinFlipShieldPrevents`) rather than adding a fifth copy. 🆕 **WHEN A NEW GATE HAS A SIDE EFFECT, "WIDEN A FUNNEL RATHER THAN ADD N GATES" STOPS BEING AN ECONOMY AND BECOMES A CORRECTNESS REQUIREMENT.** ✅ And the other half of 15-B's lesson INVERTED: this gate's magnitude requirement is a SIGN (`damage > 0`), not a size, so D257's `fix-crusher` was reused whole and `clauseApostrophe.test.ts` did NOT move. Estimated ~10 edits; delivered 11 files, +1448 lines, `BUILT.ability` 145 → 150. See `packages/engine/src/expertHider.test.ts`. ~~Fezandipiti `sv06-096`/`sv06.5-073`/`sv08.5-045` "Adrena-Pheromone" and Kecleon `sv08-150`/`-213` "Expert Hider"~~ | **5** = 0 · 5 · 0 | **RNG AT THE DEFENDING SITE — a flip the engine has never taken off the attacker's turn.** Two sentences, one mechanism; the second is the first with its antecedent dropped, so ONE gate with an optional `requiresEnergyType` conjunct covers both (D252's `attackerHasSpecialEnergy` is the wrong side; this one reads the HOLDER's attachments, which `passivesOf` already has). ⚠️ **THE PRICE IS NOT THE GATE, IT IS THE FLIP.** A defensive flip has to be drawn once per DAMAGE INSTANCE at four read sites, be recorded so a replay is deterministic, and emit an event a log row can render. **Price `rng.ts`'s threading and `MATCH_RECORD_VERSION` before promising this row** | ~10 |

| ~~**15-D**~~ ✅ | ~~**The TRAINER-BORNE EFFECT SHIELD**~~ — ✅ **BUILT AT D259.** ✅ **THE CELL WAS RIGHT ON EVERY STRUCTURAL CLAUSE, WHICH IS THE FIRST TIME IN THIS FAMILY.** Two shapes and not one — ONE `passivesOf` fold (`preventTrainerEffects`, the 4) AND ONE scan (`seatShieldedFromSupporterEffects`, the 1), the first slice in this run to pay both; `EffectContext.invokedBy` WAS the thread to pull; and the cheap outcome WAS the one that landed — `"attack"` → `"attack" | "item" | "supporter"` plus a widened `attackEffectRefused` (renamed `effectRefused`), with **all eight pre-existing call sites byte-unchanged** and `applyStatus` costing ZERO lines. ✅ **THE REACHABILITY CHECK THE CELL DEMANDED WAS RUN FIRST AND CAME BACK REACHABLE**, abundantly: `discardEnergy` off `opponentActive`/`opponentChosen`/`opponentEach` (Crushing Hammer, Giacomo), `gust` (Boss's Orders, Pokémon Catcher) and `applyStatus` (Dangerous Laser `sv06.5-058`) all aim a played Trainer at an opposing body. No refusal was needed and the row stood at its full 5. 🛑 **WHAT THE CELL DID NOT PREDICT IS THE PLACEMENT, AND IT IS THE SLICE'S REAL FINDING: THE TWO NEW READ SITES TAKE A *FILTER*, NOT A GUARD.** `discardEnergy`'s `opponentChosen` arm and `gust` CHOOSE from a set, so refusing them whole would let one shielded Fraxure protect a five-body Bench — a rule no printing states. The pre-existing wholesale §11 guard had to be narrowed to `invokedBy === "attack"` for the same reason. 🆕 **AND THE SLICE MAKES TWO PREVIOUSLY-DEAD ARMS LIVE (D253, D254), BECAUSE A TRAINER NAMES A BENCHED BODY WHERE AN ATTACK CANNOT** — a deadness recorded as structural turned out to be a fact about the op set, which is why both were written for totality and why that was right. ONE new event (`TRAINER_EFFECT_PREVENTED`) + one `log.ts` row; `MATCH_RECORD_VERSION` UNCHANGED at 13, driven as a REPLAY. Estimated ~8 edits; delivered 12 files, `BUILT.ability` 150 → 155 (re-derived at BOTH ends by the 376-unit join). See `packages/engine/src/trainerShield.test.ts`. ~~Fraxure `sv06.5-045`/`-077`, Cetitan ex `sv10-065`/`-210`, Rhyperior `sv07-076`~~ | **5** = 0 · 5 · 0 | **TWO SHAPES, NOT ONE**, and **the funnel is the whole question** — both confirmed | ~8 |
| ~~**15-E**~~ ✅ | ~~**The ATTACK-BORNE EFFECTS-ONLY shield**~~ — ✅ **BUILT AT D260, AND THE `%prevent%` ABILITY SEAM IS NOW EXHAUSTED OF BUILDABLE WORK.** ✅ **THE CELL WAS RIGHT ON EVERY STRUCTURAL CLAUSE — THE SECOND TIME IN THIS FAMILY, AND THE FIRST TIME THE *PRICE* WAS RIGHT TOO.** Right: it IS `preventDamageAndEffectsFromSpecialEnergy` with the DAMAGE half and the ATTACKER predicate BOTH dropped; it DOES read at `interpreter.ts effectRefused` and at NO damage site; the first one IS D256’s shape with **ZERO new read-site disjuncts**; the second IS a SCAN and not a fold; the target-group predicate IS `matchesFilter` territory; and *"(Existing effects are not removed.)"* IS a real clause. Estimated ~4 edits and the ENGINE diff really is three files (`continuous.ts`, `interpreter.ts`, `registry.ts`). 🆕 **THE ONE THING IT MISPRICED IS THE THING NO `needs` CELL ON THIS PAGE HAS EVER PRICED: THE *AUDITORS*.** Ten files moved, because four of them ENUMERATE `FIXTURE_POOL`’s owner-prefixed names and this row had to add two prefixed bodies. **A `needs` cell prices the MECHANISM; it cannot price what a slice adds to SHARED TEST STATE, and that is where the last three rows’ estimates have all leaked.** 🆕 **AND ITS "`pokemonSuffixOf` territory" GUESS WAS THE WRONG NEIGHBOUR AND THE RIGHT NEIGHBOURHOOD** — the arm is `matchesFilter`’s `ownerPokemon` (`{ owner, stage }`), which already existed, so the row added **ZERO new predicates** and carries the printed noun phrase as a `CardFilter` on the registry row. ⚠️ **THE LADDER TURNED UP A THIRD SENTENCE THE CELL NEVER NAMED**: `sv05-161` **Mist Energy**, a SPECIAL ENERGY printing the same effects-only sentence about *"the Pokémon this card is attached to"* — the `effect` column, UNBUILT, and now the seam’s ONLY buildable remainder. `BUILT.ability` 155 → 157 (re-derived at both ends). See `packages/engine/src/repellingVeil.test.ts`. ~~Skeledirge `sv08-031` "Unaware"; Team Rocket’s Articuno `sv10-051` "Repelling Veil"~~ | **2** = 0 · 2 · 0 | a **pure widening of an existing SOLE funnel** — confirmed, and the price was the AUDITORS rather than the mechanism | ~4 |

⚠️ **ROWS 15-A AND 15-B WERE MEASURED, NOT ESTIMATED, AND BOTH ARE NOW BUILT** — the ids
were the query's output, and `censusAtHead.test.ts` row 15's `abilityIds` went
`["sv07-044","sv10-010","sv10-185"]` → `["sv07-044"]` (D256) → `[]` (D257), going RED at
each step rather than quietly diverging from this page. 🛑 **ROW 15 IS CLOSED AND THE
`%prevent all damage%` ABILITY COLUMN HAS NOTHING BUILDABLE LEFT IN IT**: its residue is
3 printings on 1 sentence, all of them the permanently unbuildable TERA group (D252's
measured reason — `Tera` is in NO ingested column; `SELECT suffix, COUNT(*) … GROUP BY
suffix` returns only `null` and `ex`, and every `name`/`effect` hit is DEMAND, never
SUPPLY). ⚠️ **AND `abilityIds: []` IS A WEAKER GUARD THAN A POPULATED ONE** — it can no
longer go red by a build landing, only by the census moving. What still guards the row is
its `attackIds` half and the decomposition, whose D256 and D257 terms name the ids.

🆕 **THE WHOLE `%prevent%` ABILITY COLUMN IS NOW MEASURED END TO END, WHICH IS WHAT
ROWS 15-D AND 15-E ABOVE ARE.** Run BARE — `abilities_json`, `legal_standard = 1`,
GROUPED BY SENTENCE, remote D1 `luminous`, 2026-08-07 — the family is **15 sentences /
34 printings**, of which — ✅ **AS OF D260** — **31 on 14 are BUILT** (D251 5, D252 2,
D253 3, D254 1, D255 3+2, D256 2, D257 1, D258 3+2, D259 4+1, D260 1+1). 🛑 **THE
RESIDUE IS 3 PRINTINGS ON 1 SENTENCE AND IT IS THE TERA GROUP, WHICH IS PERMANENTLY
UNBUILDABLE — SO THIS COLUMN HAS NOTHING BUILDABLE LEFT IN IT AND ROWS 15-A THROUGH
15-E ARE ALL CLOSED.** The next ability slice in this family needs a NEW CENSUS and not
a new row here. ⚠️ **AND THE PLACE TO POINT IT IS ALREADY MEASURED**: D260's ladder,
run across all three text columns rather than only `abilities_json`, turned up
`sv05-161` **Mist Energy** — a SPECIAL ENERGY printing the effects-only sentence about
*"the Pokémon this card is attached to"*, in the `effect` column, UNBUILT, 1 legal
printing. 🆕 **A CENSUS SCOPED TO ONE COLUMN CANNOT SEE THE COLUMN NEXT TO IT — run the
ladder over all three, and the false positives of one row become the work order of the
next.**

✅ **AND IT PAID OUT IN ONE SLICE: D261 BUILT `sv05-161`, AND CLOSED THE COLUMN IT
LIVES IN WHILE IT WAS THERE.** The SPECIAL ENERGY column is now measured end to end —
`legal_standard = 1`, `category='Energy' AND energy_type='Special'`, `effect <> ''`,
GROUPED BY `effect`, remote D1 `luminous`, 2026-08-07 — at **7 sentences / 8
printings**, of which — ✅ **AS OF D262** — **5 on 5 are BUILT** (D239 Spiky ×2, D261 Mist ×1 +
Enriching ×1, D262 Neo Upper ×1). 🛑 **THE RESIDUE IS 3 PRINTINGS ON 3 SENTENCES AND
EVERY ONE IS NAMED WITH ITS BLOCKER**, in `packages/engine/src/mistEnergy.test.ts`'s header:

| id | card | blocker |
|---|---|---|
| ~~`sv05-162`~~ ✅ | ~~**Neo Upper Energy**~~ — **BUILT AT D262.** ✅ **THE CELL WAS RIGHT ON EVERY STRUCTURAL CLAUSE AND ON THE PRICE'S DIRECTION**: it IS `demoteWithOtherSpecial`'s shape with a different antecedent, `unitsOf` DID need the holder, and BOTH callers DID already hold the `pokemon`, so the reachability check the cell promised came back exactly as written. 🛑 **THE ONE THING IT MISPRICED IS THE STAGE READ.** "`registry.ts` + `continuous.ts unitsOf` and nothing else" lost: `matchesFilter`'s `stage` vocabulary (D245) is `"basic"` with an else-arm of `evolveFromOf(card) !== null` — **"any Evolution"** — so it cannot express Stage 2 and a reuse would promote on a **Stage 1** holder. `cards.ts` gained `isStage2Pokemon`, a third file. 🆕 **A VOCABULARY THAT NAMES YOUR AXIS IS NOT A VOCABULARY THAT CAN EXPRESS YOUR VALUE — READ ITS ARMS, NOT ITS FIELD NAME.** `BUILT.specialEnergy` 4 → 5 (re-derived at both ends). See `packages/engine/src/neoUpperEnergy.test.ts` |
| `sv06-166` | **Boomerang Energy** | re-attach from the discard pile AFTER attacking, and only if an attack's own effect discarded it. Nothing in the engine records WHY a card left a body |
| `sv06-167` | **Legacy Energy** | a PRIZE-COUNT modifier on the holder's KO, once per game. Needs a prize hook AND a per-game latch; §14 has neither |
| `sv10-182` | **Team Rocket's Energy** | an ATTACH RESTRICTION plus a continuous SELF-DISCARD when the restriction stops holding. Two clauses and no seam for either. 🆕 **D262 SHARPENED THE THIRD CLAUSE BY READING `costMet` RATHER THAN INHERITING THIS CELL**: *"provides 2 in any combination of {P} Energy and {D} Energy"* needs a **THIRD UNIT KIND** — a wildcard CONSTRAINED to a type set. `costMet` has exactly two (a concrete type; `ANY_ENERGY`, which fills any slot); `["Psychic","Darkness"]` refuses a {P}{P} cost the print allows and `[ANY_ENERGY, ANY_ENERGY]` pays a {R}{W} cost it refuses. **So this is THREE clauses, not two** |

⚠️ **`POPULATION.specialEnergyUnits` IS 11 AND NOT 8** — the census constant splits by
`cards.category`, so it picks up 3 BASIC energy printings that carry effect text.
⚠️ **DO NOT RE-RUN AN EXPLORATORY LADDER OVER THIS COLUMN.** It is eight printings
wide and it has been read whole; the next slice needs the column query and nothing
else. 🆕 **A CENSUS SCOPED TO A COLUMN SHOULD *CLOSE* THAT COLUMN — build the cheap
rows and name the rest with a BLOCKER EACH. That is worth more than the rows.** 🆕 **WHEN YOU FINISH A ROW,
RUN THE FAMILY'S WIDEST PHRASE *ONCE* AND WRITE THE WHOLE TABLE DOWN — it is cheaper
than four more slices of guessing, and it is what turned this page from "one measured
row" into a complete inventory with the residue named and classified.**

🆕 **ROW 15-C ABOVE IS A NEW MEASUREMENT, NOT A LEFTOVER, AND FINDING IT IS THIS PAGE'S
STANDING LESSON PAYING OUT ON ITS OWN CENSUS.** D255's ladder swept `%prevent all
damage%`; these five printings say *"prevent that damage"* and were invisible to every
rung of it. 🆕 **A CENSUS IS BOUNDED BY ITS PHRASE, AND THE PHRASE IS A CHOICE — when a
row closes, widen the VERB before declaring the family finished.** The widening that
found it was `%prevent that damage%` ∪ `%flip a coin%prevent%`, run on all three text
columns while D256's corpus was in flight (which cost nothing: an MCP query does not
touch the working tree).
