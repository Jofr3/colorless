# D344 — PREDICTION GRADE (graded against the tree, before the sweep totals)

## HITS (23)

**Design/price — every clause held:**
1. Deduction Kit genuinely unbuilt (11 prose sites, zero program) ✅
2. Family census 15 printings / 11 legal / 7 sentences ✅ (re-derived, confirmed to the digit)
3. Column split `effect` 8/6 · `attacks_json` 7/5 · `abilities_json` 0/0 ✅
4. "five of seven built" was WRONG — it is FOUR ✅ (predicted before building; confirmed by counting the registry)
5. `optional` refused because a `confirm` park carries no candidates and the look precedes the `or` ✅
6. No new prompt kind / choice kind / `validateChoice` arm / `redactPrompt` arm / `ONE_PER_KIND` row ✅
7. `applyChoice` needs NO arm — both splices are the identity on an empty answer ✅ (verified in the driven suite)
8. `otherwise` must be a FLAT `EffectOp[]` or `walkProgram` cannot see it ✅ (the carrier pin proved it by going red)
9. The M1 guard needs no change — `top.length = min(n, deck.length)` ✅ (pinned by the 1-card and 2-card rungs)
10. `MATCH_RECORD_VERSION` stays 20 ✅

**Census figures MOVED, predicted correctly:**
11. `BUILT.trainer` 108 → **109** ✅
12. `built` 1566 → **1567** ✅
13. residue 817 → **816** ✅
14. `raw.length` 675 → **676** ✅ (including "+1, no `fix-*` key, local cardPool")
15. `nonAttackRegistryIds` 531 → **532** ✅
16. the four-list pool closure 531 → **532** ✅ (D342's *named* miss, inherited and paid)
17. `CENSUS_TRAINER_LEGAL` +1 ✅
18. `TRAINER_TERMS` 57 → **58** ✅
19. census row 11 `effectIds` → **[]**, the row's trainer column CLOSES ✅
20. `programWalk` carrier pin gains `["reorderTop", ["otherwise"]]` ✅
21. `programWalk` `missed` pin gains `sv08-171 trainer :: bottomDeckTop` ✅
22. engineVersion 0.249.0 → **0.250.0** ✅
23. check 352 → **353** files (predicted 353; tests predicted ~7,245, actual **7,230**)

**Census figures MEASURED UNMOVED, predicted correctly (7):**
`BUILT.attack` 1198 (1169/16/13) · `BUILT.ability` 252 · `BUILT.specialEnergy` 8 ·
`unbuiltAttack` 534 · `units` 2383 · `REVEALING` 29 / `NOT_REVEALING` 15 /
`classified.size` 44 / `swept.size` 103 (the `searchOps` argument held exactly:
the population gains `sv08-171`, the SWEEP does not) · `DROPPED` 2.

## MISSES (4) — every one named

1. **`TRAINER_SUBTYPE_TALLY` (Item 27 → 28).** NOT on the predicted list. The
   prediction named `TRAINER_TERMS.length` and `BUILT.trainer` and never followed
   the +1 down into the SUBTYPE PARTITION those terms are grouped by. **This is
   D342's own named miss one rung over — a list's length, the sum it sits inside,
   and the partition of that sum by a field are THREE rungs on one printing** —
   and it is the exact class the work order warned about ("a PARTITIONED TOTAL").
2. **`byObject.size` (56 → 57).** NOT on the predicted list. The prediction
   reasoned in PRINTINGS; this line counts PROGRAM OBJECTS. **D341's lesson —
   a row's UNIT can be wrong, not just its count — met on this file's own pins.**
3. **`BUILT.ability + BUILT.trainer + BUILT.specialEnergy` (368 → 369).** NOT on
   the predicted list. A THIRD sum over the same summand, and the third miss of
   the same shape in one slice: I enumerated the summand and not the sums.
4. **The FOUR VERSION SITES.** The prediction listed `engineVersion` as a moving
   FIGURE and never enumerated its four RUNGS, so bumping `package.json` alone
   reddened **eight suites**. `legacyEnergy.test.ts` carries D343's warning about
   exactly this, written after D343 made the same mistake. **A FIGURE NAMED IS
   NOT ITS RUNGS ENUMERATED**, and this warning has now failed two slices running
   — which is evidence about the warning, not about the slices.

**Score: 23 hits / 4 misses.** All four misses are the same defect wearing two
faces: three sums keyed on a summand I did name, and one agreement-between-files
keyed on a version I did name. **Not one miss is a fact I got wrong; every one is
a rung I did not walk down from a fact I got right.**

## PREDICTIONS THAT WERE NOT TESTED
* "prose sites I expect to falsify" was written as a class, not a list, and the
  sweep found **five** (four falsified by this build, one false since D341). That
  is neither a hit nor a miss — it was not a falsifiable prediction, which is
  itself worth recording: **a prediction that names a CATEGORY cannot be graded.**
