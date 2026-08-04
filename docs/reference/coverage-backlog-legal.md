# Simulator coverage — the STANDARD-LEGAL census (2026-08-04)

> ## ⚠️ READ THIS BLOCK BEFORE QUOTING ANY NUMBER IN THIS FILE
>
> | | |
> |---|---|
> | **Population** | `legal_standard = 1` — **2,021 rows**, spread over **18 sets** (of the 20 the catalog holds) |
> | **What that predicate means** | Regulation mark **H** (1,248) + **I** (736) + **unmarked Basic Energy** (36) + **one anomaly** (below) = 2,021 |
> | **Measured against** | the **REMOTE Cloudflare D1** `luminous`, `database_id 735f0fb5-cdc3-494d-8b97-74a8ade0124a`, queried live over MCP on **2026-08-04** |
> | **Engine seam** | repo HEAD **`2e5832e`**, engine **0.122.0**, working tree CLEAN for `packages/engine/**` at measurement time |
> | **Exact SQL predicate** | `WHERE legal_standard = 1` on `cards`, then `json_each(attacks_json)` / `json_each(abilities_json)` / `effect`, always with `COALESCE(json_extract(value,'$.effect'),'') <> ''` |
>
> **THE REMOTE D1 IS A SUPERSET OF THE LOCAL ONE, AND THE LOCAL ONE IS ABSENT.**
> The remote holds **3,786 rows / 20 sets**. The `.wrangler` D1 that
> `docs/reference/coverage-backlog.md` was measured against holds **978 rows / 6
> sets** — and it is **not in the repository at all** (`.wrangler/` is
> gitignored; `find / -name '*.sqlite'` returns zero rows in this clone). Every
> figure in this file therefore comes from the remote, and **cannot be
> re-derived from a fresh clone without MCP D1 access or network egress to
> tcgdex** (egress to `api.tcgdex.net` and to `luminous-api.jofrescari.workers.dev`
> is 403-at-CONNECT in this environment — both were tried).
>
> **Every number below is attributable to a query that was run.** Where a figure
> could not be measured it is marked **UNMEASURED** and says why.

## Why this file exists

`docs/reference/coverage-backlog.md`'s 2026-08-04 section ranks **458 unbuilt
printings / 281 sentences** over a **978-row / 6-set** catalog
(`sv01`,`sv02`,`sv03`,`sv06.5`,`sve`,`swsh10.5`). That catalog is regulation
mark **G/F/D** — **rotated out of Standard**. Only **127 of its 978 rows** are
Standard-legal, and **124 of those 127 are Basic Energy with no rules text**.
The standing instruction is *only evaluate and implement legal cards*, so that
ranking is a roadmap over a population that cannot be played. This file is its
replacement over `legal_standard = 1`. The old file is kept — annotated, not
rewritten (D178's rule) — and §"What the ROTATED census got wrong" below says
exactly which of its rows survive.

### The one legality anomaly, measured
`legal_standard` tracks the regulation mark exactly **with a single exception**:
**`sv04-266` Reversal Energy** carries mark **G** and `legal_standard = 1`. It is
the only row in the catalog where the two disagree (`SELECT … GROUP BY set_id,
regulation_mark, legal_standard` → 1 row). It is counted as legal here, and it is
**unbuilt** — it is the entire `sv04` row of the per-set table. Two sets carry
**zero** legal rows: `sv04.5` (0/245) and `swsh10.5` (0/88).

## Method — the built set was DERIVED, not read off a doc

Same seam D179 used, reproduced by running the engine, not by reading prose:

* **Every column that can hold printed rules text was enumerated first** from
  `PRAGMA table_info(cards)`: `attacks_json` (per-attack `effect`),
  `abilities_json` (per-ability `effect`), `effect` (Trainer + Special Energy).
  **Verified on the legal pool:** 0 of 1,710 Pokémon rows carry a top-level
  `effect`; 0 of 2,021 rows carry more than one Ability (so an ability's
  coverage is exactly its card's); 36 of the 47 legal Energy rows are Basic
  Energy with no `effect`. The three columns are the whole surface.
* **A "printing" is a TEXT UNIT, not a card.** 2,591 attack slots exist among
  legal rows; **1,732** of them carry effect text. Plus 376 ability, 264
  Trainer, 11 Special Energy → **2,383 legal text units**.
* **BUILT for attacks** = `programFor(id)?.attack?.[index]` **OR** any of the six
  text derivers returning non-null for the **exact printed string**:
  `deriveAttackEffect`, `deriveAttackDamageBonus`, `deriveAttackDamagePenalty`,
  `deriveAttackDamageMultiplier`, `deriveAttackCoinFlip`,
  `deriveAttackRequirement` (all six verified exported from
  `packages/engine/src/index.ts`). The 640 **distinct** legal attack strings were
  pulled from D1 and fed to the real functions by a bun script.
  ⚠️ **Zero registry-authored attacks are Standard-legal** — the whole
  `CardProgram.attack` seam is 7 entries on `sv02-061`/`-236`/`-261`/`-274`
  (Chien-Pao ex) and `swsh10.5-031`/`-079`/`-086` (Mewtwo VSTAR), and every one
  of those ids is rotated. So for this population, *built attack = derived attack*.
* **BUILT for abilities** = a registry `abilities`/`passive`/`triggered`/
  `stadium`/`energy` entry; **for Trainers / Special Energy** = a registry
  `trainer`/`stadium`/`rareCandy`/`passive`/`triggered`/`energy` entry. **There
  is no deriver for either** — a registry row keyed by card id, or unsimulated.
  The 178 registry ids were extracted from `registry.ts` and classified by
  calling `programFor(id)` on each, then joined against D1 by id.
* **Round-trip integrity check.** The 640 distinct attack strings were
  transcribed out of the D1 result into a file; the file re-measures at
  **640 lines / 60,467 characters / 640 unique**, byte-for-byte the
  `COUNT(*) / SUM(LENGTH(t))` D1 reports for the same query. Nothing was lost or
  mangled in transit.

## Result

| | Units | Built | **UNBUILT** |
|---|---:|---:|---:|
| attack effect text | 1,732 | 806 | **926** |
| ability text | 376 | 3 | **373** |
| Trainer effect text | 264 | 3 | **261** |
| Special Energy effect text | 11 | 0 | **11** |
| **total** | **2,383** | **812** | **1,571** |

**1,571 unbuilt printings / 784 distinct unbuilt sentences / 1,363 of 2,021
cards** have at least one unsimulated sentence. (1,985 of the 2,021 rows carry a
card body at all; the other 36 are Basic Energy.)

**The two numbers move separately** — printings and distinct sentences — and both
are derived here:

| | distinct sentences | built | **unbuilt** |
|---|---:|---:|---:|
| attack | 640 | 176 | **464** |
| ability | 167 | 1 | **166** |
| Trainer + Special Energy | 158 | 2 | **157** |
| **union across all three columns** | — | — | **784** (not 787: 3 strings are printed in two different columns) |

**The asymmetry is the story.** 806 of 812 built units are attacks, and every one
of them is built by a **text deriver**, which is why they survived rotation: an
arm is a parser and its sentences transfer across sets. Abilities and Trainers
are keyed by **card id**, and the registry's 178 ids are almost entirely `sv01`–
`sv03`/`swsh10.5`. The **complete** list of non-attack legal built printings is:

* abilities — **`sv06.5-037` / `-083` / `-091` Munkidori ex** (3 printings, 1 sentence)
* Trainers — **`sv06.5-059` / `-088` Janine's Secret Art** and **`sv06.5-060` Neutralization Zone** (3 printings, 2 sentences)

That is **6 printings out of 651**. The engine can simulate **0.9 %** of the
Standard-legal Trainer/Ability surface.

## Per-set breakdown of the unbuilt

Only sets that carry legal rows with rules text appear. `mfb`, `sv01`, `sv02`,
`sv03`, `sv03.5`, `sve` contribute legal rows, but every one of them is a Basic
Energy with no rules text — 0 unbuilt printings, and they are omitted.

| Set | Legal rows | Unbuilt printings | Cards with ≥1 unbuilt |
|---|---:|---:|---:|
| `sv10` | 242 | **213** | 180 |
| `sv08` | 251 | **212** | 189 |
| `sv06` | 224 | **203** | 174 |
| `sv05` | 215 | **161** | 143 |
| `sv08.5` | 151 | **143** | 122 |
| `sv10.5w` | 173 | **123** | 109 |
| `sv09` | 189 | **120** | 102 |
| `sv10.5b` | 171 | **116** | 105 |
| `sv07` | 167 | **111** | 94 |
| `svp` | 105 | **96** | 78 |
| `sv06.5` | 98 | **72** | 66 |
| `sv04` | 1 | **1** | 1 (`sv04-266` Reversal Energy) |
| **total** | **2,021** | **1,571** | **1,363** |

`sv06.5` is the **only** set the rotated census ever looked at that still carries
legal cards, and it is 11th of 12 by unbuilt volume.

---

# The families, ranked CHEAPEST-PER-PRINTING first

A **family is one printed SENTENCE SHAPE, not one card.** "Sentences" is the
distinct-string count inside the family; "printings" is the text-unit count.
Attack rows carry `id#attackIndex`; ability and Trainer rows carry bare ids.

## Tier 0 — a REGISTRY MAP ENTRY. No new code at all.

A printing whose **byte-identical** twin is already authored on a registered id.
Derived by a genuine text-equality sweep of unbuilt-against-built across all
three columns (`JOIN … ON built.t = unbuilt.t`), not asserted.

| Family — verbatim | Printings | Sentences | Already authored on | The legal rows |
|---|---:|---:|---|---|
| *"This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."* | **8** | 1 | `sv02-150`/`-245` Copperajah ex (`damageReductionAfterWR: 30`) | `sv06-002` Tangrowth · `sv07-125` Dubwool · `sv08-054`/`-201` Cetitan · `sv10-108` Mudsdale · `sv10.5w-077`/`-162`/`-170` Bouffalant ex |
| *"If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon."* | **3** | 1 | `sv01-005`/`-006` Cacnea/Cacturne (`damageAttacker: 30`) | `sv05-139` Iron Jugulis · `sv08-049`/`-200` Bruxish |
| *"This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."* | **2** | 1 | `sv01-121` Stonjourner | `sv05-010` Turtwig · `sv08.5-088` Furfrou |
| *"…(even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned."* | **1** | 1 | `sv03-044` Armarouge (`onDamagedByAttack` → `applyStatus`) | `sv06-123` Heatran |
| *"All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance)."* | **1** | 1 | `sv02-113` Hariyama | `sv08.5-067` Bronzong |
| **Trainers** — Nemona's *"Draw 3 cards."* | **3** | 1 | `sv01-180` Nemona (`drawCards 3`) | `sv08.5-109`/`-137` **Friends in Paldea** · `sv10.5w-081` **Cheren** (different card NAMES, byte-identical text) |
| **Trainers** — Janine's Secret Art | **2** | 1 | `sv06.5-059`/`-088` | `sv08.5-112`/`-173` |
| **Trainers** — Energy Retrieval | **1** | 1 | `sv01-171` | `sv10.5w-082` |
| **Trainers** — Pokégear 3.0 | **1** | 1 | `sv01-186` | `sv10.5b-084` |
| **TOTAL** | **22** | **9** | — | — |

**This is the whole of Tier 0** — the sweep returns nothing else across the three
columns. **Zero attack aliases exist** (the 7 registry-authored attacks are all
rotated and none of their strings recurs in the legal pool), so Tier 0 is
entirely passives, one trigger, and four Trainers.

⚠️ **D180's four Tier-0 rows serve ZERO of these.** `sv02-245`, `swsh10.5-069`,
`swsh10.5-078`, `swsh10.5-084` are all rotated — correct rows, no legal payoff.
The four rows landed here are a **different 22 printings**, and they are the
cheapest thing in this file: **22 printings for 9 map entries and no code.**

## Tier 1 — ONE DERIVER ARM on an op that already exists (attacks), or a REGISTRY ROW whose ops all exist (abilities/Trainers)

Attack text is derived, so an attack row here is a regex + a `return` in
`deriveAttackEffect`. Ability/Trainer rows have **no deriver** — they are hand
registry rows — but they need **no new engine code**, which is what puts them here.

| Family | Printings | Sentences | Existing op | The rows |
|---|---:|---:|---|---|
| **Deck-search → Bench, in attack text** — *"Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck."* (7) · *"…up to 2 Basic Pokémon…"* (7) · *"…up to 3…"* (2) | **16** | 3 | `searchDeck {basicPokemon, dest:"bench", max}` + `shuffleDeck` (Nest Ball's program) | `svp-200#0`, `svp-202#0`, `sv05-130#0`, `sv06-036#0`, `sv07-066#0`, `sv07-113#0`, `sv08-005#0` · `sv07-088#0`, `sv08-104#0`, `sv09-065#0`, `sv09-077#0`, `sv09-165#0`, `sv10.5b-029#0`, `sv10.5b-112#0` · `sv05-132#0`, `sv05-181#0` |
| **Deck-search → hand, in attack text, WITH NO NEW FILTER** — *"Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."* (3) · *"…a Supporter card…"* (3) · *"…up to 2 Basic Energy cards…"* (5) · *"…up to 3 Basic Energy cards…"* (1) · *"…a Basic Energy card…"* (1) · *"…a Pokémon Tool card…"* (1) · *"…up to 3 Pokémon…"* (1) | **15** | 7 | `searchDeck {dest:"hand"}` with `anyPokemon`/`supporter`/`basicEnergy`/`toolCard` — all four filter kinds already exist | `sv06-126#0`, `sv06-185#0`, `sv08-047#0` · `sv06.5-027#0`, `sv10-127#0`, `sv10-200#0` · `svp-123#0`, `sv06-024#0`, `sv08-097#0`, `sv10.5b-068#0`, `sv10.5b-145#0` · + 4 singletons |
| **Self-switch, in attack text** — *"Switch this Pokémon with 1 of your Benched Pokémon."* (7) · *"You may switch this Pokémon…"* (3) · three riders (1+1+1) | **13** | 5 | `switchActive` (the Switch item's op) | `svp-187#0`, `sv05-040#0`, `sv07-037#0`, `sv08-006#0`, `sv08-041#0`, `sv08-198#0`, `sv09-120#0` · `sv08-106#0`, `sv08-222#0`, `sv08.5-091#0` · `sv08-068#0` (+attach rider) · `sv06-062#0` (+ opponent switch-out) · `sv07-053#0` (typed `{L}` Bench) |
| **Typed / Special opponent-Energy discard, in attack text** — *"Discard a Special Energy from your opponent's Active Pokémon."* (4) · *"Discard a {R} Energy from your opponent's Active Pokémon."* (2) · *"Discard all Special Energy from all of your opponent's Pokémon."* (2) | **8** | 3 | `discardEnergy` `opponentActive`/`opponentEach` + the `specialEnergy` and `providesEnergy` filters — **all three arms exist and are tested** (Crushing Hammer, Giacomo, Kilowattrel) | `sv05-030#1`, `sv06-132#0`, `sv10.5b-066#0`, `sv10.5b-144#0` · `sv10.5w-025#0`, `sv10.5w-109#0` · `sv08-035#0`, `sv08-197#0` |
| **ABILITY, registry-only** — *"Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card."* | **8** | 1 | `attachEnergyFrom` (hand→self) + §9.2 `recordAs`/`recordGate` + `drawCards` | **Teal Mask Ogerpon ex** `svp-166`, `sv06-025`, `sv06-190`, `sv06-211`, `sv06-221`, `sv08.5-012`, `sv08.5-145`, `sv08.5-177` |
| **ABILITY, registry-only** — *"…(even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned."* | **4** | 1 | D99's `onDamagedByAttack` trigger + `applyStatus` — the Armarouge program with a different status token | `sv05-008` Roselia, `sv05-009` Roserade, `sv10.5b-056`/`-134` Scolipede |
| **ABILITY, registry-only** — *"You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards."* | **4** | 1 | `payFromHand {to:"discard"}` + `drawCards 2` — the Revavroom/Tinkaton shape exactly | **N's Zoroark ex** `sv09-098`, `sv09-175`, `sv09-185`, `sv09-189` |
| **ABILITY, registry-only** — *"All of your Pokémon that have {M} Energy attached have no Retreat Cost."* | **3** | 1 | `PassiveEffects.noRetreatCostAura {requiresEnergyType}` — **Clefable ex's Lunar Zone with `M` for `P`. A pure data row.** | **Archaludon** `sv07-107`, `sv07-155`, `sv08.5-070` |
| **TRAINER, registry-only** — *"If you go first, you may use this card during your first turn.\n\nDiscard your hand and draw 5 cards."* | **4** | 1 | `discardHand` + `drawCards 5` (Professor's Research minus two cards) | **Carmine** `sv06-145`, `sv06-204`, `sv06-217`, `sv08.5-103`. ⚠️ the first-turn clause is **inert** — the engine has no going-first Supporter lock for it to lift; author knowing the sentence is unenforced |
| **TRAINER, registry-only** — *"Move up to 2 Energy from your Benched Pokémon to your Active Pokémon."* | **3** | 1 | `moveEnergy {route:"benchToActive", max:2, anyEnergy}` — Armarouge's route, on the Trainer path | **N's Plan** `sv10.5b-083`, `sv10.5b-163`, `sv10.5b-170` |
| **ABILITY, registry-only** — *"You must discard a Basic {L} Energy from this Pokémon in order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in your hand."* | **3** | 1 | `discardEnergy {yourActive, providesEnergy L}` + `drawUntilHandSize 6` | **Iono's Kilowattrel** `svp-182`, `sv09-055`, `sv09-163` |

**Tier-1 total: 81 printings for 18 deriver arms and 7 registry programs.**
52 of those printings are attack text (pure regex); the other 29 are **7 programs
aliased across 29 card ids**, every op of which is already built and tested.

## Tier 2 — one new FIELD / union member on an existing mechanism

| Family | Printings | Sentences | The price | The rows |
|---|---:|---:|---|---|
| **Damage-scaling COUNT SOURCES** — `DamageCountSource` has **6** members today (`damageCountersOnSelf`, `opponentPrizesTaken`, `opponentActiveRetreatCost`, `boardCondition`, `damageCountersOnOpponentActive`, `damageCountersOnYourBench`). The legal pool wants **five more**, each 1 member + 1–2 regex arms in `scaledAttackDamage` | **87** | 42 | 5 union members | see the five sub-rows |
| ↳ **Energy attached to THIS Pokémon** (typed and untyped) | 26 | 13 | `energyOnSelf {energyType?}` — `providesEnergy`/`unitsProvidedBy` already answers "an Energy that provides {X}" | `sv06-096#0`, `sv06.5-073#0`, `sv08.5-045#0`, `sv10.5w-022#0`, `sv10.5w-106#0` (*"…does 30 damage for each Energy attached to this Pokémon."*) · `svp-131#1`, `sv06.5-012#1`, `sv06.5-080#1`, `sv09-041#0`, `sv09-162#0` (*"…does 50 **more** damage for each {W} Energy…"*) · 8 more shapes |
| ↳ **Your own board COUNT** (Benched Pokémon, Pokémon in play, Stage-1s, Evolutions, Tools attached, Pokémon with damage counters) | 26 | 12 | `yourBoardCount {what}` | `sv10-009#1`, `sv10-043#1`, `sv10-061#1`, `sv10-077#1`, `sv10-197#1` (*"…for each Pokémon Tool attached to all of your Pokémon."*) · `svp-165#0`, `sv07-128#0`, `sv07-170#0`, `sv07-173#0`, `sv08.5-092#0`, `sv08.5-169#0`, `sv08.5-180#0` (*"If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon."* — a **compound**: a first-turn gate AND a scale) |
| ↳ **Energy attached to the OPPONENT** (Active, and whole board) | 17 | 9 | `energyOnOpponent {zone, energyType?}` | `sv05-024#0`, `sv06-081#0`, `sv10.5b-041#1`, `sv10.5b-121#1` (*"…30 more damage for each Energy attached to your opponent's Active Pokémon."*) + 8 more |
| ↳ **Cards in a DISCARD PILE** matching a filter | 12 | 6 | 1 member + per-filter work (by card NAME, by owner-prefix, by Energy class) | e.g. *"…60 more damage for each Ethan's Adventure card in your discard pile."*, *"…20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."* |
| ↳ **Both-Actives / opponent's Bench COUNT** | 6 | 2 | 1 member | `svp-195#0`, `sv08-031#0`, `sv09-056#0`, `sv09-173#0`, `sv09-184#0` (*"…20 more damage for each Benched Pokémon (both yours and your opponent's)."*) |
| **Main-hit damage-modifier SUPPRESSION** — D95 settled the semantics once for the snipe (`damageChosen.ignoreWR` nulls W/R *and* the target's `damageReductionAfterWR`). This is that decision at the **main-hit** read site | **34** (+6 ability) | 4 (+1) | 2–3 boolean flags | *"This attack's damage isn't affected by any effects on your opponent's Active Pokémon."* (**15**) `svp-091#1`, `sv05-119#1`, `sv07-045#0`, `sv08-103#0`, `sv08-142#0`, `sv08-226#0`, `sv09-121#1`, `sv09-178#1`, `sv10-012#0`, `sv10-186#0`, `sv10.5w-030#1`, `sv10.5w-071#0`, `sv10.5w-151#0`, `sv10.5w-159#1`, `sv10.5w-167#1` — *"…isn't affected by Resistance."* (**9**) `sv08-110#1`, `sv08-114#0`, `sv09-082#0`, `sv10-102#0`, `sv10.5w-053#1`, `sv10.5w-134#1`, `sv10.5b-046#1`, `sv10.5b-160#1`, `sv10.5b-168#1` — *"…isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."* (**8**) `svp-133#0`, `sv06-112#0`, `sv06-199#0`, `sv06-215#0`, `sv07-003#0`, `sv07-144#0`, `sv08.5-058#0`, `sv08.5-160#0` — *"…isn't affected by Weakness or Resistance."* (**2**) `sv07-080#1`, `sv07-161#1`. **Plus the ABILITY twin** *"Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon."* (6, Walking Wake ex `svp-127`, `sv05-050`, `sv05-189`, `sv05-205`, `sv05-215`, `sv08.5-178`) — the same flag, read from a passive |
| **The "YOU MAY" optional wrapper** — a printed *"You may …"* whose body is an ordinary op. The vocabulary has **no declinable-program wrapper**; every one of these is blocked on it | **78** | 32 | 1 wrapper (a `mayGate`/`optional: true` on the program head) — ⚠️ **A GATE ONLY**: each row still needs its body op, so it unlocks nothing alone. It is a prerequisite **32 sentences share** | biggest: *"You may draw cards until you have 6 cards in your hand."* (**10**, `svp-204#0`, `sv06-134#0`, `sv06-201#0`, `sv07-036#0`, `sv10-104#0`, `sv10-215#0`, `sv10-232#0`, `sv10-241#0`, `sv10.5b-074#0`, `sv10.5b-151#0` — the body op `drawUntilHandSize` **already exists**, and its non-optional twin *"Draw cards until you have 7…"* is BUILT) · *"You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way."* (6) · *"You may discard up to 2 Energy from your Benched Pokémon…"* (6) · *"You may switch this Pokémon…"* (3) · *"You may discard a Stadium in play."* (2) |
| **`moveEnergy` self → Bench** — the mirror of the built `benchToActive` route | **16** | 5 | 1 route value + `count:"all"` + an exact-N | *"Move an Energy from this Pokémon to 1 of your Benched Pokémon."* (**8**) `sv05-118#0`, `sv06-077#0`, `sv06-196#0`, `sv08.5-032#0`, `sv08.5-087#0`, `sv09-031#0`, `sv09-171#0`, `sv09-182#0` · *"Move 3 Energy…"* (3) `sv10-003#0`, `sv10-206#0`, `sv10-228#0` · *"Move a Basic Energy…"* (2) · *"Move all Energy… to 1 of your Benched"* (2) · *"…to your Benched Pokémon in any way you like"* (1) |
| **Hand disruption — the RANDOM discard** — *"Discard a random card from your opponent's hand."* | **8** | 1 | 1 op arm on the opponent-hand channel `bottomFromOpponentHand` already opened (`HAND_REVEALED`, the `decider`/`answerer` seam) — but the pick is by RNG, not by a player | `svp-175#0`, `sv07-083#0`, `sv08.5-034#0`, `sv08.5-064#1`, `sv08.5-155#0`, `sv10-085#0`, `sv10.5w-056#0`, `sv10.5w-137#0` |
| **Opponent reveals hand (reveal-only, and reveal→act)** | **17** | 7 | the reveal EVENT + redaction path exist inside `bottomFromOpponentHand`; a standalone `revealOpponentHand` op does not | bare *"Your opponent reveals their hand."* (**7**) `svp-185#0`, `sv05-126#0`, `sv06-066#0`, `sv06.5-016#0`, `sv08-084#0`, `sv10.5b-071#0`, `sv10.5b-148#0` · + 6 reveal-then-act riders |
| **Deck-search that needs ONE new filter kind** — `itemCard` (4), `anyCard` (8 attack + 3 Trainer), typed Pokémon `{L}`/`{D}` (3), `stadiumCard` (1) | **19** | 8 | 4 `CardFilter` kinds | **`itemCard`**: `sv05-047#0`, `sv10-072#0`, `sv10.5w-072#0`, `sv10.5w-152#0` · **`anyCard`**: `sv06-106#0`, `sv06-198#0`, `sv06-214#0` (*"You may search your deck for a card…"*), `sv10.5b-003#0`, `sv10.5b-156#0`, `sv10.5b-164#0` (*"…up to 3 cards…"*), `sv05-127#0`, `sv07-011#0`, + **Cassiopeia** `sv06.5-056`/`-086`/`-094` (*"…only when it is the last card in your hand."* + *"…up to 2 cards…"*) · **typed Pokémon**: `sv08-065#0` (`{L}`), `sv10.5w-055#0`, `sv10.5w-136#0` (`{D}`) · **`stadiumCard`**: `sv09-086#0` |
| **Once-per-turn BY NAME** — *"You can't use more than 1 X Ability each turn."* `cardplay.ts` keys `abilitiesUsed` on `` `${uid}:${name}` `` — per COPY; the print is per NAME | **8** | 3 | drop `uid` from the key behind a flag | Pecharunt ex `sv06.5-039`/`-085`/`-093`/`-095`, `sv08.5-163` · Fezandipiti ex `sv06.5-038`/`-084`/`-092`. ⚠️ **A GATE ONLY** — both cards also need their body op |
| **Survive-at-10-HP** — *"If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10."* | **8** | 2 | 1 `PassiveEffects` field read at the §8.1 KO sweep (the first passive that intercepts a KO) | Pikachu ex `sv08-057`/`-219`/`-238`/`-247`, `sv08.5-179`; Crustle `sv10.5b-052`/`-130`; + the Tool twin `sv06-164` **Survival Brace** (*"…Then, discard this card."*) |

## Tier 3 — a genuinely NEW OP / new mechanism

| Family | Printings | Sentences | The rows and the new primitive |
|---|---:|---:|---|
| **The opponent-chooses SWITCH-OUT** — *"Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"* | **14** | 4 | bare (**10**): `sv05-106#0`, `sv07-121#0`, `sv09-009#0`, `sv10-002#0`, `sv10-105#0`, `sv10-183#0`, `sv10.5w-007#0`, `sv10.5w-075#0`, `sv10.5w-092#0`, `sv10.5w-155#0` · *"You may…"* (2) `svp-178#0`, `sv10-160#0` · +damage rider (1) `sv07-096#0` · compound with a self-switch (1) `sv06-062#0`. The **cross-seat decision machinery already exists** (`opponentMayDraw`'s `decider`/`answerer`, engine 0.32.0); what is missing is the op and the HUD offering a decision to the seat whose turn it is not |
| **Turn-scoped ATTACK-DAMAGE aura from a Supporter** — *"During this turn, attacks used by your Pokémon do 40 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance)."* | **9** | 1 | **Black Belt's Training** `svp-219`, `svp-220`, `sv08.5-096`/`-097`/`-098`/`-099`, `sv09-143`/`-144`/`-145`. The **largest single Trainer family in the census.** `damageBonusBeforeWRIfTarget` (Choice Belt, D92) is the right shape but it is a PASSIVE on a Tool; this is a Supporter that installs a bonus **for the rest of the turn** — a new per-turn effect channel |
| **`discardStadium`** — *"Discard a Stadium in play."* / *"You may discard a Stadium in play."* / with a *"If you can't, this attack does nothing."* gate / with a +140 rider | **9** | 4 | `sv06-099#0`, `sv06-119#1`, `sv06-181#0`, `sv10-009#0` · `sv07-124#0`, `sv07-125#0` · `sv10-065#0`, `sv10-210#0` · `sv08-141#1`. Discarding the Stadium must also STOP its continuous effects (`continuous.ts` reads the zone) and needs its own public event |
| **Modal Supporters — *"Choose 1:"*** | **5** | 1 | **Kieran** `sv06-154`, `sv06-206`, `sv06-218`, `sv08.5-113`, `sv08.5-174`. A program that is a **choice between two programs**, decided at play time. Nothing in `EffectOp` branches on a player's free choice (`conditionGate` branches on board state, `coinFlipGate` on RNG) |
| **Attack twice / re-attack** — *"If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again…"* | **7** | 1 | `sv06-018`, `sv06-044`, `sv06-089`, `sv06-170`, `sv08.5-010`, `sv08.5-020`, `sv08.5-021`. A second attack inside one turn — flow work, not op work |
| **The card-type PLAY LOCK** — *"During your opponent's next turn, they can't play any X cards from their hand."* (+ the Ability aura twin) | **10** | 6 | 7 attack printings + `sv10.5w-045`/`-160`/`-168` **Jellicent ex** (*"…your opponent can't play any Item cards or Pokémon Tool cards from their hand."*). Needs a per-seat next-turn restriction channel, a gate in `cardplay.ts` per card class, **and** the HUD greying |
| **Multi-status / both-Actives** — *"is now X and Y"*, *"is now X, Y, and Z"* | **12** | 7 | `applyStatus` takes one status; the sentence takes two or three |
| **Ability lock, new shapes** — *"…your opponent's Active Pokémon has no Abilities, except for X"*, *"Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon"* | **11** | ~6 | D100's `disableAbilities` has 7 narrowing predicates; these want `exemptClass: "Future"` and a Rule-Box scope. **Closest thing in the file to a Tier-2** — listed here because the D100 KNOWN LIMITATION (auras collected ungated, so a lock never turns another lock off) bites harder with 11 live printings |
| **Self-KO as a cost** — *"Once during your turn, you may put N damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out."* | **9** | 3 | Dusclops `sv06.5-019`/`-069`, `sv08.5-036` · Dusknoir `sv06.5-020`/`-070`, `sv08.5-037` · Magneton `svp-153`/`-159`, `sv08-059`. `damageChosen` places the counters today; **an effect that KOs its own source** does not exist |
| **Fossil Trainers played as Pokémon** — *"Play this card as if it were a 60-HP Basic {C} Pokémon…"* | **4** | 1 | `sv07-129`, `sv07-130`, `sv10.5w-079`, `sv10.5b-080`. A Trainer occupying a Bench slot — a card-identity change the whole engine assumes cannot happen |
| **The flip-to-attack lock** — *"…if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."* | **2** | 1 | A new DETECTION SITE (a gate inside the attack action) plus a park owned by the defender. **Shrank from 4 to 2 at rotation** |

### The NEW predicate dimension the rotated census never had to price

**67 legal text units name an owner-prefixed Pokémon subgroup** — a filter class
that does not exist in `CardFilter` at all:

| Prefix | Text units | Prefix | Text units |
|---|---:|---|---:|
| `Team Rocket's` | 31 | `Cynthia's` | 5 |
| `Ethan's` | 11 | `N's` | 5 |
| `Iono's` | 6 | `Misty's` | 4 |
| `Steven's` | 3 | `Lillie's` | 2 |

Plus **16** more naming a specific Trainer CARD (*"for each Kofu card in your
discard pile"*, *"any number of Fennel cards"*, *"each Ethan's Adventure card"*).
And **23** name **Tera Pokémon**, **18** **Future**, **11** **Ancient**, **12**
**Rule Box**. `sv01`–`sv03` had none of these; they are pure new-set surface, and
every one of them is a predicate on a card, so they multiply the cost of every
family they appear in rather than forming a family of their own.

---

# The five to build next

Ranked by **unlock per edit**, not by raw size.

| # | Family | Price | Why |
|---|---|---|---|
| 1 | **The Tier-0 alias map** (22 printings) | **9 registry map entries. Zero code. Zero tests beyond a byte-identity assertion.** | The best ratio in the file by an order of magnitude — 2.4 printings per line. It also converts the census's worst structural fact (registry rows are keyed by card id and do not survive rotation) into its cheapest win. ⚠️ Re-run the equality sweep before landing: this is exactly the claim D180 had to assert from a doc |
| 2 | **Main-hit damage-modifier suppression** (34 attack + 6 ability = **40**) | **2–3 boolean flags at the §8.5 read site** + 4 regexes + 1 passive field | **40 printings for a decision that was already made once** — D95 settled what "isn't affected by …" means for the snipe (`ignoreWR` nulls W/R *and* the target's reduction). This is that flag at the main hit. It also has the highest printings-per-sentence ratio of any unbuilt family (10:1) |
| 3 | **The five damage-scaling COUNT SOURCES** (**87**) | 5 `DamageCountSource` union members + ~10 regex arms | The single largest unlock in the census, onto a fold (`scaledAttackDamage`) that has absorbed six members already with no new argument. `energyOnSelf` needs no new predicate work at all — `providesEnergy`/`unitsProvidedBy` already answers "an Energy that provides {X}". ⚠️ **Every member needs BOTH folds** — see the trap below |
| 4 | **The Trainer-path ops printed as attack text, round 2** (search→Bench 16, search→hand-no-new-filter 15, self-switch 13, typed opponent-Energy discard 8, `moveEnergy` self→Bench 16 = **68**) | ~18 regexes, **1 new route value, 0 new ops, 0 new filters, 0 registry rows** | D181 proved the shape: four anchors, **38 legal printings measured** on the draw+gust family (its own commit says 34 — the discrepancy is not resolved here; both are counts of the same four anchors). This is the same trick with the next five Trainer ops, and it is the cheapest printing-per-line work left. **Do self-switch first**: D181 already found its real price is a `MATCH_RECORD_VERSION` bump, not a regex |
| 5 | **The 11 registry-only Ability/Trainer rows** (Teal Mask Ogerpon ex 8, N's Zoroark ex 4, Roselia-line 4, Carmine 4, Archaludon 3, N's Plan 3, Iono's Kilowattrel 3 = **29**) | **7 programs, 29 map entries. Zero engine code.** | Every op each of these needs is built and tested. It is the only lever that moves the **0.9 %** Ability/Trainer coverage number at all, and Teal Mask Ogerpon ex alone is 8 printings for one entry aliased 8 ways |

**Highest UNLOCK per primitive, ignoring cost:** the "You may" wrapper (78, but a
gate only), the damage-scaling members (87 across five), main-hit suppression
(40), opponent-chooses switch-out (14), Black Belt's Training (9).

---

# ⚠️ Traps this census had to walk around — and what was measured at each

### 1. A census has TWO numbers and they go stale separately
Both are derived above: **1,571 printings** and **784 distinct sentences**
(union across the three columns; the per-column figures are 464 / 166 / 157, and
they sum to 787 because 3 strings are printed both as an attack and as an
ability or Trainer). Quote whichever you mean, and never one for the other.

### 2. A census is only as wide as its VERBS — and a sentence has more than one
Every family above was read for its **other clauses**, and it changed the
pricing three times:
* *"If you go second, you can't use this attack during your first turn. This
  attack does 30 damage for each of your Benched Pokémon."* (7 printings) is in
  the scaling family **and** needs a going-second first-turn gate. It is not a
  one-member row.
* *"Search your deck for up to 2 Basic {D} Energy cards and attach them to this
  Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this
  way, this Pokémon is now Poisoned."* (3) is a search **and** a §9.2 record
  **and** a self-status.
* *"Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out
  your opponent's Active Pokémon to the Bench…"* (`sv06-062#0`) is counted in
  **both** the self-switch row and the opponent-chooses row, and it is finished
  by neither alone.

### 3. Do NOT infer a damage FOLD from an attack name — the printed adjective decides it
**Measured, on the same mechanic, in the same family:**

| Printed sentence | `damage` column | Fold |
|---|---|---|
| `sv06-096` Fezandipiti "Energy Feather" — *"This attack does 30 damage for each Energy attached to this Pokémon."* | **`30×`** | **MULTIPLY** — the printed base is dropped |
| `sv06.5-012` Kingdra ex "Hydro Pump" — *"This attack does 50 **more** damage for each {W} Energy attached to this Pokémon."* | **`50+`** | **ADDITIVE** |
| `sv10-009` Mow Rotom "Gadget Show" — *"…does 30 damage for each Pokémon Tool attached to all of your Pokémon."* | **`30×`** | MULTIPLY |
| `sv08-031` Skeledirge "Torcherto" — *"…does 20 **more** damage for each Benched Pokémon (both yours and your opponent's)."* | **`60+`** | ADDITIVE |

The `damage` column corroborates the adjective **every time it was checked**.
Each `DamageCountSource` member therefore needs **two** deriver arms
(`deriveAttackDamageMultiplier` and `deriveAttackDamageBonus`), not one.

### 4. Energy types are spelled TWO ways — and in THIS population, only one of them occurs
**Measured, and it is a real result, not an assumption.** Over all 2,383 legal
text units:

* bracket codes (`{W}`/`{R}`/`{P}`/`{M}` …) — **89 units**
* spelled-out words (`Water Energy`, `Psychic Energy`, `Metal Energy`,
  `Fire Energy`, `Grass Energy`, `Lightning Energy`, `Fighting Energy`,
  `Darkness Energy`) — **ZERO units**

The spelled-out notation that D40 had to handle (Charmeleon/Charizard
`swsh10.5-009`/`-010`) is a **`swsh10.5`-era artifact**, and `swsh10.5` is
**0 of 88 legal**. A regex written for brackets only is safe *for Standard* — and
is exactly the kind of claim that will be wrong again the moment a pre-SV set is
re-ingested, so **the dual-notation arms already in `effects.ts` must not be
deleted on the strength of this row.**

### 5. Near-miss sentences that share a substring with a family but are a different mechanism
All three of the shapes the old file warned about are **live in the legal pool**:
* *"If this Pokémon has at least 2 extra Energy attached (in addition to this
  attack's cost), this attack does 80 / 100 more damage."* (**5 printings**,
  two sentences) — an **excess-over-cost** read, NOT a plain energy count. It shares
  *"Energy attached"* with the `energyOnSelf` family and belongs to neither fold.
* *"You may put an Energy attached to your opponent's Active Pokémon into their
  hand."* (1) and *"You may put 2 Energy…"* (2+1) — a **bounce**, not a discard
  and not a scale, despite matching *"Energy attached to your opponent's Active"*.
* *"Put an Energy attached to this Pokémon into your hand."* (**5**,
  `svp-152#0`, `sv05-005#1`, `sv05-163#1`, `sv08-056#0`, `sv10-017#0`) — likewise
  a bounce, one word away from `discardEnergy yourActive`, which is BUILT. A
  regex that reaches for *"Energy attached to this Pokémon"* will eat it.

---

# ⚠️ THE VERB LEDGER — predicates tried that returned ZERO (or surprised)

Every predicate was run with **`LIKE '%…%'`/`GLOB '*…*'` — an UNBOUNDED window**,
deliberately, because the old ledger produced two false negatives from a
too-narrow `.{0,N}` and **a bounded wildcard is itself a predicate**. Run against
**all three text columns of all 2,021 legal rows** (2,383 units).

| Mechanic | Predicate | Result |
|---|---|---|
| status recovery | `%recovers from%` | **4** — the built §12 family |
| status | `%is cured%` | **ZERO** |
| status | `%remove…Special Condition%` | **ZERO** |
| status application | `%becomes %` | **8 — AND NOT WHAT THE OLD LEDGER EXPECTED.** The old ledger recorded ZERO for *"becomes (status)"*; the legal pool's *"becomes"* is a **different mechanic entirely** — *"…it is not Knocked Out, and its remaining HP **becomes** 10"* (7 abilities + 1 Tool). A verb can come back attached to a new family |
| status application | `%make …Poisoned/Burned/Confused/Paralyzed/Asleep%` | **7** — the D174 lesson still holds; an *"is now"* sweep misses all 7 |
| status application | `%is now %` | **174** |
| switch | `%swap%` | **ZERO** — the pool says "switch" |
| damage scaling | `%multiplied by%` · `%times the number%` · `%damage equal to%` | **ZERO, ZERO, ZERO** |
| damage scaling | `%×%` **in TEXT** | **4 — NO LONGER ZERO.** The old ledger recorded ZERO ("the × lives in the `damage` column"). It is now printed in text, but only inside a parenthetical: *"(Apply Weakness as ×2.)"* (Lillie's Clefairy ex ×4). Not a scale |
| damage modifiers | `%ignore%` | **2** — and both are **cost** ignores, not damage: *"ignore all Energy in this attack's cost"* / *"…in the cost of Frightening Howl"* |
| damage modifiers | `%regardless of%` · `%without applying%` | **ZERO, ZERO** |
| damage modifiers | `%isn't affected by%` | **59** — the suppression super-family across all three columns |
| healing | `%remove…damage counter%` | **ZERO** — healing is always *"Heal N damage from…"* |
| bounce | `%return…hand%` | **2**, and both are the same joke card (*"Then, return the Pokémon to your hand."*) — the bounce family says *"put … into your hand"* |
| ability lock | `%can't use…Abilit%` | **10** — of which **8** are the once-per-turn-BY-NAME rider, not a lock |
| ability lock | `%no Abilities%` | **11** — the real lock family |
| pre-SV mechanics | `%Lost Zone%` | **ZERO** |
| ACE SPEC | `%ACE SPEC%` | **ZERO in text** (the marker is not printed in `effect`) |
| modal | `%Choose 1:%` | **5** — Kieran. A shape the six-set census never saw |
| win condition | `%win this game%` | **1** |
| prizes | `%face up%` | **3** — the turn-a-Prize-face-up family |
| repeat | `%As often as you like%` | **9** |
| timing | `%Once during your turn%` | **119** · `%When you play this Pokémon from your hand%` **46** |
| energy notation | spelled-out `Water/Psychic/Metal/Fire/Grass/Lightning/Fighting/Darkness Energy` | **ZERO** (see trap 4) |
| hand refresh | `name LIKE '%Marnie%'` | **ZERO rows** — still true, now over 3,786 rows |

**Two of the old ledger's ZEROs are no longer ZERO** (`becomes`, `×`), and
neither changed because the window changed — they changed because **the
population changed**. A ledger entry is only valid for the pool it was run
against; that is why this one names its pool in every row.

---

# What the ROTATED census got wrong

Not "wrong" as in miscounted — D179's numbers were right for its 978 rows. Wrong
as in **pointed at cards nobody can play**.

## The headline

| | Rotated census (978 rows / 6 sets) | This census (2,021 rows / 18 sets) |
|---|---:|---:|
| unbuilt printings | 458 | **1,571** |
| distinct unbuilt sentences | 281 | **784** |
| …of which are on Standard-legal cards | **~72 (16 %)** | 1,571 (100 %) |

**Of the old file's 458 unbuilt printings, roughly 384 — 84 % — are on cards
that cannot be played.** The arithmetic: its per-set unbuilt counts were
sv01 93, sv02 121, sv03 100, sv06.5 74, swsh10.5 70. Every legal row in `sv01`,
`sv02`, `sv03` and `sve` is a **Basic Energy with no rules text**; `swsh10.5` is
**0 of 88 legal**. Only the `sv06.5` slice survives — and it measures **72**
unbuilt printings today.

## Row by row

| The old file's row | What the legal pool says |
|---|---|
| **Tier 0 — reprint-alias gaps, 4 printings** | **0 of 4 are legal.** `sv02-245` is mark G; `swsh10.5-069`/`-078`/`-084` are mark F/D. Correct rows, zero legal payoff — already recorded by D180's follow-up. **The legal Tier 0 is a different 22 printings / 9 sentences**, and it is 5.5× bigger |
| **Tier 1 — draw in attack text (12) + draw-until (3) + gust (4)** | **BUILT (D181)** and worth more than it looked: **38 legal printings** by measurement — *"Draw a card."* 22, *"Draw 2 cards."* 9, *"Draw 3/4 cards."* 2+2, *"Draw cards until you have 7…"* 1, gust 2. The best evidence in the repo for "an arm is a parser and its sentences transfer" |
| **Tier 1 — self-switch (9)** | **SURVIVES and grows: 13 printings / 5 sentences**, all still unbuilt. D181 found its real price is a `MATCH_RECORD_VERSION` bump |
| **Tier 1 — deck-search-and-attach-to-SELF (7)** | **SURVIVES: ~10 legal printings** of the `attachFromDeck toSelf` shape, inside a 27-printing search-and-attach family |
| **Tier 1 — the K-target snipe count widening (5)** | **SURVIVES: ~13 legal printings** (K=2 and K=3, including two behind a discard clause) |
| **Tier 1 — Item-card discard-pile retrieval (4)** | **GONE. Zero legal printings.** *"Put an Item card from your discard pile into your hand."* does not occur in the legal pool. The legal twins are *"Put a **Trainer** card…"*, *"…a **Supporter** card…"*, *"…a **Pokémon**…"*, which are different filters. **The `itemCard` filter is still wanted — but by deck SEARCH (4 printings), not by discard retrieval** |
| **Tier 2 — the four damage-scaling COUNT SOURCES (28)** | **SURVIVES and TRIPLES: 87 printings / 42 sentences over FIVE members.** Still the largest single unlock |
| **Tier 2 — main-hit suppression (10)** | **SURVIVES and QUADRUPLES: 34 attack + 6 ability = 40 printings**, and the leading sentence changed — the old file's top string (*"…isn't affected by Resistance."*, 4) is now second to *"…isn't affected by any effects on your opponent's Active Pokémon."* (15) |
| **Tier 2 — `moveEnergy` self→Bench (7)** | **SURVIVES: 16 printings / 5 sentences** |
| **Tier 2 — the `anyCard` search filter (14)** | **SURVIVES at ~8–14**, and **Cassiopeia `sv06.5-056`/`-086`/`-094` is legal** — one of the very few named cards that carries over |
| **Tier 2 — once-per-turn BY NAME (13)** | **SHRINKS to 8** (Pecharunt ex 5, Fezandipiti ex 3). **Pidgeot ex and Squawkabilly ex are rotated**, so the row lost its two biggest members and its "finish Pidgeot ex whole" argument with them |
| **Tier 3 — opponent-chooses switch-out (16)** | **SURVIVES at 14** and is still the biggest Tier-3 row. But it **no longer reaches three columns**: Ryme (`sv03-194`/`-221`) and both Abilities (Mabosstiff, Shinx) are rotated, so the legal family is **attacks only** |
| **Tier 3 — `discardStadium` (7)** | **SURVIVES and grows to 9 / 4 sentences** |
| **Tier 3 — the card-type PLAY LOCK (7)** | **SURVIVES at 10** (7 attack + Jellicent ex ×3) |
| **Tier 3 — multi-status + both-Actives (7)** | **SURVIVES at 12 / 7 sentences** |
| **Tier 3 — the flip-to-attack lock (4)** | **SHRINKS to 2.** Dolliv and Quaxly are rotated; the sentence survives on two newer cards |
| *"the last unbuilt Special Energy is `sv02-192` Reversal Energy"* | **Reversal Energy is legal — as `sv04-266`, the mark-G anomaly — and there are now ELEVEN unbuilt Special Energies, not one.** The old sentence is true of the wrong printing of the right card |
| *Penny (3, bounce-to-hand)* · *Poké Vital A `sv06.5-062`* | Penny is **rotated**. Poké Vital A is `sv06.5` — **check its mark before pricing it**; the set is 96/99 legal and its one G row is `sv06.5-096` Earthen Vessel |
| *Choice Belt: "the SV-era pool holds no Pokémon V"* | **Still dormant against Standard.** `%Pokémon V%` appears in legal text only as *"Pokémon ex or Pokémon V"* damage gates; the 13 V / 2 VMAX / 5 VSTAR the old file found are all `swsh10.5`, **0 of 88 legal** |

## What is NEW — families the old census could not have seen

These are in the 14 sets it never covered. Together they are **~70 printings**
of mechanism that no row of the old backlog anticipates:

| New family | Printings | Why it is new |
|---|---:|---|
| **Owner-prefixed subgroups** (`Team Rocket's`, `Ethan's`, `Iono's`, `N's`, `Cynthia's`, `Misty's`, `Steven's`, `Lillie's`) | **67 text units** | A whole `CardFilter` dimension. `sv01`–`sv03` had zero |
| **Black Belt's Training** — turn-scoped attack-damage aura from a Supporter | **9** | The largest Trainer family in Standard, and there is no per-turn effect channel |
| **Survive-at-10-HP** (*"…its remaining HP becomes 10"*) | **8** | The first passive that intercepts the §8.1 KO sweep |
| **Teal Mask Ogerpon ex** attach-and-draw Ability | **8** | Cheapest registry row in the file — 8 printings, all ops built |
| **Festival Grounds double-attack** | **7** | A second attack inside one turn |
| **Modal *"Choose 1:"* Supporters** (Kieran) | **5** | A branch on a player's free choice |
| **Fossil Trainers played as Pokémon** | **4** | A Trainer occupying a Bench slot |
| **Tera / Ancient / Future Pokémon predicates** | 23 / 11 / 18 | Three new class predicates, mostly riding other families |

---

## Structural notes for whoever builds next

* **926 of the 1,571 unbuilt printings are ATTACK text** — derivable, i.e.
  payable in regexes. **373 are Abilities and 272 are Trainers/Special Energy,
  and those have no deriver at all**: each is a hand-authored registry row
  forever. The cards-per-line-of-code ratio is therefore far better on the attack
  side, which is where Tiers 1 and 2 mostly sit — but **the Ability/Trainer side
  is where the coverage is 0.9 %**, and no amount of regex work will move it.
* **A REGISTRY ROW and a DERIVER ARM must never be priced on the same scale.**
  An arm is a text parser and its sentences transfer across sets (D181: four
  anchors, 38 legal printings). A row is keyed by card id and serves exactly the
  printings it names — which is why 172 of the registry's 178 ids are, today,
  worth nothing to a Standard game.
* **The reprint structure changed.** The staples the registry authored — Nest
  Ball, Boss's Orders, Ultra Ball, Iono, Judge, Professor's Research, Switch,
  Rare Candy, Super Rod, Poké Ball, Great Ball, Pal Pad, Potion, Crushing
  Hammer, Energy Switch, Earthen Vessel — have **ZERO Standard-legal printings in
  this catalog** (measured by name across all 3,786 rows). Every one of their
  reprints is mark G or older. That is why Tier 0 is 22 printings and not 200.
* **UNMEASURED, and named as such:** (a) whether the catalog's `legal_standard`
  column tracks the *current* official Standard rotation — it is taken as
  authoritative here, with the single `sv04-266` disagreement flagged; (b)
  whether any of the 8 registry-only Tier-1 rows is *behaviourally* correct —
  they are priced by op availability, not by a written and passing test; (c)
  Expanded legality (`legal_expanded`) was not analysed at all.
* **This file measured a moving target and says so.** Two sibling sessions were
  writing `packages/engine/**` during the census. The deriver sweep was run
  twice — before and after HEAD moved from `f54abaf` to `2e5832e` (D181 + D180's
  follow-up + D184's merge) — and returned **176 built / 464 unbuilt distinct
  attack sentences both times**. D181's draw and gust arms are **counted as
  BUILT** here. If HEAD has moved again, re-run the sweep before trusting the
  attack row of the Result table; the other three rows are registry-keyed and
  move only when `registry.ts` does.

---

## Addendum — coordinator verification (session #161)

Three of this file's own claims were independently re-checked against the same
remote D1 before it was committed. Two hold; one open item is now CLOSED.

### ✅ CLOSED — the D181 discrepancy. This file's **38** is right; D181's **34** is wrong.
D181's commit message claims its four anchors serve 34 Standard-legal printings;
this census measured 38. The cause is not a disagreement about the catalog — it is
that **D181 counted the sentences it had SEEN rather than the language its regex
ACCEPTS.** The anchor is parameterised:

```ts
const ATTACK_DRAW = /^Draw (?:(\d+) cards|a card)\.$/;   // effects.ts
```

The six-set scope it enumerated contains only `Draw a card.` and `Draw 2 cards.`,
so it reported those. The Standard-legal pool also holds **`Draw 3 cards.` ×2** and
**`Draw 4 cards.` ×2**, which that regex already matches. 22 + 9 + 2 + 2 = 35 draw,
+1 draw-until, +2 gust = **38**. The anchoring correctly REFUSES
`Draw 3 cards from the bottom of your deck.` ×1 (a `deckBottom` mechanism).
⚠️ **The general rule, which is new and belongs beside "a census is only as wide as
its verbs": WHEN A FAMILY IS SERVED BY A PARAMETERISED ANCHOR, ITS COVERAGE IS A
PROPERTY OF THE PATTERN, NOT OF THE ROWS YOU ENUMERATED.** Price a parameterised arm
by running it over the pool, not by listing the strings that prompted it. D181 erred
in the SAFE direction (under-claiming), which is why nothing went red — and why it
would never have been found by a failing test.

### ✅ HELD — the legality axis is internally consistent and is safe to build on.
`legal_standard` is exactly `regulation_mark IN ('H','I')` plus unmarked Basic Energy,
with no exceptions beyond the one this file already flags (`sv04-266`). Corroborated
independently from OUTSIDE the catalog: `src/features/builder/cards.ts` has carried
`legalRegulationMarks: ["H", "I", "J"]` with the comment *"the marks after the April
2026 rotation (G rotated out)"* since long before this census — written from rules
research, and it agrees exactly. Recent sets are overwhelmingly H/I and fully legal
(`sv10` 236 I + 6 H legal / 2 G not; `sv10.5w` 173 I, all legal).

### ⚠️ QUALIFIED — "the staples are gone" is true of THIS CATALOG's mark assignments,
and must not be read as "the sentence is unreachable".
Measured: `Professor's Research` has **17 printings across 7 sets and 0 Standard-legal**
— every one carries mark **G** (or **D** for `swsh10.5`), including reprints sitting in
`sv08.5`, `sv09` and `sv10.5b`. Same shape for `Boss's Orders`, `Iono`, `Nest Ball`,
`Ultra Ball`, `Rare Candy`, `Switch`, `Super Rod`. Whether a modern reprint genuinely
carries mark G is an UPSTREAM DATA question this session cannot settle, and it does not
change what to build — but it does change how to READ this file's tiers:

- **A DERIVER ARM is a text parser. Rank it by legal printing count, but it is safe to
  build regardless** — the sentence recurs, and an arm that matches a rotated printing
  today matches its H/I reprint the moment one is ingested, at zero further cost.
- **A REGISTRY ROW is keyed by CARD ID and serves exactly the ids it names.** Legality is
  a HARD filter there. This is D180's footnote generalised: four correct alias rows that
  serve zero Standard-legal printings.

That asymmetry — *an arm transfers across sets; a row does not* — is the single most
useful thing this census establishes, and it is why the **0.9 % coverage of the 651
Standard-legal Ability/Trainer/Energy printings** is the real finding here, not the
1,571 total. Attack text is derivable and has 806 of 1,732 built; the non-attack surface
has **6 of 651** and no deriver exists for it at all.

---

## ⚠️ THE DEAD-DATUM CLASS — a sentence can be UNBUILDABLE, not merely unbuilt

Three slices have now independently hit the same wall, and it is not a vocabulary gap:
**the printed predicate names a card property that exists on the CARD but in NO INGESTED
COLUMN.** `PRAGMA table_info(cards)` is the whole surface — id, set, local_id, name,
category, illustrator, rarity, regulation_mark, hp, stage, evolve_from, types_json,
retreat, abilities_json, attacks_json, weaknesses_json, resistances_json, trainer_type,
energy_type, effect, legal_standard, legal_expanded, variants, updated, image_url, suffix.
**Nothing else about a card is knowable to this engine.**

| Banner | Printing that needs it | Found by |
|---|---|---|
| **"Ancient"** | Flutter Mane `sv08-096` — *"1 of your Benched **Ancient** Pokémon"* | D205 |
| **"Future"** | Iron Crown ex family (6 legal) — *"Attacks used by your **Future** Pokémon…"* | this recon |
| **"Tera"** | `sv10-087`, and `sv07-132`/`-163`/`-171`/`sv08.5-100` (4 legal) — *"Active **Tera** Pokémon"* | this recon |

⚠️ **WHY IT MATTERS MORE THAN "UNBUILT": AN OP AUTHORED OVER AN ABSENT DATUM HAS A
PERMANENTLY EMPTY CANDIDATE SET, WHICH `programPlayable` TURNS INTO A CARD THAT CAN NEVER
BE PLAYED.** That is strictly worse than leaving the printing unbuilt — it is a *silent dead
print* rather than a loud absence, and it will pass every test written against it, because
the tests are written by whoever believed the datum existed.

**THE RULE, for any future census or slice brief: BEFORE YOU DESIGN A PREDICATE, NAME THE
FIELD IT READS AND CONFIRM IT IS IN THAT COLUMN LIST.** A predicate over a banner, a
subtype, or any adjective printed on the card face is a dead datum until an ingest column
carries it. **These 11 legal printings are not backlog — they are blocked on the INGEST,
not on the engine**, and they should be priced as such (a schema column + a re-ingest,
which today also needs `api.tcgdex.net` unblocked).

## ⚠️ AND A FLAG CAN BE WRONG IN THE *CHEAP* DIRECTION TOO

D199's `DROPPED` table flagged the opponent-remaining-prize threshold as needing a new
`BoardCondition` member. **It does not: `opponentPrizesRemaining` already existed in
`effects.ts` at D199's own commit** (`{ kind: "opponentPrizesRemaining"; counts: readonly
number[] }`, folded by `conditionHolds`), and D199's `needs` string names only
`morePrizesThanOpponent` — it missed its own sibling. **7 Standard-legal printings were
sitting behind a flag that said "new union member" and meant "two registry rows".**
⚠️ **Note both spellings occur and are NOT the same number**: `prizes.length` is REMAINING,
while `opponentPrizesTaken` (a `DamageCountSource`, 26 legal printings) is `6 − remaining`.
**Do not cross them.**

So the vacuous-guard lesson has a mirror: **a flag can overstate a cost as easily as it can
understate a gap, and nothing in the suite objects either way.** Re-derive the *needs*
column, not only the ids and counts.
