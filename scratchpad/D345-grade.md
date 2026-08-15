# D345 — PREDICTION GRADE (written at close-out, against scratchpad/D345-prediction.md)

## HITS (predicted, and right)
1. Row choice: largest live `ROWS` residue is row 9 (10 ids) — read off the file.
2. The blocking clause is the SELF-KO, and censusing it (not the card) is the move.
3. Three-column census `effect` 0 + `abilities_json` 9/9/3 + `attacks_json` 0 = 9/9/3.
4. Magneton is NOT the cheapest member of its own family (D341's lesson, 2nd instance).
5. Dusclops + Dusknoir owe only this op — 6 legal printings, 2 sentences.
6. Not shipped: 4 prose hits, no registry row / program / id-map entry.
7. Glass Trumpet REFUSED — Tera has no supply-side datum.
8. Reboot Pod REFUSED — Future banner, same dead datum.
9. Powerglass REFUSED — needs an `endOfTurn` TriggerTiming; censused first.
10. `BUILT.ability` 252 → 258.
11. `built` 1567 → 1573.
12. residue `units - built` 816 → 810.
13. `raw.length` 676 → 682.
14. `nonAttackRegistryIds().length` 532 → 538.
15. `CENSUS_POKEMON_LEGAL` +6.
16. engine 0.250.0 → 0.251.0, FIVE sites in ONE commit.
17. `MATCH_RECORD_VERSION` STAYS 20.
18. `BUILT.attack` 1198 UNMOVED on all three summands — measured on D1.
19. `BUILT.trainer` 109 / `BUILT.specialEnergy` 8 UNMOVED — measured.
20. `units` 2383 / POPULATION UNMOVED.
21. `classified.size` 44 UNMOVED (searchOps gate).
22. `swept.size` 103 UNMOVED (same reason).
23. `REVEALING` 29 / `NOT_REVEALING` 15 / `DROPPED` 2 UNMOVED.
24. `raw.length` vs `nonAttackRegistryIds()` 0 WIDE — local `cardPool`, no `fix-*`.
25. `counterPut.test.ts` `NEAR_MISSES` had to be RE-POINTED, not deleted.
26. `effects.ts` ×2 prose enumerations stale.
27. `attackLock.test.ts` prose enumeration stale.
28. Row 9's Magneton clause becomes FALSE and needs re-pricing.
29. The D275 mutation anchor is the fifth version site.
30. Whole-corpus anchor check before the sweep (and it EARNED it: 1 ambiguous row).
31. One new `EffectOp`, no new event, no new prompt kind, no new TriggerTiming.

## MISSES — every one named
**ALL BUT THREE ARE ONE DEFECT, AND IT IS THE DEFECT THE WORK ORDER NAMED.**
"A figure named is not its rungs enumerated" (D344). I named `BUILT.ability` and
enumerated TWO of its rungs. The ability column carries EIGHT.

1. **`raw[raw.length - 1]`** — the INSERTION-ORDER rung. Not on my list, and the
   file's own comment says it has gone red on an untouched constant three times.
   I read that comment while counting the residue and did not transcribe it.
2. **`ABILITY_D1_SHAPE.printings`** 252 → 258.
3. **`ABILITY_D1_SHAPE.distinctNames`** 115 → 117.
4. **`ABILITY_D1_COLUMNS.abilitiesJson`** 239 → 245.
5. **`ABILITY_D1_COLUMNS.attacksJson`** 252 → 258.
6. **`ABILITY_NAME_TERMS`** — +2 rows, and it is the table the four above close over.
7. **`groups.length`** (program objects) 104 → 106.
8. **`pairs.size`** (the (name, object) JOIN) 117 → 119, plus its
   `distinctNames + splits` derivation.
9. **The `BUILT.ability` DECOMPOSITION tie** — two new terms. The tie whose entire
   purpose is to redden when this column moves, and I did not list it.
10. **`BUILT.ability + BUILT.trainer + BUILT.specialEnergy`** 369 → 375.
11. **`LANDED` — A UNIT ERROR, NOT A COUNT ERROR.** I predicted "+6 rows"; it is
    **+2 rows carrying +6 legal**. D341's lesson about a backlog row's UNIT,
    reproduced inside my own prediction file.
12. **The four-list closure's BASELINE** — I wrote 531 → 537 off the work order's
    figure; it is 532 → 538. I re-derived every other figure and inherited this one.
13. **UNPREDICTED, AND THE BIGGEST THING IN THE SLICE:** a live `programPlayable`
    defect. I predicted a two-file engine diff and the row surfaced a THIRD file.
14. **UNPREDICTED (my own defect):** the HP-aura case was authored against an
    invented fixture carrying Ability TEXT and no program — vacuous until the
    attribution question was asked of it.

**GRADE: 31 hits, 14 misses.** Ten of the fourteen are the same defect.
