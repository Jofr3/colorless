> ### ▶ THE NEXT CONCRETE ACTION (written 2026-08-15, after D345)
>
> ✅ **NO DEBTS ARE OUTSTANDING, THE TREE IS CLEAN AND EVERYTHING IS PUSHED** —
> the branch `claude/backend-loop-subagents-q2wz9f` AND `main`, which was
> fast-forwarded at the user's explicit instruction. **NO PULL REQUEST WAS
> OPENED, BY INSTRUCTION.** `bun run check` **354 files / 7,254 tests, exit 0**;
> full mutation sweep **990 killed · 22 known survivors · 0 GAPs · 0 stale ·
> 0 skipped(dirty) · 0 clobbers · 0 errors**, 3,275.5 s. **`990 + 22 = 1012` ✅
> = the corpus**, and the delta reconciles EXACTLY against this slice's 13 rows:
> killed **978 → 990** (+12) and known survivors **21 → 22** (+1, the one this
> slice declared). ⚠️ **ZERO baseline errors — the first slice in three to pay
> nothing at the end of the run**, because the five-site bump and the
> whole-corpus anchor check both happened BEFORE the sweep rather than after.
>
> ### ▶ 🛑 THE ONE THING TO READ BEFORE PREDICTING ANYTHING
>
> **D344 named the defect and D345 committed it anyway, at a ratio of ten misses
> to one lesson.** D344's four misses were *all* "a figure named is not its rungs
> enumerated". D345 read that sentence, wrote a prediction file, listed
> `BUILT.ability` — and enumerated **TWO** of its rungs. There are **EIGHT**:
>
> 1. `BUILT.ability` itself (`censusAtHead.test.ts`);
> 2. `CENSUS_POKEMON_LEGAL.length`, asserted `toBe(BUILT.ability)`;
> 3. the **decomposition tie** — a sum of ~60 named `*_IDS.length` terms, whose
>    entire purpose is to redden when this column moves;
> 4. `ABILITY_NAME_TERMS` — the (name → ids) table;
> 5. `ABILITY_D1_SHAPE.printings` **and** `.distinctNames` (two constants);
> 6. `ABILITY_D1_COLUMNS.abilitiesJson` **and** `.attacksJson` (two more, tied by
>    `printings − abilitiesJson = 13`, the attack-gate identity);
> 7. `groups.length` — the PROGRAM-OBJECT decomposition;
> 8. `pairs.size` — the (name, object) JOIN, plus its
>    `distinctNames + splits` derivation.
>
> …**plus four figures OUTSIDE the column** that a `BUILT.ability` move drags:
> `built`, `units - built`, the three-column sum, and `LANDED`/its legal sum.
> **THE OPERATIONAL RULE, WHICH IS CHEAPER THAN THE LIST:** before predicting,
> `grep -n "BUILT\.<column>\|<THE_TABLE_NAME>" packages/engine/src/*.test.ts` and
> put **every hit** in the prediction. A name is not a rung; a hit is.
>
> ⚠️ **AND TWO OF D345's MISSES WERE NOT COUNTS AT ALL** — one was a **UNIT**
> (`LANDED` steps by ROWS, not by printings; D341's lesson reproduced inside a
> prediction file) and one was an **INHERITED BASELINE** (the four-list closure
> was predicted `531 → 537` off the work order and is `532 → 538`; every other
> figure was re-derived and this one was not). **Re-derive the FROM as well as
> the TO.**
>
> ### ▶ 🛑 THE FIVE VERSION SITES — THE CHECKLIST WORKED, KEEP IT
>
> D343 made this mistake, D344 made it again; **D345 executed it as one edit and
> paid nothing.** Bump all five in ONE commit:
> 1. `packages/engine/package.json` — `"version"`.
> 2. `packages/engine/src/index.ts` — `export const engineVersion`.
> 3. `packages/engine/src/index.ts` — the new `/** 🆕🆕 X → Y */` doc block.
> 4. `packages/engine/src/legacyEnergy.test.ts` — the two `toBe("X.Y.Z")` pins.
> 5. `scripts/mutation/mutants.ts` `D275-engine-version-drifts-again`, whose
>    `find` QUOTES the constant. **Not a version site — a mutation anchor a
>    version site breaks.**
>
> ⚠️ **AND RUN THE WHOLE-CORPUS ANCHOR CHECK BEFORE THE SWEEP, OVER ALL ROWS.**
> There is no `--precheck` flag; the five-line `bun -e` that imports `mutants.ts`
> and asserts every row's `find` occurs EXACTLY ONCE is the equivalent. **IT
> EARNED ITS KEEP AT D345**: one newly-authored row was ambiguous (×2) against a
> line `returnSelf` also prints, and was widened before the sweep rather than
> after 55 minutes. **Re-run it AFTER `biome --write` touches `mutants.ts`** —
> D345 did, and that is the cheap half of the discipline.
>
> ### ▶ THE NEXT ROW HAS NOT BEEN PRICED, AND THAT IS DELIBERATE — THE METHOD WORKS
>
> 🛑 **D344 STOPPED PRE-PRICING BECAUSE FIVE HANDOFFS RUNNING WERE WRONG. D345
> RAN ITS METHOD INSTEAD AND THE METHOD'S THIRD STEP PAID IMMEDIATELY** — the
> card the residue pointed at (Magneton ×3) was the one third of its own family
> that owed a second mechanism. **DO NOT GO BACK TO PRICING. RUN THE METHOD:**
> 1. **Read `censusAtHead.test.ts`'s `ROWS` table and take the largest
>    `abilityIds` / `effectIds` residue** — a LIVE list guarded by a test rather
>    than a claim in prose. **Read the counts off the file, not off this
>    sentence.** At this head row 9 is **7** (5 `abilityIds` + 2 `effectIds`
>    after Reboot Pod and Glass Trumpet are re-read as dead-datum, see below) and
>    row 10 is **5** — but re-derive both.
> 2. **Census the SENTENCE, over ALL THREE columns, and re-add every per-column
>    split against its own total.**
> 3. **Then ask whether the card you were sent for is the CHEAPEST thing that
>    sentence buys** — twice in five slices it was not.
> 4. **And grep for it**: registry row, program, id-map entry. Prose is not an
>    implementation, and four prose sites can all be stale in the same way.
>
> ### ▶ WHAT ROW 9 STILL OWES, PRICED AGAINST THE CODE
>
> Row 9's residue is **10 ids** on paper and **3 buildable ones** in fact:
> * **Magneton `svp-153`/`svp-159`/`sv08-059` (3 legal)** — owes ONLY the
>   *"attach up to 3 … **in any way you like**"* DISTRIBUTION now that
>   `knockOutSelf` exists. That is a multi-DESTINATION assignment: D205's `count`
>   lands the batch on ONE picked target and D248's `toEach` is a fold with no
>   pick. The prompt shape already exists (`attachCards` assignments, used by
>   `attachFromTop`/`attachFromDeck`) — **so the question for the next slice is
>   whether `attachEnergyFrom` can reach that prompt rather than whether a new one
>   is needed.** Census the phrase before pricing it: `instr(<col>,'in any way you
>   like')` over all three columns is NOT yet re-derived at this head.
> * **Lycanroc `sv09-085`/`sv09-166` (2 legal)** — *"up to 2 **Spiky Energy**
>   cards"*, a card named by NAME. `attachEnergyFrom` narrows by
>   `energyType`/`anyEnergy` only, and D246 refused this op a `CardFilter` for a
>   measured reason. **Unchanged; do not re-open without re-reading D246.**
> * **Glass Trumpet `sv07-135`/`sv08.5-110` (2 legal)** — 🛑 **DEAD DATUM, NOT A
>   REMAINDER.** *"only if you have any **Tera** Pokémon in play"*: `SELECT
>   suffix, COUNT(*) FROM cards GROUP BY 1` is two rows (NULL 3,157 / `ex` 629)
>   and every `Tera` hit in the catalog is DEMAND (registry.ts's Briar note names
>   this card among them). **Recorded as a shape. Do not build.**
> * **Reboot Pod `sv05-158` (1 legal)** — *"to each of your **Future** Pokémon"*,
>   the same dead datum (D243). **Do not build.**
> * **Powerglass `sv06.5-063`/`-097` (2 legal)** — needs a new `endOfTurn`
>   `TriggerTiming` plus a Tool hook in the turn machine (`grep -rn "endOfTurn"
>   packages/engine/src` is **ZERO HITS**). Censused at D345 before refusing:
>   `instr(<col>,'the end of your turn')` is `effect` **10/4/4** +
>   `abilities_json` **5/0/3** + `attacks_json` **0/0/0**, and **2 of the 4 legal
>   `effect` printings are the Technical Machine / Ignition Energy SELF-DISCARD
>   tail** — a different mechanism wearing the same words. **The timing buys 2
>   legal printings today. Price it honestly if you take it.**
>
> ### ▶ THE STANDING REFUSAL, UNCHANGED THROUGH FIVE SLICES
>
> 🛑🛑 **DELETE THE FESTIVAL GROUNDS ROW FROM ANY WORK ORDER THAT STILL CARRIES
> IT — UNCHANGED FROM D341/D342/D343/D344 AND NOT RE-OPENED AT D345.** Its count
> (**7 legal**, one byte-identical `abilities_json` sentence) is correct and is
> the only thing about it that is. It needs THREE mechanisms, one of them a record
> bump: a turn machine that can declare a second attack (`grep -rn
> "attackAgain\|extraAttack\|attacksThisTurn\|attackCount\|attackedThisTurn"` over
> `packages/engine/src` is **ZERO HITS**, and `attackEpilogue.uid` is a REQUIRED
> persisted field, so this is a `PendingStage` change → **`MATCH_RECORD_VERSION`
> 20 → 21**); a re-entry behind the KO sweep; and a NAMED-STADIUM `BoardCondition`
> reading EITHER seat's Stadium. **Not one slice.**
>
> ### ▶ THE OPEN FINDING, NOW WITH A THIRD INSTANCE AND A SHARPER SHAPE
>
> ⚠️ **A FIGURE QUOTED IN A COMMENT IS INVISIBLE TO EVERY CHECK IN THIS REPO.**
> D343 found eight rotten prose figures; D344 found a rotten prose *sentence*;
> **D345 found the same stale enumeration in FIVE places at once** — *"Dusclops
> `sv06.5-019`/`-069` and Dusknoir `sv06.5-020`/`-070`"*, four printings where the
> catalog has six, in `effects.ts` ×2, `attackLock.test.ts`, `counterPut.test.ts`
> and `docs/workstreams/simulator.md`. **The new part is that all five were COPIES
> OF ONE SENTENCE**, so the cheap errand D343 proposed would have caught none of
> them (they quote ids, not a figure that owns an assertion) — but a much cheaper
> one would: **a check that every `sv…-…` id enumerated in a comment beside a
> card NAME is the complete set of that name's legal printings.** That is a join
> the repo already has the pieces for (`CENSUS_POKEMON_LEGAL`, the D1 manifest),
> and it is the first proposal in this run that would have caught a real defect
> found by hand.
>
> ### ▶ THE AUDITOR-POPULATION RUN, STILL NOT DECLARED FINISHED
>
> D341 repaired `preventBlock` §11; D342 repaired `programWalk`; D343 repaired
> `revealClause`'s DISCOVERED census; D344 found no fourth and avoided authoring
> one. **D345 FOUND THE FOURTH INSTANCE — IN ITS OWN NEW FILE, AND NOT IN AN
> AUDITOR.** `cursedBlast.test.ts`'s HP-aura case was written against an invented
> body carrying Ability TEXT and no program, which raises nobody's maximum: the
> case was green and meant nothing until `programFor` was asserted DEFINED on it.
> **THE POPULATION DEFECT AND THE VACUOUS-FIXTURE DEFECT ARE THE SAME DEFECT** —
> both are a claim asserted against a stand-in that cannot answer it. The unspent
> errand is unchanged and now has a companion: `grep -rn
> "Object.entries(FIXTURE_POOL)\|Object.keys(FIXTURE_POOL)"
> packages/engine/src/*.test.ts` (**68 hits** at D343) — *does this loop need
> printed card text?* — **and, for every new fixture that carries an `abilities`
> array, does anything read its PROGRAM?**
