# D345 — PREDICTION, written BEFORE building (head 7f2b0d9)

## THE ROW, AND HOW THE METHOD LED THERE
1. Largest live `ROWS` residue in `censusAtHead.test.ts`: **row 9**
   (attach from the DISCARD PILE), 5 `abilityIds` + 5 `effectIds` = **10**.
   (10/9/3/0/0/0/0/4 across the eight rows; row 12 is 4, row 10 is 5.)
2. Censused the SENTENCE its `abilityIds` print, not the card. Magneton
   "Overvolt Discharge" is blocked (per the row's own note) on
   *"If you use this Ability, this Pokémon is Knocked Out."* — a SELF-KO COST.
   Three-column census on remote D1 `luminous`:
   `effect` 0/0/0 + `abilities_json` **9 printings / 9 legal / 3 sentences**
   + `attacks_json` 0/0/0 = **9 / 9 / 3**.
3. Magneton is NOT the cheapest member (D341's lesson). The three sentences are
   Dusclops "Cursed Blast" (3 legal), Dusknoir "Cursed Blast" (3 legal),
   Magneton (3 legal). Dusclops/Dusknoir need `damageChosen{opponentAny}`
   (SHIPPED) + the self-KO; Magneton needs the self-KO **plus** an
   "in any way you like" DISTRIBUTION of up to 3 Energy across several {L}
   bodies, which `attachEnergyFrom` cannot spell.
4. Not shipped: `grep -rn "Cursed Blast|sv06.5-019|sv06.5-020|sv08.5-036|sv08.5-037"`
   → 4 hits, ALL PROSE (attackLock.test.ts, effects.ts ×2, counterPut.test.ts).
   No registry row, no program, no id-map entry. `sv08.5-036`/`-037` appear
   NOWHERE — the prose enumerations are already stale by 2 printings.

**BUILD: Dusclops + Dusknoir "Cursed Blast" — 6 legal printings, 2 sentences,
ONE new `EffectOp` (`knockOutSelf`).**

## WHAT I REFUSE
* **Magneton ×3** — two mechanisms, only one of them this slice's.
* **Glass Trumpet `sv07-135`/`sv08.5-110` (2 legal)** — Tera has NO supply-side
  datum (registry.ts §Briar). Permanent floor.
* **Reboot Pod `sv05-158` (1 legal)** — Future banner, same dead datum.
* **Powerglass `sv06.5-063`/`-097` (2 legal)** — needs a new `endOfTurn`
  `TriggerTiming` + a Tool hook in the turn machine. Censused: "the end of your
  turn" is `effect` 10/4/4 + `abilities` 5/0/3 + `attacks` 0 — and 2 of the 4
  legal effect-column printings are the TM/Ignition Energy SELF-DISCARD tail, a
  different mechanism. Not one slice with this one.

## FIGURES I PREDICT WILL MOVE
| figure | from | to |
|---|---|---|
| `BUILT.ability` | 252 | **258** |
| `built` | 1567 | **1573** |
| residue `units - built` | 816 | **810** |
| `raw.length` (registryCardIds) | 676 | **682** |
| `nonAttackRegistryIds().length` | 532 | **538** |
| the four-list closure beside it | 531 | **537** |
| `CENSUS_POKEMON_LEGAL` | +6 ids | |
| `legalNonAttackPrograms` rows | +6 | |
| engine version | 0.250.0 | **0.251.0** (FIVE sites) |
| mutation corpus | 999 | 999 + my rows |
| check | 353 files / 7,230 | 354 files / more |

## FIGURES I PREDICT WILL NOT MOVE (must be MEASURED, not assumed)
* `BUILT.attack` **1198** and all three summands (1169 raw / 16 registry / 13
  split) — both cards' `attacks_json` carries an attack whose effect is absent
  (Dusclops) or is a retreat lock already refused (Dusknoir "Shadow Bind"),
  and neither id gains an `attack` key. **VERIFY ON D1.**
* `BUILT.trainer` 109, `BUILT.specialEnergy` 8.
* `unbuiltAttack` 534, `raw` POPULATION, `units` 2383.
* `TRAINER_TERMS` 58.
* `classified.size` 44 / `swept.size` 103 — `swept` filters on
  `searchOps(id).length > 0` and Cursed Blast has no search op. **0 wide** on
  `raw.length` vs `nonAttackRegistryIds()`: 6 real catalog ids, NO `fix-*` key,
  because the suite drives a LOCAL `cardPool` (D275's idiom). `sv08.5` is not
  among `catalogManifest`'s six sets, so a shared-pool body would have cost a
  `fix-*` key AND could have moved `swept.size`.
* `REVEALING` 29 / `NOT_REVEALING` 15 / `DROPPED` 2.
* **`MATCH_RECORD_VERSION` STAYS 20** — `knockOutSelf` is a field-free op that
  never parks, so no `PendingStage` inhabitant is added and no persisted union
  gains a member; the KO is rendered through the EXISTING `KNOCKED_OUT` event.

## RUNGS KEYED ON SOMETHING MY WORK INVALIDATES (the D344 defect)
1. **`counterPut.test.ts`'s `NEAR_MISSES`** holds Dusknoir's sentence verbatim
   with a STANDING NOTE: *"when a later slice maps one of these, RE-POINT the
   entry at another still-unmapped clause — never delete it."* My row maps it.
   **RE-POINT, do not delete.**
2. **`counterPut.test.ts`'s prose** naming Dusknoir `sv06.5-020` as unmapped.
3. **`effects.ts:6452`** — "the only printing of that noun phrase is an ABILITY
   (Dusclops sv06.5-019/-069 and Dusknoir sv06.5-020/-070)". The REFUSAL stays
   true (the deriver still returns null); the ENUMERATION is 2 short.
4. **`effects.ts:6318`** — same shape, Dusknoir `sv06.5-020`.
5. **`attackLock.test.ts:198`** — same enumeration, same 2-printing shortfall.
6. **`scripts/mutation/mutants.ts` `D275-engine-version-drifts-again`** — the
   FIFTH version site. Re-anchor IN THE SAME COMMIT as the bump.
7. **The whole-corpus anchor check BEFORE the sweep**, over all rows, not mine.
8. Row 9's own residue note in `censusAtHead.test.ts` — its Magneton clause
   ("NO op in this engine knocks out its own host; grepped") becomes FALSE.
   Re-price it to the remaining half (the distribution).
9. `docs/reference/coverage-backlog-legal.md` — grep for the same doctrine.

## PRICE (what I expect the diff to be)
* `effects.ts` — one union member `{ op: "knockOutSelf" }`.
* `interpreter.ts` — one case: resolve `sourceRef`, set `damage` to
  `effectiveMaxHp`, let `resolveMidTurnKnockOuts` do §8.1. **NO new event.**
* `registry.ts` — 2 programs, 6 id-map entries.
* `cursedBlast.test.ts` — new suite on a LOCAL `cardPool`.
* NO record bump. NO new prompt kind. NO new TriggerTiming.
