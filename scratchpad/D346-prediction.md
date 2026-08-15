# D346 — PREDICTION, written BEFORE any build edit

Head `e75b55a`. Baseline `bun run check` re-run at this head: **354 files / 7,254 tests, exit 0**
(re-derived, not inherited — the work order's figure agrees).

## THE ROW

**Magneton `svp-153` / `svp-159` / `sv08-059` — "Overvolt Discharge", 3 legal printings, ONE
sentence, ONE program object, ZERO engine diff.**

Method, run in order:

1. **Largest live `ROWS` residue.** Read off `censusAtHead.test.ts`, not off the handoff:
   row 9 = 5 `abilityIds` + 5 `effectIds` = **10 on paper / 7 live**; row 10 = 4 + 1 = **5**;
   row 12 = 4 + 0 = **4**; row 11 = 3 + 0 = **3**; rows 0/13/15/16 empty. Row 9 wins on either
   reading.
2. **Census the CLAUSE, all three columns, remote D1 `luminous`
   (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`).** `instr(<col>,'in any way you like')`:
   `effect` **3 printings / 1 legal / 2 sentences**, `abilities_json` **38 / 13 / 13**,
   `attacks_json` **59 / 36 / 36**. The 13 legal ability printings are 7 cards:
   Archaludon ex ×3 (**BUILT**, D263), Infernape ×3 (row 12), Magneton ×3 (row 9),
   Metang ×2 (row 11), Steven's Metagross ex ×1 (row 10), Marnie's Grimmsnarl ex ×1, and
   that is the whole legal ability population of the phrase.
3. **Is Magneton the cheapest thing that sentence buys?** YES, and it is also the largest.
   Every other unbuilt member owes a mechanism Magneton does not: Infernape/Steven's need the
   *"or 1 of each"* two-type grammar, Metang needs a bottom-of-deck leftovers disposition,
   Marnie's needs an owner-prefix target. Magneton owes **nothing**.
4. **Grep — has it shipped?** No. `programFor("svp-153")` is asserted `undefined` by
   `cursedBlast.test.ts` §2. Every other hit is prose.

## THE ANSWER TO D345's OPEN QUESTION — **NEITHER**

D345 asked whether `attachEnergyFrom` can reach the existing `attachCards` assignment prompt.
**It must not, and it does not need to.** The engine's settled reading, stated in three places
and *implemented* in two:

* `effects.ts` `attachEnergyFrom.count` doc — *"N ops park N times and may land on N different
  bodies (Koraidon 'Dino Cry''s printed **in any way you like**), where `count` parks ONCE and
  pins the batch."*
* `effects.ts` `attachFromHand` doc — the `attachCards` MAP is for *"any number"*, which names
  no unit to unroll; *"up to N"* is **N separate `attachEnergyFrom` ops**, and the two
  `sv08-079`/`-204` printings *"are already built"* that way.
* `registry.ts` `ASSEMBLE_ALLOY` (D263) — **two** `attachEnergyFrom` ops for *"attach up to 2 …
  from your discard pile … in any way you like"*, deliberately not `count: 2`, quoting
  `attachFromZoneProgram`'s own `destination.anyWay` expansion so the hand-authored and derived
  readings cannot drift.

Magneton prints **"up to 3"** — a printed count — so it is three ops. The distribution
**shipped at D263**, 82 decisions ago.

## 🛑 THE FINDING: D345's RESIDUE NOTE REVERSED A CORRECT EARLIER ONE

`legalNonAttackPrograms.test.ts` (D263) already priced this card exactly right:

> Magneton … *"the attach **is expressible** (3 ops, `targetType: "Lightning"`), but the second
> printed clause is 'If you use this Ability, this Pokémon is Knocked Out' and NO OP IN THE
> ENGINE KNOCKS OUT ITS OWN HOST."*

D345 shipped `knockOutSelf`, which spends exactly that blocker — and then wrote a **new** note
saying the blocker was the distribution instead, in ~10 places. Both halves have been built
since D345's own commit. **The card was buildable at `e75b55a` with zero engine code and the
handoff said it was not.** This is D343's "prose is not a rung" and D341's "a residue note that
names a mechanism rots" at the same time — and the rot here **inverted** a correct note.

## THE PROGRAM (zero new ops, zero new fields)

```ts
const OVERVOLT_DISCHARGE: CardProgram = {
  abilities: [{ name: "Overvolt Discharge", oncePerTurn: true, activeOnly: false,
    program: [
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning" },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning" },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning" },
      { op: "knockOutSelf" },
    ] }],
};
```

No `energyType` = the printed bare *"Basic Energy cards"* (`attachableEnergies` tests
`card.energyType === "Normal"` when `anyEnergy` is absent). `knockOutSelf` LAST, for
`CURSED_BLAST`'s reason: the attaches PARK, so the KO resolves on the final resume.

## FLAGGED DESIGN CALL (to be written down, not hidden)

`programPlayable` (cardplay.ts) refuses an `attachEnergyFrom` whose source zone holds no
matching Energy **or** whose `targetType` set is empty. So a Magneton with no Basic Energy in
the discard, or no {L} Pokémon in play, cannot use the Ability at all. Strictly the printed
rules would let you use it and die for nothing; the engine's standing doctrine (D222
afford-then-reject; the `switchActive` gate two lines up) refuses an op that can only whiff.
**Taking the doctrine**, and saying so at the registry row.

## PREDICTED MOVES — every hit of every figure name, not every name

### `censusAtHead.test.ts`
1. `BUILT.ability` **258 → 261** (L1086)
2. `built` **1573 → 1576** (L3906) — re-added: 1198 + 261 + 109 + 8
3. `units - built` **810 → 807** (L4021) — 2383 − 1576, `units` unmoved
4. the **decomposition tie** `expect(BUILT.ability).toBe(…)` (L4136-4563) — gains a **new
   summand** `OVERVOLT_DISCHARGE_IDS.length`, and the `const OVERVOLT_DISCHARGE_IDS` beside
   `CURSED_BLAST_13_IDS`
5. three-column sum `BUILT.ability + .trainer + .specialEnergy` **375 → 378** (L5437)
6. `raw[raw.length - 1]` **`"sv08.5-037"` → my last inserted key** (L6642) — the insertion-order rung
7. `raw.length` **682 → 685** (L6774) — 3 real catalog ids, **NO** `fix-*` key (local `cardPool`)
8. `nonAttackRegistryIds().length` **538 → 541** (L6775) — 0-wide with (7) for the 7th slice running
9. four-list closure `…+ CENSUS_NOT_LEGAL.length` **538 → 541** (L6811) — the THIRD rung on that number
10. `CENSUS_POKEMON_LEGAL` gains **3 ids** (L~6161); `.length).toBe(BUILT.ability)` (L6806) is a TIE
11. `ABILITY_D1_SHAPE` **printings 258 → 261**, **distinctNames 117 → 118** (L8167) — a **3:1:1** step
12. `ABILITY_D1_COLUMNS.attacksJson` **258 → 261** (L8426); `.abilitiesJson` **245 → 248** (L8427)
13. `ABILITY_NAME_TERMS` gains ONE (name, ids) row; `.length).toBe(distinctNames)` (L8250) is a TIE
14. `groups.length` (PROGRAM OBJECTS) **106 → 107** (L8274)
15. `pairs.size` (name,object JOIN) **119 → 120** (L8358)
16. `ABILITY_D1_SHAPE.distinctNames + ABILITY_SPLIT_NAMES.length` **119 → 120** (L8370)
17. row 9 `abilityIds` **5 → 2** (L1412-1414) — and the "every non-attack id … has no registry
    program" guard (L3127) is what reddens if I forget

### `legalNonAttackPrograms.test.ts`
18. `LANDED` **53 → 54** (L1814) — **ONE row**, one card, one object. ⚠️ UNIT: this table steps
    by ROWS (cards), the sum below steps by legal printings.
19. `LANDED.reduce(legal)` **107 → 110** (L1815)
20. the D263 ladder comment (L2425-2440) — its Magneton bullet is now FALSE twice over
21. a driven `describe` for the new row

### `cursedBlast.test.ts`
22. §2 `"Magneton ×3 has no program"` (L423) — **INVERTED**; the refusal is spent
23. `"knockOutSelf has exactly TWO producers"` (L~431) — **TWO → THREE**
24. the file header's Magneton prose (L39, L55-56, L73)

### the FIVE version sites, ONE commit
25. `packages/engine/package.json` `"version"` **0.251.0 → 0.252.0**
26. `packages/engine/src/index.ts` `export const engineVersion`
27. `packages/engine/src/index.ts` new `/** 0.251.0 → 0.252.0 */` doc block
28. `packages/engine/src/legacyEnergy.test.ts` **two** `toBe("0.252.0")` pins
29. `scripts/mutation/mutants.ts` `D275-engine-version-drifts-again` — the `find` QUOTES the constant

### elsewhere
30. NEW FILE `packages/engine/src/overvoltDischarge.test.ts` → check files **354 → 355**
31. `docs/reference/coverage-backlog-legal.md` row 9 cell (`12 = 2 · 5 · 5` → `9 = 2 · 2 · 5`)
32. `docs/progress.md` — header stamp, status row, session log, rewritten resume point
33. mutation corpus **1012 → 1017** (5 new rows planned)

## PREDICTED **UNMOVED**, each measured not assumed

Remote D1, 2026-08-15, all three ids: `category = 'Pokemon'`, `legal_standard = 1`,
`effect IS NULL`, `length(abilities_json) = 242`, `length(attacks_json) = 71` and that
`attacks_json` is a **bare** `[{"cost":["Lightning","Colorless"],"name":"Electric Ball","damage":40}]`
with **no effect text**.

* `BUILT.attack` **1198** on all three summands (raw 1169 / registry 16 / split 13) — the bare
  attack resolves nothing, and no id-map entry carries an `attack` key
* `BUILT.trainer` **109**, `BUILT.specialEnergy` **8** — `category = 'Pokemon'`
* `units` **2383**
* `ABILITY_D1_COLUMNS.effect` **0** (L8376) — `effect IS NULL` on all three
* the attack-gate identity literal **13** (L8436) — 261 − 248 = 13 ✅
* `MATCH_RECORD_VERSION` **20** — no new field, event, prompt kind, stage or `TriggerTiming`
* `REVEALING` **29**, `NOT_REVEALING` **15**, `classified.size` **44**, `swept.size` **103**
  (`revealClause.test.ts`) — the sweep keys on `searchOps(id).length > 0` and this program has none
* `DROPPED` **2** (`legalNonAttackPrograms.test.ts` L2127) — Magneton was never a `DROPPED` row,
  only prose
* `gatesFound` **13** (`attackIndexGate.test.ts`) — no `attackIndex` gate
* `inRows` **29** (censusAtHead L5740) — counts ATTACK printings only. ⚠️ UNIT, D341's lesson
* row 9's `attack` array and `printings(row 9) = 2` (L3088) — `printings()` is attack-only
* row 9 `effectIds` **5** — Powerglass ×2 refused (needs `endOfTurn`), Reboot Pod ×1 and
  Glass Trumpet ×2 are DEAD DATUM
* the three OTHER `LANDED` tables — `ownerPrefix.test.ts`, `ownerTargetOps.test.ts`,
  `registryOnlyPrograms.test.ts`. **`LANDED` is FOUR figures in four files, not one.**
* `catalogManifest` — `svp`/`sv08` are not among the six manifest sets, so the suite drives a
  LOCAL `cardPool` (D275) and owes **no** `fix-*` key
* `programWalk.test.ts` `enumeratedTotal > 900` — a floor, not a count

## REFUSED, with the measurement

* **Lycanroc `sv09-085`/`sv09-166` (2)** — *"up to 2 **Spiky Energy** cards"*, a card by NAME.
  `attachEnergyFrom` narrows by `energyType`/`anyEnergy`; D246 refused it a `CardFilter`.
  Unchanged, not re-opened.
* **Powerglass `sv06.5-063`/`-097` (2)** — needs a new `endOfTurn` `TriggerTiming` plus a Tool
  hook (`grep -rn "endOfTurn" packages/engine/src` — ZERO HITS at this head, re-run).
* **Reboot Pod `sv05-158` (1)** / **Glass Trumpet `sv07-135`/`sv08.5-110` (2)** — DEAD DATUM
  (Future / Tera have no supply-side column). Recorded, not built.
* **Infernape ×3, Steven's Metagross ex ×1, Metang ×2, Marnie's Grimmsnarl ex ×1** — the other
  10 legal printings of the same clause. Each owes a SECOND mechanism; Magneton owes none.
* **Festival Grounds** — deleted from the work order for the sixth slice running.
* **`attachEnergyFrom` reaching `attachCards`** — refused on the engine's own stated grounds.

## SCORE TARGET

D345 scored 31/14 with **ten misses in one defect**. Every rung above was found by grepping the
FIGURE NAME across the whole test tree, not by naming the figure.
