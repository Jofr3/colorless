# Simulator coverage — the MEGA EVOLUTION serie backlog (D581, 2026-10-07)

> The `me` serie's legal printings, measured against the **LOCAL D1** right after D581
> ingested it (`apps/api/.wrangler/state/v3/d1/…/8437d866….sqlite`; the remote D1 has not
> been re-ingested). Engine **0.465.0**. The `sv` serie's census is
> `coverage-backlog-legal.md`; its pool is unchanged and whole. The suite-side figures are
> `censusAtHead.test.ts`'s D581 block and `censusAttackCorpusMe.ts`.

## 🆕 D644 update (engine 0.527.0) — Y1e, rule hooks, one printing each (`MATCH_RECORD_VERSION` stays 48)

5 texts / 5 printings (`ruleHooksMeD644.test.ts`): Cinderace "Explosiveness" `me01-028` (the new `CardProgram.setupActiveFromHand` at
`setupPlaceActive` — R-EXP1 / R-EXP2), Patrat "Watchful Eye" `me04-070` (the new `PassiveEffects.countersCantMove`: the five counter-move
ops whiff, Rocket Brain / Adrena-Brain are refused — R-WEY1), Illumise "Supereffective Pheromones" `30th-004` (the new
`PassiveEffects.weaknessTimesWithNamedInPlay` at both Weakness sites — R-SPH1 / R-SPH2), Ferrothorn "Startling Drop" `me04-063` (the new
`CardProgram.opponentMillWhenMilled`, answered inside `discardDeckTop` — R-STD1 / R-STD2) and Transformation Tome `me04-083` (a second-copy
hand cost, then Ogre's Mask's swap over Basic Pokémon — R-TFT1 / R-TFT2). **Finished:** 5. **Dropped and named:** Backtrack Badge
`me05-074` (re-flipping an attack's coins needs a persisted mid-attack park).

| Column | `me` built / units (D644) | Standard pool D644 |
|---|---|---|
| Attacks | 1,038 / 1,039 | **2,770 / 2,771** |
| Abilities | 230 / 234 (+4) | **606 / 610** |
| Trainers | 182 / 183 (+1) | **446 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

1257 `me` printings fully built (1252 + 5).

## 🆕 D643 update (engine 0.526.0) — Y1a, Multi Adapter (`MATCH_RECORD_VERSION` 47 → 48)

1 text / 3 printings (`multiAdapterMeD643.test.ts`): Rotom ex ×3 "Multi Adapter" `me02-029` / `-111` / `-126` — the new
`PassiveEffects.toolCapForName` (continuous.ts `toolCapOf`, read at both `attachTool` arms and the deck attach) and the trim as a state
check (the new persisted `PendingStage` `toolTrim` and `EffectOp` `trimTools`, the owner's exact `discardTools` pick — R-MAD1 … R-MAD4).
The client steps a second Tool off the first. A v47 match record is migrated by a re-stamp. **Finished:** all 3. **Dropped:** none.

| Column | `me` built / units (D643) | Standard pool D643 |
|---|---|---|
| Attacks | 1,038 / 1,039 | **2,770 / 2,771** |
| Abilities | 226 / 234 (+3) | **602 / 610** |
| Trainers | 181 / 183 | **445 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

1252 `me` printings fully built (1249 + 3).

## 🆕 D642 update (engine 0.525.0) — Z1 + K2, the `me` Stadium rest and the watched-Active damage triggers (`MATCH_RECORD_VERSION` stays 47)

5 texts / 6 printings (`stadiumWatchedMeD642.test.ts`): Spiritomb ×2 "Spiteful Swirl" `me01-087` / `-148` and Wishiwashi "Counterattack
Grouping" `30th-022` (the new `PassiveEffects.damageAttackerWatched`, read across the damaged seat's board at the two recoil sites —
R-SSW1 / R-CAG1), Risky Ruins `me01-127` (the new `StadiumEffects.benchArrivalCounters` — R-RR1 / R-RR2), Dizzying Valley `me02-088` (the
new `StadiumEffects.confusionSurvivesStageChange` — R-DV1) and Ange Floette `me04-075` (the new `StadiumEffects.playOnlyOverStadium` and
`hpDelta.name` — R-ANF1 / R-ANF2). **Finished:** all 6. **Dropped:** none. Wishiwashi's D1 text keeps its two TAB bytes (the D612
normaliser leaves them; the key is by id).

| Column | `me` built / units (D642) | Standard pool D642 |
|---|---|---|
| Attacks | 1,038 / 1,039 | **2,770 / 2,771** |
| Abilities | 223 / 234 (+3) | **599 / 610** |
| Trainers | 181 / 183 (+3) | **445 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

1249 `me` printings fully built (1243 + 6).

## 🆕 D641 update (engine 0.524.0) — W1 + Y1b, effects the opponent answers and deck swap / reveal (`MATCH_RECORD_VERSION` stays 47)

4 texts / 7 printings (`opponentAnsweredMeD641.test.ts`): Ditto ×2 "Surprisingly Transform" `mep-106` / `30th-115` (the new
`switchWithDeckChosen` behind the coin — R-DIT1), Sizzlipede "Bug Out" `me05-009` (the new `revealDeckBottomCount` — R-BUG1), Delibird
"Pleasing Present" `me04-018` (two capped `attachFromHand`, the opponent's first and answered by them — R-PP1) and Lt. Surge's Bargain ×3
`me01-120` / `-170` / `-185` (the opponent answers an `optional`; the new `eachPlayerTakesPrize` — R-LSB1). **Finished:** all 7.
**Dropped:** none.

| Column | `me` built / units (D641) | Standard pool D641 |
|---|---|---|
| Attacks | 1,038 / 1,039 (+4) | **2,770 / 2,771** |
| Abilities | 220 / 234 | **596 / 610** |
| Trainers | 178 / 183 (+3) | **442 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

1243 `me` printings fully built (1236 + 7).

## 🆕 D640 update (engine 0.523.0) — Overwriting Bolt and Celebration (`MATCH_RECORD_VERSION` 46 → 47)

2 texts / 3 printings (`prizeOverwriteMeD640.test.ts`), reader rows: Pikachu "Overwriting Bolt" `30th-040` (D552's retype with the new
`asTimesTwo`, read as a {L}×2 rewrite — R-OWB1) and Gholdengo ×2 "Celebration" `30th-108` / `-142` (`takePrize { count: 2,
thenShuffleHand }` and the new post-Prize stage `shuffleHandIntoDeck` — R-CEL1). A v46 match record is migrated by a re-stamp.
**Finished:** all 3. **Not taken (named):** Rotom ex ×3 "Multi Adapter" `me02-029` / `-111` / `-126` (Y1a) — owes 47 → 48 on its own. [🆕🆕🆕 D643 (D539): Multi Adapter BUILT at D643 (47 → 48).]

| Column | `me` built / units (D640) | Standard pool D640 |
|---|---|---|
| Attacks | 1,034 / 1,039 (+3) | **2,766 / 2,771** |
| Abilities | 220 / 234 | **596 / 610** |
| Trainers | 175 / 183 | **439 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

1236 `me` printings fully built (1233 + 3).

## 🆕 D639 update (engine 0.522.0) — K3 + R1, KO-by-this-attack consequents and the KO sweep (`MATCH_RECORD_VERSION` stays 46)

3 texts / 6 printings (`koSweepMeD639.test.ts`), reader rows: Shadowy Side Kick ×2 `me01-080` / `-146` = Golisopod "Critical Slash"
`me04-026` (the new `opponentKnockedOutByDamage` gate over the shipped effects shield — R-SSK1), Unown "Mysterious Signal" `30th-072`
(the new `bountyThisAttack`, a this-turn `koBounty` — R-MSG1) and Yveltal ex ×2 "Soul Destroyer" `me03-053` / `-105` (the new
`knockOutEach` — R-SDS1). **Finished:** all 6. **Dropped and named:** Gholdengo ×2 "Celebration" `30th-108` / `-142` (its "If you do" [🆕🆕🆕 D640 (D539): Celebration BUILT at D640 (MRV 46 → 47).]
after the queued `takePrizes` stage needs a new post-Prize stage: persisted state).

| Column | `me` built / units (D639) | Standard pool D639 |
|---|---|---|
| Attacks | 1,031 / 1,039 (+6) | **2,763 / 2,771** |
| Abilities | 220 / 234 | **596 / 610** |
| Trainers | 175 / 183 | **439 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1233** (1227 + 6).

## 🆕 D638 update (engine 0.521.0) — X1, copy / borrowed effects (`MATCH_RECORD_VERSION` stays 46)

3 texts / 6 printings (`copyBorrowedMeD638.test.ts`) on the shipped copy family: Mew ex ×3 "Memory Helix" `30th-066` / `-152` / `-158`
(the new `PassiveEffects.memoryHelix`, a fourth `attackMenuOf` section: the Benched Pokémon's printed attacks, copy-family attacks
excluded — R-MH1 / R-MH2), Thievul ×2 "Skill Thief" `me05-054` / `-092` (`deriveAttackCopy`'s new in-play kind over the opponent's Active
and Bench, behind an empty hand — R-SKT1; parked as the new `useInPlayAttackAs`) and Ninetales "Supernatural Shapeshifter" `me01-020`
(the new `useMilledSupporterEffect`, Look-Alike Show's filter over the milled card — R-NS1). **Finished:** all 6. **Dropped:** none.

| Column | `me` built / units (D638) | Standard pool D638 |
|---|---|---|
| Attacks | 1,025 / 1,039 (+3) | **2,757 / 2,771** |
| Abilities | 220 / 234 (+3) | **596 / 610** |
| Trainers | 175 / 183 | **439 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1227** (1221 + 6).

## 🆕 D637 update (engine 0.520.0) — the four `me` Antique Fossils (`MATCH_RECORD_VERSION` 45 → 46)

4 texts / 4 printings (`antiqueFossilsMeD637.test.ts`, `fossilsMigrationD637.test.ts`), each a new `FOSSIL_IDS` id on D576's
`playAsPokemon`: Antique Jaw Fossil `me03-068` "Intimidating Jaw" (Intimidating Fang's debuff), Antique Sail Fossil `me03-069` "Protective
Sail" (the new Supporter-only holder shield `preventSupporterEffects`), Antique Armor Fossil `me05-072` "Protective Armor"
(`seatDamageReductionAfterWR` with the new `sourceActive` rider) and Antique Skull Fossil `me05-073` "Spiny Skull" (Counterattack Quills'
recoil). A v45 match record is MIGRATED by a re-stamp (no D1 read). Fossil Quarry now offers them. **Finished:** all 4 — F1 is complete.
**Not taken (named):** Rotom ex ×3 "Multi Adapter" (Y1a — every Tool reader, the two-Tool cap and the forced discard wherever the [🆕🆕🆕 D640 (D539): Multi Adapter still unbuilt, owes 47 → 48.] [🆕🆕🆕 D643 (D539): Multi Adapter BUILT at D643 (47 → 48).]
Ability goes away; its own bump) and Overwriting Bolt `30th-040` — each owes 46 → 47. [🆕🆕🆕 D640 (D539): Overwriting Bolt BUILT at D640 (MRV 46 → 47).]

| Column | `me` built / units (D637) | Standard pool D637 |
|---|---|---|
| Attacks | 1,022 / 1,039 | **2,754 / 2,771** |
| Abilities | 217 / 234 | **593 / 610** |
| Trainers | 175 / 183 (+4) | **439 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1221** (1217 + 4).

## 🆕 D636 update (engine 0.519.0) — L1 + Clawitzer, the next-turn opponent locks (`MATCH_RECORD_VERSION` 44 → 45)

6 texts / 7 printings (`nextTurnLocksD636.test.ts`, `lockKeysMigrationD636.test.ts`): Trevenant "Cursed Roots" `me04-039` (Glimmora's
shipped bar), Pachirisu "Electrified Incisors" `me01-051` (the new `HandAttachMark.counters`, R-EIC1), Octillery "Jet of Ink" `me04-017`
(the new two-coin stamp `attackTwoFlipLockTurn`, R-JOI1), Seismitoad "Quaking Fist" `30th-084` (the new `PlayerSide.trainerFlipLockTurn`,
a coin at every Trainer play from hand, R-QF1), Chi-Yu "Scorching Earth" `me01-031` (the new `opponentStadiumInPlay` and a stamped
`Stadium` bar, R-SCE1) and Clawitzer "Fall Back to Reload" ×2 `me01-038` / `-141` (the new `InPlayPokemon.benchedTurn`, R-FBR1). A v44
match record is MIGRATED (no D1 read). **Finished:** all 7. **Not taken (named):** Rotom ex ×3 "Multi Adapter" (Y1a: a two-Tool cap and a [🆕🆕🆕 D640 (D539): Multi Adapter still unbuilt, owes 47 → 48.] [🆕🆕🆕 D643 (D539): Multi Adapter BUILT at D643 (47 → 48).]
forced Tool discard when the Ability goes away), Overwriting Bolt `30th-040` and the four `me` Antique Fossils — each owes a later bump [🆕🆕🆕 D640 (D539): Overwriting Bolt BUILT at D640 (MRV 46 → 47).]
(45 → 46). [🆕🆕🆕 D637 (D539): the fossils BUILT at D637; Multi Adapter and Overwriting Bolt now owe 46 → 47.] [🆕🆕🆕 D640 (D539): Overwriting Bolt BUILT at D640 (MRV 46 → 47); Multi Adapter still unbuilt, owes 47 → 48.] [🆕🆕🆕 D643 (D539): Multi Adapter BUILT at D643 (47 → 48).]

| Column | `me` built / units (D636) | Standard pool D636 |
|---|---|---|
| Attacks | 1,022 / 1,039 (+5) | **2,754 / 2,771** |
| Abilities | 217 / 234 (+2) | **593 / 610** |
| Trainers | 171 / 183 | **435 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1217** (1210 + 7).

## 🆕 D635 update (engine 0.518.0) — F1, the Antique archetype, its unpersisted half (`MATCH_RECORD_VERSION` stays 44)

2 texts / 2 printings (`fossilQuarryD635.test.ts`): Fossil Quarry `me05-076` (a Stadium on the new `itemNameContaining`; only a fossil with
an in-play face is benched, R-FQ1 UNRULED) and Relicanth "Fossil Beatdown" `me05-017` (the fifteenth `IN_PLAY_BODY_NOUNS` key).
**Finished:** both. **Dropped and named:** Antique Jaw Fossil `me03-068`, Antique Sail Fossil `me03-069` and Antique Skull Fossil
`me05-073` — a new fossil id in a stack owes MRV 44 → 45 (D576's twelfth position; they can ride L1's bump [🆕🆕🆕 D636 (D539): they did not — beyond D636's brief; now 45 → 46]; Sail also needs a
Supporter-only holder shield) — and Antique Armor Fossil `me05-072` (that, plus a source-Active rider). Fossil Quarry does not offer
them until they are built. [🆕🆕🆕 D637 (D539): all four BUILT at D637 (MRV 45 → 46); Fossil Quarry offers them.]

| Column | `me` built / units (D635) | Standard pool D635 |
|---|---|---|
| Attacks | 1,017 / 1,039 (+1) | **2,749 / 2,771** |
| Abilities | 215 / 234 | **591 / 610** |
| Trainers | 171 / 183 (+1) | **435 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1210** (1208 + 2).

## 🆕 D634 update (engine 0.517.0) — C1, the coin rest (`MATCH_RECORD_VERSION` stays 44)

7 texts / 8 printings (`coinRestMeD634.test.ts`): Bewear "Hyper Lariat" `me01-112` (the new `bonusOnAllHeads`), Bombirdier
"Challenging Delivery" `me05-071` (an arm 46b row; "a Pokémon" benches a Basic only, D613), Gholdengo "All-You-Can-Grab" `me01-099`,
Snorlax "Gormandizer" `me03-063` and Pikachu "Charge-Up Dash" `30th-042` (the new `deckUpToHeads`: heads as the search's max; 0 heads
does nothing, R-UTH1 UNRULED), Shiftry "Reversing Gust" `me01-015` (an arm 46b row on `returnBenched.includeActive`, opponent side)
and Watchog "Snap Inspection" ×2 `me04-071` / `-097` (per heads, `bottomFromOpponentHand` at the new `dest: "deck"`). **Finished:**
all 8. **Dropped:** none. Octillery "Jet of Ink" `me04-017` (D595's seventh drop) was not in C1 and stays unbuilt. [🆕🆕🆕 D636 (D539): BUILT at D636 (L1).]

| Column | `me` built / units (D634) | Standard pool D634 |
|---|---|---|
| Attacks | 1,016 / 1,039 (+8) | **2,748 / 2,771** |
| Abilities | 215 / 234 | **591 / 610** |
| Trainers | 170 / 183 | **434 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1208** (1200 + 8).

## 🆕 D633 update (engine 0.516.0) — O1, attack odds and ends (`MATCH_RECORD_VERSION` stays 44)

5 texts / 7 printings (`attackOddsMeD633.test.ts`): Slowpoke "All-You-Can-Yeet" `me05-029` and Team Rocket's Honchkrow "Rocket
Feathers" `me02.5-127` (D617's uncapped declinable hand discard), Doublade "Weaponized Swords" ×3 `mep-067`, `me03-057` / `-098` (the new
`revealFromHand` op, `chooseCards` `dest: "reveal"`, the `HAND_CARDS_REVEALED` event), Pawmot "Voltaic Fist" `me02-034` (one confirm over
the self-damage and the Paralysis) and Lugia "Elemental Blast" `30th-121` (three typed discards on the new `discardEnergy.reserve`,
R-EB1 UNRULED). **Finished:** all 7. **Dropped and named:** Pikachu "Overwriting Bolt" `30th-040` — *"(Apply Weakness as ×2.)"* gives a [🆕🆕🆕 D640 (D539): Overwriting Bolt BUILT at D640 (MRV 46 → 47).]
Weakness to a body that prints none, which needs a new field on the persisted `weaknessRetype` (an MRV bump; it can ride L1's).

| Column | `me` built / units (D633) | Standard pool D633 |
|---|---|---|
| Attacks | 1,008 / 1,039 (+7) | **2,740 / 2,771** |
| Abilities | 215 / 234 | **591 / 610** |
| Trainers | 170 / 183 | **434 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1200** (1193 + 7).

## 🆕 D632 update (engine 0.515.0) — D1, Damp (`MATCH_RECORD_VERSION` stays 44)

2 texts / 5 printings (`dampD632.test.ts`): Psyduck `me02.5-039` / `-226` and Golduck `me02.5-040` ("lose any Ability that requires the
Pokémon using it to Knock Out itself"), Psyduck `mep-007` and Golduck `mep-008` ("lose all Abilities that require those Pokémon to be
Knocked Out", read as the same class, R-DMP1). One new `disableAbilities` narrowing, `selfKnockOutAbility`; the class over both corpora is
Cursed Blast ×2 texts and Overvolt Discharge (9 legal printings; Forretress ex "Exploding Energy" ×4 is not legal). **Finished:** all 5.
**Dropped:** none.

| Column | `me` built / units (D632) | Standard pool D632 |
|---|---|---|
| Attacks | 1,001 / 1,039 | **2,733 / 2,771** |
| Abilities | 215 / 234 (+5) | **591 / 610** |
| Trainers | 170 / 183 | **434 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1193** (1188 + 5).

## 🆕 D631 update (engine 0.514.0) — P1, the rest of the passive modifiers (`MATCH_RECORD_VERSION` stays 44)

6 texts / 9 printings (`passiveRestMeD631.test.ts`): Bastiodon ×3 "Ancient Bulwark" `mep-085` / `me05-062` / `-093` (a benched holder's side
shield from attackers with 2 or less Energy, R-AB1), Decidueye ex ×2 "Sniper's Eye" `me03-012` / `-100` (every {C} ignored at an opposing
hand of exactly 4, R-SNE1), Kingambit "Supreme Overlord" `me02.5-148` (+30 before W/R per Prize taken), Garbodor "Gloomy Garbage"
`me04-057` (−20 before W/R off a Tool-carrying opposing Active, R-GG1), Yveltal "Life-Locked" `30th-100` (a heal lock at every heal site, R-LL1)
and Snorlax "Good Sleep" `30th-119` (a Checkup heal on the new `yourActiveAsleep`, R-GS1). **Finished:** all 9. **Dropped:** none.

| Column | `me` built / units (D631) | Standard pool D631 |
|---|---|---|
| Attacks | 1,001 / 1,039 | **2,733 / 2,771** |
| Abilities | 210 / 234 (+9) | **586 / 610** |
| Trainers | 170 / 183 | **434 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1188** (1179 + 9).

## 🆕 D630 update (engine 0.513.0) — M1, the persisted-record bundle (`MATCH_RECORD_VERSION` 43 → 44)

8 texts / 13 `me` printings (`persistedRecordsMeD630.test.ts`): Mega Heracross ex ×2 "Juggernaut Horn" `me02-004` / `-108` and Lycanroc ×2
"Counter" `30th-085` / `-138` (the NEW `InPlayPokemon.attackDamageTaken`, R-JH1), Heatran "Lava Wall" `me05-007`, Manectric ×2 "Flashing
Barrier" `me05-024` / `-089` and Deoxys "Psy Protection" `me04-033` (the NEW `AttackerClass` members `burned` / `evolution` / `hasAbility`,
R-LVW1, R-PSY1), Bronzong "Metal Block" `me05-064` (`DamageReduction.fromClass`), Iron Defender ×2 `me01-118` / `me05-110` (the summed
`sideDamageReduction` list, R-ID1), Okidogi "Settle the Score" `me02.5-122` (the NEW `PlayerSide.prizesTakenOnTurn`, R-STS1) and Mabosstiff
"Plunging Headbutt" `me05-058` (the NEW op `exposeSelf`, R-PH1). A v43 match record is MIGRATED (no D1 read). **Finished:** all 13. **Not
taken:** L1 (Cursed Roots `me04-039`, Electrified Incisors `me01-051`, Jet of Ink `me04-017`, Quaking Fist `30th-084`, Scorching Earth
`me01-031`) — the next MRV step (44 → 45). [🆕🆕🆕 D636 (D539): BUILT at D636, which paid 44 → 45.]

| Column | `me` built / units (D630) | Standard pool D630 |
|---|---|---|
| Attacks | 1,001 / 1,039 (+11) | **2,733 / 2,771** |
| Abilities | 201 / 234 | **577 / 610** |
| Trainers | 170 / 183 (+2) | **434 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1179** (1166 + 13).

## 🆕 D629 update (engine 0.512.0) — S1, the rest of the snipe / spread wording (`MATCH_RECORD_VERSION` stays 43)

7 texts / 7 printings (`snipeSpreadRestMeD629.test.ts`): Genesect "Bug's Cannon" `me02-008` and Seaking "Hydro Jet" `me05-014` (the NEW
`damageChosen.perTypedEnergyOnSelf`), Pikachu "Lightning Crash" `30th-051` (a typed discard-all), Coalossal "Tar Cannon" `me02.5-120` (a
does-nothing requirement printed second, `ATTACK_DOES_NOTHING_SECOND`), Frosmoth "Chilling Wings" `me01-043` and Ferrothorn "Kaboom Needles"
`30th-104` (the compound break after `.)`), Mismagius "Assassin's Magic" `me02.5-086` (a clause-gated Benched placement). **Finished:** all
7. **Dropped and named:** Deoxys "Psyspear" `me04-032` (its gate reads the declared attack's cost, which no `BoardCondition` or the effect
context carries).

| Column | `me` built / units (D629) | Standard pool D629 |
|---|---|---|
| Attacks | 990 / 1,039 (+7) | **2,722 / 2,771** |
| Abilities | 201 / 234 | **577 / 610** |
| Trainers | 168 / 183 | **432 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1166** (1159 + 7).

## 🆕 D628 update (engine 0.511.0) — A1, the rest of the on-bench / on-move Abilities (`MATCH_RECORD_VERSION` stays 43)

3 texts / 5 `me` printings (`onBenchMoveMeD628.test.ts`): Meowth ex "Last-Ditch Catch" ×3 `me03-062` / `-107` / `-121` (an
`onPlayToBench` trigger on `TUCK_TAIL`, behind a confirm; the name lock read by `runBoardTrigger`; R-LDC1), Latios "Lustrous Assist"
`me01-101` (the NEW `BoardCondition` `yourActiveNamed` beside `yourActivePromotedThisTurn`; R-LSA1) and Larry's Komala "Lethargic
Charge" `me02.5-175` (`attachFromHand` with the NEW `one` and `activeOnly`; R-LGC1). **Finished:** all 5. **Dropped and named:** Clawitzer
"Fall Back to Reload" ×2 `me01-038` / `-141` (a hand-attach choice inside the non-parking Active→Bench self sweep, or a persisted
moved-to-Bench stamp) [🆕🆕🆕 D636 (D539): BUILT at D636 on the persisted stamp `benchedTurn`]. Also closed: finding 0b (the deck builder's Basic Energy test is the engine's).

| Column | `me` built / units (D628) | Standard pool D628 |
|---|---|---|
| Attacks | 983 / 1,039 | **2,715 / 2,771** |
| Abilities | 201 / 234 (+5) | **577 / 610** |
| Trainers | 168 / 183 | **432 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1159** (1154 + 5).

## 🆕 D627 update (engine 0.510.0) — H1, the Hide 'n' Sneak archetype (`MATCH_RECORD_VERSION` stays 43)

5 texts / 8 `me` printings / 10 units (`hideNSneakMeD627.test.ts`): Hide 'n' Sneak ×4 (Poltchageist `me05-005`, Sinistcha `me05-006`, Shuppet
`me05-033`, Banette `me05-034`) = one new object, `passive { preventAttackEffects, preventAbilityEffects }`; Dhelmise "Vengeful Anchor" ×3
`mep-084`, `me05-039` / `-091` (+140 behind the NEW `BoardCondition` `yourDiscardPokemonWithAbilityNamedAtLeast` at 4), Sinistcha "Matcha
Spin" (the member at 6 around the counter fold), Poltchageist "Furtive Drop" (the singular put on the Active) and Spiritomb "Spiritual End"
`me05-035` (the member at 13 around D530's per-counter placement on 2 picks: the quadruple). Two UNRULED readings: R-HNS1, R-SPE1.
**Finished:** all 8. WP17 is closed.

| Column | `me` built / units (D627) | Standard pool D627 |
|---|---|---|
| Attacks | 983 / 1,039 (+6) | **2,715 / 2,771** |
| Abilities | 196 / 234 (+4) | **572 / 610** |
| Trainers | 168 / 183 | **432 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1154** (1146 + 8).

## 🆕 D626 update (engine 0.509.0) — K1, the rest of the KO / damaged triggers (`MATCH_RECORD_VERSION` stays 43)

4 texts / 8 `me` printings on four new objects (`koTriggerRestMeD626.test.ts`): Flygon "Sandy Flapping" ×3 `mep-016`, `me02-053` /
`-101` (an `onEvolve` row and an `onKnockOut` row behind `byOpponentAttack` and `activeOnly`, now read for an on-KO program; each mills
the opponent 2 behind a confirm; R-SF1), Miraidon "Photon Cord" ×2 `mep-082`, `me05-028` (the NEW `onSelfActiveKnockedOut` on the
`koToolTrigger` stage, before the Knock Out discards the stack; R-PHC1), Gengar ex "Fainting Spell" ×2 `30th-090` / `-154` (the NEW
`koAttackerOnCoinFlip`: heads Knocks Out the Attacking Pokémon in the same batch, through the §11 funnel; R-FS1) and Adversity Policy
`me04-074` (an `onDamagedByAttack` Tool behind the NEW `BoardCondition` `yourActiveWeakToOpponentActiveType`; R-AP1). **Finished:**
all 8. **Out of scope (K2, named):** Spiritomb "Spiteful Swirl" ×2 and Wishiwashi "Counterattack Grouping" [🆕🆕🆕 D642 (D539): Spiteful Swirl, Counterattack Grouping BUILT at D642 (K2).] (a watched Active's damage
moment).

| Column | `me` built / units (D626) | Standard pool D626 |
|---|---|---|
| Attacks | 977 / 1,039 | **2,709 / 2,771** |
| Abilities | 192 / 234 (+7) | **568 / 610** |
| Trainers | 168 / 183 (+1) | **432 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1146** (1138 + 8).

## 🆕 D625 update (engine 0.508.0) — T1, the rest of the `me` Trainers, plus the open docs findings (`MATCH_RECORD_VERSION` stays 43)

7 texts / 13 `me` printings on seven new Trainer objects (`trainersMeD625.test.ts`): Special Red Card ×2 `me04-082` / `-113` (Iono's
`handRefresh` on the opponent behind `opponentPrizesRemaining [0..3]`, R-SRC1), Jumbo Ice Cream ×2 `me02-091` / `me04-109` (`heal`
80 behind `yourActiveEnergyAtLeast 3`, R-JIC1), Dark Bell ×2 `me05-075` / `-106` (two `conditionGate`s with an empty `then`, R-DB1),
Wally's Compassion ×3 `me01-132` / `-176` / `-186` (`healChosen` over `megaEvolutionEx` with the NEW `energyToHandFromHealed`, R-WC1),
Blowtorch ×2 `me02-086` / `-117` (a Basic {R} payment, then the NEW `chooseOneOffered` over Tool / Special Energy / Stadium, R-BT1),
Great Haul Net `me04-078` (two deck retrievals, one shuffle, R-GHN1) and Strange Timepiece `me01-128` (`devolveChosen` on the own side
with the NEW `whose` / `pokemonType` / `depth`, the `turnPlayed` stamp, R-ST1). **Finished:** all 13. No text dropped.

| Column | `me` built / units (D625) | Standard pool D625 |
|---|---|---|
| Attacks | 977 / 1,039 | **2,709 / 2,771** |
| Abilities | 185 / 234 | **561 / 610** |
| Trainers | 167 / 183 (+13) | **431 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1138** (1125 + 13).

## 🆕 D624 update (engine 0.507.0) — WP31c, the rest of the deck / hand / discard / Energy misc (`MATCH_RECORD_VERSION` stays 43)

5 texts / 7 `me` printings, readers only (`deckHandMiscMeD624.test.ts`): Dedenne "Tail Generator" ×2 `me03-029` / `-093`
(`attachFromDiscard` at the NEW `max: "opponentEnergyInPlay"`), Furfrou "Hand Trim" `me03-067` (`randomFromOpponentHand` with the NEW
`untilHandSize`), Morpeko "Select a Snack" ×2 `30th-061` / `-135` (Explorer's Guidance's `lookAtTopN`, R-SAS1 UNRULED), Shaymin "Send
Flowers" `me03-003` (`attachFromDeck` of any Energy onto a Benched {G} body) and Fletchling "Chirp" `me03-066` (the NEW `CardFilter`
`pokemonWithResistance`). **Finished:** all 7. **Dropped and named:** Lugia "Elemental Blast" `30th-121` (a matched multi-type discard) [🆕🆕🆕 D633 (D539): BUILT at D633 (O1)],
Delibird "Pleasing Present" `me04-018` (an attach answered by the opponent first) [🆕🆕🆕 D641 (D539): BUILT at D641 (W1)] and Thievul "Skill Thief" ×2 `me05-054` / `-092` (a
whole-board copy source plus a hand gate). [🆕🆕🆕 D638 (D539): Skill Thief ×2 BUILT at D638 (X1)] WP31 is closed but for those three.

| Column | `me` built / units (D624) | Standard pool D624 |
|---|---|---|
| Attacks | 977 / 1,039 (+7) | **2,709 / 2,771** |
| Abilities | 185 / 234 | **561 / 610** |
| Trainers | 154 / 183 | **418 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1125** (1118 + 7).

## 🆕 D623 update (engine 0.506.0) — WP28b, the rest of the scaling count sources (`MATCH_RECORD_VERSION` stays 43)

5 texts / 7 `me` printings, readers only (`scalingCountsMeD623.test.ts`). Three NEW `DamageCountSource` members over the attacker's
Bench: Gourgeist ex `me04-041` / `-102` "Horrifying Rondo" (`damagedBenchedPokemon`), Armarouge `me05-012` / `-086` "Flame Legion"
(`benchedPokemonWithEnergy`) and Igglybuff `30th-120` "Bouncy Circle" (`benchedPokemonWithMaxHp`, R-BOC1 UNRULED). Pikachu `30th-034`
"Pika Chain" on the body-map key "Pikachu and Pikachu ex"; Kyogre `me01-034` "Riptide" on two readers (the discard count and the
retrieval + shuffle tail). **Finished:** all 7. **Dropped and named:** Doublade ×3 `mep-067`, `me03-057` / `-098` (an own-hand
partial reveal) and Okidogi `me02.5-122` (Prizes taken last turn; an MRV bump). [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
[🆕🆕🆕 D633 (D539): and Doublade ×3 BUILT at D633 (O1, the new `revealFromHand`).]

| Column | `me` built / units (D623) | Standard pool D623 |
|---|---|---|
| Attacks | 970 / 1,039 (+7) | **2,702 / 2,771** |
| Abilities | 185 / 234 | **561 / 610** |
| Trainers | 154 / 183 | **418 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1118** (1111 + 7).

## 🆕 D622 update (engine 0.505.0) — fix-up: R-AM2 retired (`MATCH_RECORD_VERSION` stays 43)

No printing moves column. The bare W/R tail now nulls Weakness and Resistance only (the NEW `damageChosen.wrOnly`): Arboliva ex "Oil
Salvo" `sv10-023` / `-207`, Flygon ex "Sonic Peridot" `sv08-106` / `-222`, Vaporeon ex "Severe Squall" `sv08.5-023` / `-149` and
Sigilyph "Telekinesis" `sv10.5w-038` / `-121` are stopped by Acerola's Mischief and every on-target prevention, and take reductions.
Iron Crown ex "Twin Shotels" (the Feint form) still passes them. The `me` column prints none of these texts. `bareTailD622.test.ts`.
The D621 table below stands.

## 🆕 D621 update (engine 0.504.0) — WP24c + WP23 (persisted side state, `MATCH_RECORD_VERSION` 42 → 43)

5 texts / 16 `me` printings (`sideStateMeD621.test.ts`). The NEW optional `SideAttackBonus.attacker`: Gladion's Final Battle ×3
`me05-077` / `-108` / `-118` (Cassiopeia's last-card gate, +80 for attackers without a Rule Box, R-GFB1 UNRULED) and Premium Power
Pro ×3 `me01-124` / `-174`, `me02.5-199` (+30 for {F} attackers, read on the in-play types; two Items stack). The NEW REQUIRED
`PlayerSide.chosenAttackShield` (op `installChosenAttackShield`): Acerola's Mischief ×4 `me01-113` / `-165` / `-183`, `me02.5-180`
(R-AM1 UNRULED: the shield follows the body to the Bench and through evolution). The NEW REQUIRED `PlayerSide.sideRetreatLock` (op
`lockSideRetreat`): Roxie's Performance ×3 `me04-081` / `-112` / `-121` (R-RP1 UNRULED: read live). Dawn ×3 `me02-087` / `-118` /
`-129` is Larry's Skill's `also` search by stage. A v42 match record is MIGRATED (two `null` side keys, no D1 read). **Finished:** all
16. **Dropped and named:** Iron Defender ×2 `me01-118` / `me05-110` — an Item whose two plays stack on `sideDamageReduction`, a
record D564 overwrites; it needs that persisted record made a summed list. WP12's four attack texts (D619) did not ride the bump. [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
Review fix: the shield is honoured against PLACED counters on a Benched body too (`placeSnipe`'s put-counter Bench arm and a
counter move's Benched destination now ask §11 of that body), so Dragapult ex "Phantom Dive" cannot put counters on it.
Second review fix: the shield ends when its body leaves play (R-AM1 made true). Known gap, R-AM2 UNRULED: an `ignoreWR` snipe or
spread from a Pokémon ex passes it — Arboliva ex "Oil Salvo", Flygon ex "Sonic Peridot" and Vaporeon ex "Severe Squall" land
through it under D400/D492's reading of the bare W/R tail (splitting that tail from the Feint form is a separate slice).
[🆕🆕🆕 D622 (D539): split at D622 — R-AM2 retired, the bare tail is stopped.]

| Column | `me` built / units (D621) | Standard pool D621 |
|---|---|---|
| Attacks | 963 / 1,039 | **2,695 / 2,771** |
| Abilities | 185 / 234 | **561 / 610** |
| Trainers | 154 / 183 (+16) | **418 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1111** (1095 + 16).

## 🆕 D620 update (engine 0.503.0) — WP10 + WP26

8 texts / 14 `me` units on 12 printings (`prizesToolsMeD620.test.ts`). WP10: the NEW `DamageCountSource.yourPrizesTaken` on Luxray
"Incessant Onslaught" `me03-028`, Fuecoco ex ×2 "Cheerful Flame" `30th-015` / `-147` and Mega Mawile ex ×2 "Gobble Down" `me01-094` /
`-162`, and the NEW `AttackBonusConsequent.baseOverride` on Mega Mawile ex ×2 "Huge Bite". WP26, five Tool objects: Light Ball
`me02.5-191`, Punk Helmet ×2 `me02-092` / `-121` (`damageAttacker.holderType`), Team Rocket's Hypnotizer `me02.5-206`, Core Memory
`me03-070` (`toolAttacksHolder`) and Tremendous Bomb ×2 `me05-082` / `-113` (`damageAttackerActiveThenDiscardIf`, R-TRB1 UNRULED).
**Finished:** all 12 (Mega Mawile ex ×2 is now fully built). **Dropped and named:** Adversity Policy `me04-074` (its "has Weakness to
your opponent's Active Pokémon's type" gate is a new `BoardCondition` member). [🆕🆕🆕 D626 (D539): Adversity Policy BUILT at D626 (K1,
`yourActiveWeakToOpponentActiveType`).]

| Column | `me` built / units (D620) | Standard pool D620 |
|---|---|---|
| Attacks | 963 / 1,039 (+7) | **2,695 / 2,771** |
| Abilities | 185 / 234 | **561 / 610** |
| Trainers | 138 / 183 (+7) | **402 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1095** (1083 + 12).

## 🆕 D619 update (engine 0.502.0) — WP12 (the passive half) + WP15

7 texts / 10 `me` printings (`attackerClassMeD619.test.ts`). WP12: the NEW attacker-gated post-W/R reduction
(`PassiveEffects.damageReductionAfterWRFromAttacker`, `attackerGatedReductionOf` at the four §8.5 sites) on Sacred Charm ×2
`me02-093` / `-122`, Thick Scale `me02.5-211` and Dewgong ×2 "Thick Fat" `me02-022` / `-097`. WP15: Heliolisk ×2 "Frilled
Generator" `me02.5-064` / `-229` and three clause-table rows on D564's `youPlayedSupporterNamedThisTurn` — Team Rocket's Kangaskhan
ex "Wicked Impact" `me02.5-162`, Espurr "Buddy Attack" `me04-036`, Hippowdon "Twister Spewing" `me03-040` (a gated mill).
**Finished:** all 10. **Dropped and named:** WP12's four attack texts / 5 printings — Heatran "Lava Wall" `me05-007`, Manectric
"Flashing Barrier" `me05-024` / `-089`, Deoxys "Psy Protection" `me04-033`, Bronzong "Metal Block" `me05-064`: a new attacker class
(Burned / Evolution / has an Ability) on persisted next-turn state owes `MATCH_RECORD_VERSION` 42 → 43 (pay it with WP24c / WP23). [🆕🆕🆕 D621 (D539): D621 paid 42 → 43 for WP24c / WP23 only; these four still owe a bump.] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]

| Column | `me` built / units (D619) | Standard pool D619 |
|---|---|---|
| Attacks | 956 / 1,039 (+3) | **2,688 / 2,771** |
| Abilities | 185 / 234 (+4) | **561 / 610** |
| Trainers | 131 / 183 (+3) | **395 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1083** (1073 + 10).

## 🆕 D618 update (engine 0.501.0) — the rest of the Stadiums (WP25b)

3 texts / 8 `me` Stadium printings on three new `stadium` objects (`stadiumsMeD618.test.ts`): Battle Cage ×2 `me02-085` / `-116`
(the Bench damage-counter shield, `StadiumEffects.benchCounterShield`, NEW; R-BCG1, R-BCG2), Mystery Garden ×3 `me01-122` / `-172`,
`me02.5-194` (Revavroom's discard-an-Energy cost, then `drawUntilHandSize` with the NEW `per` count of your {P} Pokémon in play;
R-MYG1) and Forest of Vitality ×3 `me01-117`, `me02.5-188`, `me03-109` (the Stadium evolution permission,
`StadiumEffects.sameTurnEvolution`, NEW; R-FOV1). **Finished:** all 8. **Dropped and named:** Dizzying Valley [🆕🆕🆕 D642 (D539): Dizzying Valley BUILT at D642 (Z1).] (Confusion kept
through evolution), Fossil Quarry (Antique Items deck-to-Bench) [🆕🆕🆕 D635 (D539): BUILT at D635 (F1)], Risky Ruins (a Stadium on-Bench trigger) and Ange Floette (a play
gate on Prism Tower in play, a second Stadium the same turn, and a named HP bonus).

| Column | `me` built / units (D618) | Standard pool D618 |
|---|---|---|
| Attacks | 953 / 1,039 | **2,685 / 2,771** |
| Abilities | 181 / 234 | **557 / 610** |
| Trainers | 128 / 183 (+8) | **392 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1073** (1065 + 8).

## 🆕 D617 update (engine 0.500.0) — five more WP24 Supporters (WP24b)

5 texts / 11 `me` Supporter printings on five new objects (`supportersMeD617.test.ts`): Pokémon Center Lady `me01-123`
(`healChosen` 60 + `recoverHealed`, NEW), AZ's Tranquility ×3 `me04-076` / `-106` / `-120` (the demoted ex healed 80,
`healChosen.targetRecorded`, NEW), Grimsley's Move ×2 `me02-090` / `-120` (shipped `lookAtTopN` + `notYourFirstTurn`), Gwynn ×3
`me05-078` / `-109` / `-119` (`drawCards.per` `recorded`, NEW) and Naveen ×2 `me03-079` / `-112` (`payFromHand.cap: "any"` and
`yourDeckNotEmpty`, NEW). **Finished:** all 11 cards. New readings (UNRULED): R-AZT1 (AZ with Palafin's Zero to Hero), R-GW1, R-NV1, R-NV2 (`progress.md` NEXT).
**Left for WP24c** (3 texts / 10 printings, one `MATCH_RECORD_VERSION` bump with a migration): Gladion's Final Battle ×3
`me05-077` / `-108` / `-118` (an attacker filter on the persisted side-wide bonus, plus a last-card gate), Acerola's Mischief ×4
`me01-113` / `-165` / `-183` / `me02.5-180` (a next-turn shield against ex on a chosen body) and Roxie's Performance ×3
`me04-081` / `-112` / `-121` (a next-turn Poisoned-can't-retreat side lock). [🆕🆕🆕 D621: all 10 BUILT.]

| Column | `me` built / units (D617) | Standard pool D617 |
|---|---|---|
| Attacks | 953 / 1,039 | **2,685 / 2,771** |
| Abilities | 181 / 234 | **557 / 610** |
| Trainers | 120 / 183 (+11) | **384 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1065** (1054 + 11).

## 🆕 D616 update (engine 0.499.0) — the second part of the deck / hand / discard / Energy misc (WP31b)

9 attack texts / 11 `me` printings on nine literal anchors onto shipped programs (`deckHandMiscMeD616.test.ts`): Regice ex "Ice
Prison" `me02.5-048` (`discardEnergy` 2 + Paralyzed), Volcanion "Backfire" `me01-025` (`discardEnergy` to the hand, typed),
Meloetta "Soothing Melody" ×2 `mep-026` / `me02-040` (`healChosen` Bench + `typedPokemon`), Claydol "Devolution Ray" ×2
`me04-047` / `-092` (`devolveChosen.defenderOnly`, NEW), Sudowoodo "Trials and Trip-ulations" `me04-043` (`byName` search),
Rotom "Roto Call" `me02.5-092` (`optional` over a name-fragment Bench search), Dialga "Reversed Clock" `30th-103` (Super Rod's
program), Celebi "Traverse Time" `me01-012` (`anyOf` search) and Eevee "Fetch and Hide" `30th-116` (`bottomFromOpponentHand`
Item). **Finished:** all 11 cards. One new reading (UNRULED): R-RCL1, Roto Call's decline does not shuffle (`progress.md` NEXT).
**Left for WP31c** (8 texts / 11 printings) [🆕🆕🆕 D624: 5 texts / 7 printings BUILT by WP31c, above — Tail Generator ×2, Hand Trim, Select a Snack ×2, Send Flowers, Chirp; Elemental Blast, Pleasing Present and Skill Thief ×2 dropped and named] [🆕🆕🆕 D638 (D539): Skill Thief ×2 BUILT at D638 (X1)] [🆕🆕🆕 D641 (D539): Pleasing Present BUILT at D641 (W1)]: Dedenne "Tail Generator" ×2 `me03-029` / `-093` (a count-scaled discard attach),
Lugia "Elemental Blast" `30th-121` (a matched multi-type discard) [🆕🆕🆕 D633: BUILT (O1)], Furfrou "Hand Trim" `me03-067` (a random discard to a hand
size), Morpeko "Select a Snack" ×2 `30th-061` / `-135` (a mill with a pick), Delibird "Pleasing Present" `me04-018` (an attach
for both players) [🆕🆕🆕 D641: BUILT (W1)], Shaymin "Send Flowers" `me03-003` (a deck attach of any Energy), Fletchling "Chirp" `me03-066` (a Resistance
filter) and Thievul "Skill Thief" ×2 `me05-054` / `-092` (a gated copy of an opponent's attack). [🆕🆕🆕 D638 (D539): Skill Thief ×2 BUILT at D638 (X1)]

| Column | `me` built / units (D616) | Standard pool D616 |
|---|---|---|
| Attacks | 953 / 1,039 (+11) | **2,685 / 2,771** |
| Abilities | 181 / 234 | **557 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1054** (1043 + 11).

## 🆕 D615 update (engine 0.498.0) — the first part of the deck / hand / discard / Energy misc (WP31a)

8 attack texts / 13 `me` printings on eight literal anchors onto shipped programs (`deckHandMiscMeD615.test.ts`): Trick Portal
`me05-008` and Fruity Aroma `me05-001` (`lookAtTopN`), Pika-Pika Parade ×3 `mep-107`, `30th-053` / `-149` (Precious Trolley's
`searchDeck`), Gentle Light ×3 `me04-035` / `-101` / `-117` (Picnic Basket's `healEachAll`), Nitpick ×2 `30th-094` / `-140`
(`handRefresh` on the opponent), Flames of Revival `me04-010` (`discardPileRetrieval`), Miraculous Shine `30th-069`
(`devolveEach.toHand`, NEW) and Cold Cyclone `me02.5-053` (typed `moveEnergy`). **Finished:** all 13 cards (Mega Delphox ex,
Pikachu ex ×3, Mega Floette ex ×3 and Frosmoth among them). One new reading (UNRULED): R-GLT1, Gentle Light's heal is not
refused by a §11 shield (`progress.md` NEXT). **Left for WP31b / WP31c** (17 texts / 22 printings; [🆕🆕🆕 D616: 9 texts / 11 printings BUILT by WP31b, above — 8 / 11 left for WP31c] [🆕🆕🆕 D624: 5 / 7 of those BUILT by WP31c; 3 / 4 stay]): Dedenne "Tail Generator" ×2
`me03-029` / `-093`, Regice ex "Ice Prison" `me02.5-048`, Lugia "Elemental Blast" `30th-121` [🆕🆕🆕 D633: BUILT (O1)], Furfrou "Hand Trim" `me03-067`,
Morpeko "Select a Snack" ×2, Delibird "Pleasing Present" `me04-018` [🆕🆕🆕 D641: BUILT (W1)], Meloetta "Soothing Melody" ×2, Claydol "Devolution Ray" ×2,
Volcanion "Backfire" `me01-025`, Shaymin "Send Flowers" `me03-003`, Fletchling "Chirp" `me03-066`, Sudowoodo "Trials and
Trip-ulations" `me04-043`, Celebi "Traverse Time" `me01-012`, Dialga "Reversed Clock" `30th-103`, Rotom "Roto Call"
`me02.5-092`, Eevee "Fetch and Hide" `30th-116` and Thievul "Skill Thief" ×2 `me05-054` / `-092`. [🆕🆕🆕 D638 (D539): Skill Thief ×2 BUILT at D638 (X1)]

| Column | `me` built / units (D615) | Standard pool D615 |
|---|---|---|
| Attacks | 942 / 1,039 (+13) | **2,674 / 2,771** |
| Abilities | 181 / 234 | **557 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1043** (1030 + 13).

## 🆕 D614 update (engine 0.497.0) — the Ability-effect shield (WP37b)

1 Ability text / 4 `me` printings on one new object (`abilityShieldMeD614.test.ts`): Mega Clefable ex `mep-072`, `me03-031` /
`-103` / `-119` "Luminous Wing" = `passive.preventAbilityEffects` (NEW), read through `EffectContext.invokedBy: "ability"` by the
§11 funnel, the Ability share of the recoils and Magma Surge's counters. **Finished:** all 4 cards (Shooting Moons was built at
D597). Two new readings (UNRULED): R-LW1, continuous Ability auras are not refused; R-LW2, an Ability lock on the holder removes the
shield (`progress.md` NEXT). Can reuse the piece: Hide 'n' Sneak ×4 (WP17, with `preventAttackEffects`) [🆕🆕🆕 D627 (D539): BUILT at D627 (H1)] and Antique Old Amber
`sv03.5-154` "Amber Protection" (same text, not Standard). WP37's other 7 texts / 13 printings stay in WP37. [🆕🆕🆕 D631 (D539): Supreme Overlord, Gloomy Garbage, Sniper's Eye ×2, Ancient Bulwark ×3 and Life-Locked BUILT at D631 (P1)]

| Column | `me` built / units (D614) | Standard pool D614 |
|---|---|---|
| Attacks | 929 / 1,039 | **2,661 / 2,771** |
| Abilities | 181 / 234 (+4) | **557 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1030** (1026 + 4).

## 🆕 D613 update (engine 0.496.0) — fix-up: the Jet Energy switch's Knock Out check, Basic-only bench placement

No new printing is built and no count moves. Two rule fixes on built cards: Holes ×2 (Team Rocket's Dugtrio, D610) now
Knocks Out a body made lethal by a Jet Energy switch (turn.ts `attachEnergy` runs the mid-turn sweep), and an effect that
puts Pokémon onto the Bench takes Basic Pokémon only unless its noun names its card (cards.ts `benchMatches`). The `me` text
this corrects is Booming Call ×2 (`30th-109` / `-156`, R-BC1 retired); the named Stage 1 benches (Lampent, Ninjask's Shedinja,
Silcoon / Cascoon) keep working. R-BN1 UNRULED (a name fragment counts as a name). `switchSweepBenchBasicD613.test.ts`.

## 🆕 D612 update (engine 0.495.0) — the tcgdex markup normaliser (WP06)

cardText.ts `normalizeCardText` at ingest (map.ts) and at read (cards.ts `cardOfUid`); the LOCAL D1's `mep`, `30th`, `30th-c` and
`swsh10.5` re-ingested, the `me` corpus regenerated (451 → 442 sentences). The 18 "markup only" texts / 21 `30th` printings below
are BUILT on shipped readers (`cardTextD612.test.ts`, census D612 block). `INFERNO_X` and `STEALTHY_SLASH` retired (their clean text
is reader-built; R-IX1 resolved); Photon Bullets ×3 stays keyed. Still unbuilt, now as clean text in their packages: Elemental Blast
`30th-121` [🆕🆕🆕 D633: BUILT], Lightning Crash `30th-051` (WP30) [🆕🆕🆕 D629: BUILT], Charge-Up Dash `30th-042` (WP13) [🆕🆕🆕 D634: BUILT], Overwriting Bolt `30th-040` [🆕🆕🆕 D633: still unbuilt — it gives a Weakness, an MRV bump (L1)] [🆕🆕🆕 D636: did not ride L1's bump; owes 45 → 46] [🆕🆕🆕 D637: not taken at 45 → 46 either; owes 46 → 47], Pika Chain `30th-034` [🆕🆕🆕 D640 (D539): Overwriting Bolt BUILT at D640 (MRV 46 → 47).]
(WP28b) [🆕🆕🆕 D623: BUILT], Kaboom Needles `30th-104` (WP30) [🆕🆕🆕 D629: BUILT]. The data gap below ("43 `me` rows carry tcgdex HTML") is closed on the LOCAL D1; the
remote D1 still needs the re-ingest, run with the D612 ingest code.

| Column | `me` built / units (D612) | Standard pool D612 |
|---|---|---|
| Attacks | 929 / 1,039 (+21) | **2,661 / 2,771** |
| Abilities | 177 / 234 | **553 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1026** (1005 + 21).

## 🆕 D611 update (engine 0.494.0) — the rest of the activated Abilities (WP21), plus Dragonair

9 Ability texts / 17 `me` printings keyed on nine new `abilities` objects (`activatedMeD611.test.ts`). On shipped ops: Nighttime
Maneuvers ×3 (Crobat; Ciphermaniac's deck-top search at one card), Boisterous Wind ×2 (Dustox), Destructive Headbutting ×2
(Rampardos ex), Sky Hunt ×2 (Talonflame) and Grand Wing (Vivillon `me03-009`). New pieces: Evidence Gathering ×2 (Gumshoos;
`payFromHand.swapWithTop`), Spiteful Evolution (Phantump; `evolveFromDeck.fromHand`, `countersOnRecordedBody`,
`notYourFirstTurn`), Sinister Surge ×3 (Toxtricity; `countersOnRecordedBody` on the body the Energy went to) and, from WP20b's
drops, Evolutionary Guidance (Dragonair; `requiresEnergyType: "any"`). **Finished:** all 17 cards. **Dropped and named:** Larry's
Komala `me02.5-175` "Lethargic Charge" [🆕🆕🆕 D628 (D539): Lethargic Charge BUILT at D628 (A1)] (an Active-only target and a which-Energy-card choice — two pieces; the "Larry's" filter is `attachEnergyFrom`'s shipped `ownerPokemon`, and `attachFromHand` has neither an Active nor a name rider). Heliolisk ×2
"Frilled Generator" stays with WP15 [🆕🆕🆕 D619 (D539): BUILT at D619]. Four new readings (UNRULED): R-EG1 (Evidence Gathering refused with an empty deck), R-SE1
(Spiteful Evolution evolves a Phantump put into play this turn), R-SE2 (no `onEvolve` trigger on the hand evolve), R-SE3 (review: it evolves under "Evolution Jammer")
(`progress.md` NEXT).

| Column | `me` built / units (D611) | Standard pool D611 |
|---|---|---|
| Attacks | 908 / 1,039 | **2,640 / 2,771** |
| Abilities | 177 / 234 (+17) | **553 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 1005** (988 + 17).

## 🆕 D610 update (engine 0.493.0) — the first part of the on-move / as-often / HP passives (WP37a)

8 Ability texts / 16 `me` printings keyed on seven new objects (`onMoveHpMeD610.test.ts`). Solar Transfer ×4 (Mega Venusaur
ex) and Bubble Gathering (Azumarill ex) are "as often as you like" `moveEnergy` Abilities; Metal Road ×2 (Cobalion ex) is Buzzing
Boost's promoted-this-turn gate over a typed any-amount sweep; Swirling Prose ×2 (Mismagius ex) and Holes ×2 (Team Rocket's
Dugtrio) ride Lava Zone's opponent-side `onActiveMovedToBench`; Scale Up ×3 and Tyrannically Gutsy ×2 are `hpBonus` gates (the new
`requiresEnergyCount`, and "special"). **Finished:** all 16 cards (Mega Venusaur ex ×4 among them). **WP37 rest, left and named**
(8 texts / 17 printings): Fall Back to Reload ×2 [🆕🆕🆕 D636 (D539): BUILT at D636], Last-Ditch Catch ×3 [🆕🆕🆕 D628 (D539): Last-Ditch Catch BUILT at D628 (A1)], Luminous Wing ×4 (WP37b — Mega Clefable ex ×4 still waits
on it [🆕🆕🆕 D614: BUILT, Mega Clefable ex ×4 finished]), Supreme Overlord, Gloomy Garbage, Sniper's Eye ×2, Ancient Bulwark ×3, Life-Locked. [🆕🆕🆕 D631 (D539): Supreme Overlord, Gloomy Garbage, Sniper's Eye ×2, Ancient Bulwark ×3 and Life-Locked BUILT at D631 (P1)] Two new readings (UNRULED): R-HL1, Holes
resolves before Palafin's Zero to Hero with no Knock Out check between; R-MR1, Metal Road's moment is a use-time gate, which affords
a delayed use (`progress.md` NEXT). [🆕🆕🆕 D625 (D610 MINOR 2): R-HL1 INVERTS D356's principle (turn.ts, Magearna "Auto Heal": the turn player's own effects resolve first when two triggers answer one moment), and its listed reversal "Zero to Hero first" IS D356's order. The departure is the reading because under D356's order Holes' subject has already gone to the deck and Holes does nothing; still UNRULED.]

| Column | `me` built / units (D610) | Standard pool D610 |
|---|---|---|
| Attacks | 908 / 1,039 | **2,640 / 2,771** |
| Abilities | 160 / 234 (+16) | **536 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 988** (972 + 16).

## 🆕 D609 update (engine 0.492.0) — KO / damage-counter attacks (WP36)

4 attack texts / 8 `me` printings newly read (`koCountersMeD609.test.ts`). Mega Absol ex ×3 "Terminal Period" is a
`conditionGate` on the new `opponentActiveDamageCountersExactly` around `knockOutDefender`; Inteleon ×3 "Bring Down" is
`knockOutChosen` at the new `target: "anyExceptSelf"` with the new `leastHpRemaining` (R-BD1, UNRULED: the least is taken
before the §11 filter); N's Vanilluxe "Snow Coating" is `counterEachAll` with the new `perDamageCounterOnTarget`; Bramblin
"Sneaky Placement" is the singular "Place 1 damage counter" on D449's any-zone put. **Finished:** all 8 cards. **WP36 rest,
dropped and named** (2 texts / 3 printings): Yveltal ex ×2 "Soul Destroyer" (a Knock Out sweep at an HP threshold) and Unown
`30th-072` "Mysterious Signal" (a this-attack Prize bonus). [🆕🆕🆕 D639 (D539): both BUILT at D639 (K3 + R1)]

| Column | `me` built / units (D609) | Standard pool D609 |
|---|---|---|
| Attacks | 908 / 1,039 (+8) | **2,640 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 972** (964 + 8).

## 🆕 D608 update (engine 0.491.0) — snipe / spread wording (WP30)

7 attack texts / 13 `me` printings newly read, plus 5 `30th` printings keyed by id (`snipeSpreadMeD608.test.ts`). "each of 2"
is the shipped arity (Mega Eelektross ex ×3 "Split Bomb", Ambipom ×2 "Dual Tail"); Disaster Shock ×3 is a fourth optional-cost
skeleton with a `defenderStatus` payoff (inner confirm); Mega Skarmory ex ×2 "Sonic Ripper" and Spectrier "Phantasmal Barrage"
are literal cost-then-snipe compounds; Mandibuzz "Bone Sniper" uses the new `damageChosen.specialEnergyOnly`; Greninja ex
`mep-099` "Stealthy Slash" is the counter-scaled snipe at `opponentAny`. Keyed (`<em>` markup): Mewtwo ex ×3 "Photon Bullets"
(the ex-only spread, no `ignoreWR`) and Greninja ex `30th-021` / `-148`. [🆕🆕🆕 D612: the `<em>` is normalised; Stealthy Slash ×2 is unkeyed and reader-built, Photon Bullets ×3 stays keyed] **Finished:** all 15 cards. **WP30 rest, named**
(8 texts / 8 printings): Pikachu `30th-051` (markup + typed discard), Mismagius `me02.5-086` (gated counters), Coalossal
`me02.5-120` (discard-pile gate behind a snipe), Genesect `me02-008` / Seaking `me05-014` (typed per-Energy snipe), Frosmoth
`me01-043` / Ferrothorn `30th-104` (a clause after the parenthetical), Deoxys `me04-032` (extra-Energy gate on a bench snipe). [🆕🆕🆕 D629: all but Deoxys BUILT (S1); Deoxys dropped and named]

| Column | `me` built / units (D608) | Standard pool D608 |
|---|---|---|
| Attacks | 900 / 1,039 (+18) | **2,632 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 964** (949 + 15).

## 🆕 D607 update (engine 0.490.0) — the first half of the scaling count sources (WP28a)

8 attack texts / 14 `me` printings, readers only (`scalingCountsMeD607.test.ts`). Three new nullary `DamageCountSource` members:
`energyInPlayBothSides` (Delphox ×2 "Energized Storm"), `toolsInPlayBothSides` (Bronzong "Tool Drop") and
`basicEnergyTypesOnYourBoard` (Sylveon ex ×3 "Colorful Harmony"). Four texts on shipped members: Beedrill ex ×2 "Rumbling Bees"
and Paldean Tauros "Raging Charge" (`pokemonInPlay`, new body-map keys), Raticate ×2 "Retaliatory Incisors"
(`damageCountersOnYourBench` + a "Rattata" key), Tinkaton "Windup Swing" (the penalty fold over `energyOnOpponent`) and
Beautifly ×2 "Energy Straw" (the comma-joined reveal, "Energy card" in the opponent's hand). **Finished:** all 14. **Left for
WP28b** (7 texts / 11 printings) [🆕🆕🆕 D623 (D539): five are BUILT at D623 — Kyogre, Igglybuff, Pikachu `30th-034`, Armarouge ×2, Gourgeist ex ×2; Doublade ×3 and Okidogi are dropped and named there]: Doublade ×3, Kyogre `me01-034`, Igglybuff `30th-120`, Pikachu `30th-034` (WP06 markup), [🆕🆕🆕 D612: the markup is normalised; the sentence is still unread]
Armarouge ×2, Gourgeist ex ×2, Okidogi `me02.5-122` — each tagged below. [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
[🆕🆕🆕 D633 (D539): Doublade ×3 BUILT at D633 (O1).]

| Column | `me` built / units (D607) | Standard pool D607 |
|---|---|---|
| Attacks | 882 / 1,039 (+14) | **2,614 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 109 / 183 | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 949** (935 + 14).

## 🆕 D606 update (engine 0.489.0) — the first half of the Stadiums (WP25a)

5 texts / 9 `me` printings on five new `stadium` objects (registry.ts D606 block; `stadiumsMeD606.test.ts`): Prism Tower ×2
(Reconstitute's discard-2-draw-1 on the Stadium path), Surfing Beach ×2 (an Active {W} gate and a Benched {W} switch — the first
Stadium program `programPlayable` can refuse), Nighttime Mine (League HQ's {C} surcharge on the Tera banner, the new
`StadiumEffects.attackCostSurcharge`), Lumiose City ×2 and Celebratory Fanfare ×2 (the new turn-ending Stadium use,
`StadiumAbility.endsTurn: "always" | "ifHealed"`; R-LC1, R-CF1). **Finished:** all 9. **Dropped and named:** Battle Cage ×2 (a
Bench damage-counter shield — the brief's other new piece), Mystery Garden ×3 (a draw-until count source), Forest of Vitality ×3
(a same-turn evolution rule), Dizzying Valley [🆕🆕🆕 D642 (D539): Dizzying Valley BUILT at D642 (Z1).] (Confusion kept through evolution), Fossil Quarry (Antique Items deck-to-Bench) [🆕🆕🆕 D635 (D539): BUILT at D635 (F1)],
Risky Ruins (an on-Bench Stadium trigger). **Excluded by the brief:** Ange Floette. [🆕🆕🆕 D618: Battle Cage, Mystery Garden and
Forest of Vitality BUILT by WP25b, above; Dizzying Valley, Fossil Quarry [🆕🆕🆕 D635 (D539): BUILT at D635 (F1)], Risky Ruins and Ange Floette [🆕🆕🆕 D642 (D539): Dizzying Valley, Risky Ruins, Ange Floette BUILT at D642 (Z1).] dropped again.]

| Column | `me` built / units (D606) | Standard pool D606 |
|---|---|---|
| Attacks | 868 / 1,039 | **2,600 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 109 / 183 (+9) | **373 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 935** (926 + 9).

## 🆕 D605 update (engine 0.488.0) — coin (the rest) (WP34)

5 texts / 12 `me` printings, attack readers only (`coinRestMeD605.test.ts`). New pieces: `damageChosen.perHeadsInPlay`
(Tauros ×2 "Target Together": pick first, then one coin per own body with "Tauros" in its name, 50 × heads),
`damageChosen.flipEach` (Mega Zygarde ex ×5 "Nullifying Zero": one coin per opposing Pokémon, 150 to each heads target;
R-NZ1), "choose a Special Condition" as four labelled `optional` confirms behind the coin gate (Grafaiai "Miraculous Paint";
R-MP1), and a flip count by name in play (`pokemonInPlay` over `byName`, Maushold ×2 "Gnaw Together"). Mega Audino ex ×2
"Kaleidowaltz" repeats the bare search-and-attach per heads (R-KW1). **Finished:** Mega Zygarde ex ×5, Mega Audino ex ×2,
Tauros ×2, Maushold ×2, Grafaiai. **Dropped and named:** Watchog ×2 "Snap Inspection" (a revealed-hand pick shuffled into
the deck: `bottomFromOpponentHand.dest` has no shuffle member) [🆕🆕🆕 D634 (D539): BUILT at D634 (C1), `dest: "deck"`] and Ditto ×2 "Surprisingly Transform" (a deck Pokémon swapped
in for the attacker: no op) [🆕🆕🆕 D641 (D539): BUILT at D641 (W1), the NEW `switchWithDeckChosen`].

| Column | `me` built / units (D605) | Standard pool D605 |
|---|---|---|
| Attacks | 868 / 1,039 (+12) | **2,600 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 100 / 183 | **364 / 447** |
| Special Energy | 11 / 11 | **22 / 22** |

**Fully built `me` printings: 926** (914 + 12).

## 🆕 D604 update (engine 0.487.0) — the typed Special Energies (WP18)

8 texts / 8 `me` printings on eight new `energy` objects (registry.ts D604 block; `typedSpecialEnergyMeD604.test.ts`): every
unbuilt `me` Special Energy below. Each provides its printed type; its rule applies only on a holder of that type (the new
`EnergyProgram.holderType`, R-TE1). New pieces: `EnergyOnAttach.benchSearch` (Telepathic Psychic, R-TP1),
`returnAfterAttackDiscard: "hand"` (Nitro Fire, R-NF1) and `energyFreesRetreat` (Magnetic Metal). **Finished:** all 8.
Nothing dropped.

| Column | `me` built / units (D604) | Standard pool D604 |
|---|---|---|
| Attacks | 856 / 1,039 | **2,588 / 2,771** |
| Abilities | 144 / 234 | **520 / 610** |
| Trainers | 100 / 183 | **364 / 447** |
| Special Energy | 11 / 11 (+8) | **22 / 22** |

**Fully built `me` printings: 914** (906 + 8).

## 🆕 D603 update (engine 0.486.0) — the Mega-gated texts (WP11)

6 texts / 11 `me` printings on six new objects (registry.ts D603 block; `megaGatedMeD603.test.ts`), on two new members over
D582's `isMegaEvolutionPokemonEx`: `BoardCondition.yourMegaExInPlay { type? }` and `CardFilter.megaEvolutionEx`. Excited Turbo
×3 (Oricorio ex; {R} gate, as often as you like, a Basic {R} from hand to a Benched {R}), Excited Heal ×2 (Ludicolo; {G} gate,
heal 60 from 1), Excited Dash (Linoone; on the Bench, any Mega ex, switch with the Active), Excited Power (Seviper; {D} gate,
+120 before W/R), Mega Signal ×3 (a Mega ex from the deck) and Jett (a card per opponent's Mega ex). **Finished:** all 11.
**Dropped:** Latios `me01-101` "Lustrous Assist" [🆕🆕🆕 D628 (D539): Lustrous Assist BUILT at D628 (A1)] (a gate on a named Active's Bench-to-Active move) and Wally's Compassion ×3
(all Energy to the hand from the healed body). **Excluded by the brief:** Tremendous Bomb ×2, Ange Floette [🆕🆕🆕 D642 (D539): Ange Floette BUILT at D642 (Z1).], Core Memory. [🆕🆕🆕 D620 (D539): Tremendous Bomb ×2 and Core Memory BUILT at D620 (WP26).] [🆕🆕🆕 D625 (D539): Wally's Compassion ×3 BUILT at D625 (`healChosen.energyToHandFromHealed`).]

| Column | `me` built / units (D603) | Standard pool D603 |
|---|---|---|
| Attacks | 856 / 1,039 | **2,588 / 2,771** |
| Abilities | 144 / 234 (+7) | **520 / 610** |
| Trainers | 100 / 183 (+4) | **364 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 906** (895 + 11).

## 🆕 D602 update (engine 0.485.0) — the activated Abilities: search / heal / attach (WP20b)

6 texts / 9 `me` printings on six new `abilities` objects (registry.ts D602 block; `activatedMeD602.test.ts`): Call a Buddy
×2 (Silvally; no cards in hand, a Supporter), Gathering of Blossoms ×2 (Erika's Tangela; an Erika's Pokémon), Guiding Dance
(Vivillon `30th-008`; coin, a Pokémon), Fermented Juice ×2 (Shuckle; {G} on itself, heal 30 from 1), Lovely Fragrance
(Erika's Vileplume ex; heal 30 from each) and Sunrise (Solgaleo `30th-105`; on the Bench, up to 2 Basic {M} to itself). Every
lock per Pokémon, as printed. **Finished:** all 9. **Dropped:** Dragonair `me02.5-151` "Evolutionary Guidance" (an untyped
per-body Energy gate) and Larry's Komala `me02.5-175` "Lethargic Charge" (an Active-only attach target). [🆕🆕🆕 D611: Dragonair
BUILT; Larry's Komala dropped again (it also needs a which-Energy-card choice).] [🆕🆕🆕 D628 (D539): Lethargic Charge BUILT at D628 (A1)]

| Column | `me` built / units (D602) | Standard pool D602 |
|---|---|---|
| Attacks | 856 / 1,039 | **2,588 / 2,771** |
| Abilities | 137 / 234 (+9) | **513 / 610** |
| Trainers | 96 / 183 | **360 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 895** (886 + 9).

## 🆕 D600 update (engine 0.484.0) — the hand count and five bonus conditions (WP14 + WP33b)

7 texts / 12 `me` printings (`handCountConditionsMeD600.test.ts`). WP14: Powerful Hand ×3 and Treasure Rush ×2 on the new
count source `cardsInYourHand`. WP33b: Retaliatory Claw (remaining HP), Chomp Whole (no Retreat Cost), Solar Coiling ×2
(Rosa's Encouragement in your discard), Cocky Claw (Stage 2 {D} on your Bench), Shadowy Whip ×2 (Shadowy {D} Energy on your
Bench), each a literal row on a new member. **Finished:** Alakazam ×3, Galarian Meowth ×2, Weavile, Carnivine, Serperior ×2,
Sableye, Zarude ×2. **Dropped:** Celebration ×2 (the take-then-shuffle order). "That much more damage" ×4 stays out [🆕🆕🆕 D640 (D539): Celebration BUILT at D640 (MRV 46 → 47).]
(damage-taken memory).

| Column | `me` built / units (D600) | Standard pool D600 |
|---|---|---|
| Attacks | 856 / 1,039 (+12) | **2,588 / 2,771** |
| Abilities | 128 / 234 | **504 / 610** |
| Trainers | 96 / 183 | **360 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 886** (874 + 12).

## 🆕 D599 update (engine 0.483.0) — two WP24 Supporters (WP24a)

2 texts / 4 `me` printings (`supportersMeD599.test.ts`): Anthea & Concordia ×2 (Briar's Prize bonus at 3 on N's Pokémon,
six-name play gate) and Emma ×2 (reveal, then a card per Pokémon in the opponent's hand — the new `drawCards.per` member).
**Still open in WP24 (named):** AZ's Tranquility ×3 (heal the demoted ex), Gladion's Final Battle ×3 (an attacker filter on
the side-wide bonus), Grimsley's Move ×2 (a "not your first turn" gate), Gwynn ×3 (a draw per recorded card), Naveen ×2
(an uncapped hand discard and a deck-not-empty gate); WP24b: Acerola's Mischief ×4, Roxie's Performance ×3. [🆕🆕🆕 D617: AZ's Tranquility, Grimsley's Move, Gwynn and Naveen BUILT by WP24b, above, with Pokémon Center Lady; Gladion's Final Battle, Acerola's Mischief and Roxie's Performance left for WP24c.] [🆕🆕🆕 D621: those three BUILT.]

| Column | `me` built / units (D599) | Standard pool D599 |
|---|---|---|
| Attacks | 844 / 1,039 | **2,576 / 2,771** |
| Abilities | 128 / 234 | **504 / 610** |
| Trainers | 96 / 183 (+4) | **360 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 874** (870 + 4).

## 🆕 D598 update (engine 0.482.0) — KO / damage-taken Abilities (WP32)

6 texts / 13 `me` printings (`koAbilitiesMeD598.test.ts`). Shadowy Concealment ×5 (a seat-wide Prize reduction on the
KO'd side), Tenacious Body ×3 and Durable Body (the coin-flip survive), Fragile Husk ×2 (no Prize for a KO by an ex),
Infinite Shadow (return-to-hand on KO) and Final Chain (an on-KO search behind the attack cause). **Finished:** Mega
Gengar ex ×5, Mega Hawlucha ex ×3, Annihilape `me05-041`, Shedinja ×2, Gengar `me03-050`, Pecharunt `me02.5-143`.
**Still open in WP32 (named):** Gengar ex "Fainting Spell" ×2 (KO the Attacking Pokémon on heads), Miraidon "Photon
Cord" ×2 (an Energy move off the dying body), Spiritomb "Spiteful Swirl" ×2 and Wishiwashi "Counterattack Grouping" [🆕🆕🆕 D642 (D539): Spiteful Swirl, Counterattack Grouping BUILT at D642 (K2).]
(a seat-wide filtered recoil), Damp ×2 (WP38). [🆕🆕🆕 D626 (D539): Fainting Spell ×2 and Photon Cord ×2 BUILT at D626 (K1);
Spiteful Swirl ×2 and Counterattack Grouping [🆕🆕🆕 D642 (D539): Spiteful Swirl, Counterattack Grouping BUILT at D642 (K2).] are K2.] [🆕🆕🆕 D632 (D539): Damp BUILT at D632 (D1).]

| Column | `me` built / units (D598) | Standard pool D598 |
|---|---|---|
| Attacks | 844 / 1,039 | **2,576 / 2,771** |
| Abilities | 128 / 234 (+13) | **504 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 870** (857 + 13).

## 🆕 D597 update (engine 0.481.0) — the discard-scaled attacks (WP29)

8 texts / 18 `me` printings (`discardScaledMeD597.test.ts`). Inferno X ×4, Garland Ray ×3, Steel Cutter, Double
Eater: the `me` comma spelling of D402's `×` fold (`COMMA_DISCARD_SCALED_DAMAGE`; the hand zone is D489's declinable
`payFromHand`). Hammer-lanche ×2, Iceberg Breaker: D488's mill on the typed "Basic {W} Energy card" noun. Shooting
Moons ×4: `deriveAttackDiscardScaledBoost`'s new `handDiscard` member. The two "[R]" Inferno X `mep-023` / `-029`:
keyed on `INFERNO_X` [🆕🆕🆕 D612: RETIRED — WP06 normalises the text]. **Finished:** Mega Charizard X ex ×6, Mega Abomasnow ex ×2, Mega Diancie ex ×3, Avalugg
`me04-024`, Skarmory `me05-060`, Mawile `me03-032`. Mega Clefable ex ×4 still wait on "Luminous Wing". [🆕🆕🆕 D614: no longer — built at D614]
**Still open in WP29 (named):** Mega Eelektross ex "Disaster Shock" ×3 (status payoff; Split Bomb is WP30) [🆕🆕🆕 D608: both BUILT — WP30], Slowpoke
"All-You-Can-Yeet" `me05-029`, Team Rocket's Honchkrow "Rocket Feathers" `me02.5-127`, Pawmot "Voltaic Fist"
`me02-034`. [🆕🆕🆕 D633 (D539): all three BUILT at D633 (O1).]

| Column | `me` built / units (D597) | Standard pool D597 |
|---|---|---|
| Attacks | 844 / 1,039 (+18) | **2,576 / 2,771** |
| Abilities | 115 / 234 | **491 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 857** (843 + 14).

## 🆕 D596 update (engine 0.480.0) — Mega Gardevoir ex and Xerneas (WP09)

3 texts / 14 `me` printings (`megaGardevoirD596.test.ts`). Mega Symphonia ×6 and Geo Storm ×2: the `×` board-wide own
Energy count (`SELF_BOARD_ENERGY_MULTIPLY`, `energyOnSelf` at the board zone). Overflowing Wishes ×6: `attachFromDeck`
with `benchOnly` and the new `each` (one Basic {P} Energy per Benched Pokémon). **Finished:** Mega Gardevoir ex ×6,
Xerneas `me04-042` / `-091`. Nothing dropped. WP09 is closed.

| Column | `me` built / units (D596) | Standard pool D596 |
|---|---|---|
| Attacks | 826 / 1,039 (+14) | **2,558 / 2,771** |
| Abilities | 115 / 234 | **491 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 843** (835 + 8).

## 🆕 D595 update (engine 0.479.0) — coin-gate compositions (WP13)

8 texts / 11 `me` printings (`coinGateMeD595.test.ts`). Five coin gates over consequents the readers already build:
Bellyful of Milk (2 coins, heal all from 1), Tri Kinesis (3 coins, Knock Out 1 of the opponent's Pokémon), Clumsily Clutch
(the Defending Pokémon can't retreat), Strolls So Much (search for any card) and Pull (gust). Three per-heads arms:
Energizing Sketch (any Basic Energy from the discard to the Bench, one per heads), Wreak Havoc ×2 / Relentless Burrowing
(one card milled per heads, until tails) and Horrifying Bite ×2 (one random card from hand to deck per heads, until tails).
**Finished:** Miltank, Team Rocket's Exeggutor, Houndstone ×2, Team Rocket's Diglett, Murkrow, Gimmighoul, Drifloon,
Smeargle (Tyrantrum ×2 still wait on Tyrannically Gutsy [🆕🆕🆕 D610 (D539): no longer — built at D610]). **Dropped:** Challenging Delivery (the bench search reads
"a Pokémon" as a card name; only a Basic may go onto the Bench, so it needs a Basic bench-search arm), Hyper Lariat (a threshold bonus needs a new coin
member), All-You-Can-Grab, Gormandizer and Charge-Up Dash (a deck source capped at the heads count; Charge-Up Dash also
needs WP06 [🆕🆕🆕 D612: done]), Reversing Gust (the shuffled body may be the Active) and Jet of Ink (a two-coin flip lock). [🆕🆕🆕 D634 (D539): all but
Jet of Ink BUILT at D634 (C1).] [🆕🆕🆕 D636 (D539): Jet of Ink BUILT at D636 (L1).]

| Column | `me` built / units (D595) | Standard pool D595 |
|---|---|---|
| Attacks | 812 / 1,039 (+11) | **2,544 / 2,771** |
| Abilities | 115 / 234 | **491 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 835** (826 + 9).

## 🆕 D594 update (engine 0.478.0) — bonus / requirement rows on shipped members (WP33a)

6 texts / 10 `me` printings (`conditionRowsMeD594.test.ts`), the first half of WP33. Four attack clause rows: Whirling
Envy (2 or more damage counters, Weakness ignored), Cosmic Beam ×2 (needs a Benched Lunatone), Welcoming Tail ×2 (exactly
6 Prizes left) and All Out ×3 (no cards in hand). Two Abilities on shipped passive fields: Fighting Roar (evolve early
while the opponent's Active is a Pokémon ex; a new `ifCondition` on `evolveEarlyExempt`; a Luxio evolved from Shinx this turn may evolve again) and Needly Armor (3 counters per
{G} Energy). **Finished:** Chi-Yu, Solrock ×2, Steelix ×2, Slowbro ×3, Luxio, Chesnaught. **Dropped:** Retaliatory Claw
(remaining HP), Chomp Whole (no Retreat Cost) and Celebration ×2 (the take-then-shuffle order). WP33b keeps Solar [🆕🆕🆕 D640 (D539): Celebration BUILT at D640 (MRV 46 → 47).]
Coiling ×2, Juggernaut Horn / Counter ×4, Cocky Claw and Shadowy Whip ×2. [🆕🆕🆕 D600: built — except Juggernaut Horn / Counter ×4, excluded.] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]

| Column | `me` built / units (D594) | Standard pool D594 |
|---|---|---|
| Attacks | 801 / 1,039 (+8) | **2,533 / 2,771** |
| Abilities | 115 / 234 (+2) | **491 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 826** (816 + 10).

## 🆕 D593 update (engine 0.477.0) — more clause rows and the "Fade Out" objects (WP07)

9 attack texts / 15 `me` printings (`clauseRowsMeD593.test.ts`). Seven clause rows on shipped members: Master's Punch
(Benched Pancham damaged), Horrifying Revenge ×2 (a Hop's Pokémon KO'd by an attack last turn), Upper Spark (evolved from
Magneton this turn), Spiky Rolling (used Spiky Rolling last turn), Giga Railgun (needs Voltaic Lightning Energy attached),
Brain Crush (opponent's Active Confused), plus Facade ×2 on the one new member `yourActiveBurnedOrPoisoned`. Cutting
Riposte is the eighth `ATTACK_GATE_CLAUSES` row (`alternateCostIf` at {D}). "Fade Out" ×5 is keyed on three new
attack-only objects named for the printed attack (Balloon Return, Tuck Tail ×3, Sky Return). Nothing dropped. **Finished:**
Pangoro, Hop's Trevenant ×2, Magnezone, Crawdaunt, Vikavolt, Larry's Staraptor ×2, Togedemaru ex, Malamar, Drifblim, Emolga.
Meowth ex ×3 still waits on its Ability, Last-Ditch Catch. [🆕🆕🆕 D628 (D539): Last-Ditch Catch BUILT at D628 (A1)] Voltaic Lightning Energy itself is unbuilt (it provides {C}). [🆕🆕🆕 D604 (D539): WITHDRAWN — Voltaic Lightning Energy is built since D604: it provides {L} and adds 20 on its {L} holder]

| Column | `me` built / units (D593) | Standard pool D593 |
|---|---|---|
| Attacks | 793 / 1,039 (+15) | **2,525 / 2,771** |
| Abilities | 113 / 234 | **489 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 816** (804 + 12).

## 🆕 D592 update (engine 0.476.0) — the reader wording drift and Corrosive Liquid (WP02)

11 attack texts / 18 `me` printings are now read by `deriveAttackEffect` (effects.ts; `wordingDriftMeD592.test.ts`).
Ten are `me` phrasings of sentences the readers already build in their `sv` wording, rewritten by a six-row synonym table
(`normaliseMeWording`) before the anchors run: "Place" → "Put" before "damage counters on" (Haunt, Pernicious Poison ×3,
Shellnado Spin, Ghostly Blow, Chaotic Pain ×2, Swirling Resentment), the two comma-joins (Claw of Darkness ×3, Astonish),
"This Pokémon does N damage to itself." (Thunder) and the coin-flipped "can't use attacks" (Power Rush). The table is the
identity on every legal `sv` sentence and splitter fragment. Corrosive Liquid ×3 is Megaton Blower's two sweeps on an attack.
No new op, member or field; nothing dropped. **Finished:** Mega Dragalge ex ×3, Mega Slowbro ex `me05-031`, Haunter
`me03-049`, Eternatus `me02-069`, Aipom `me02-078`, Hisuian Zoroark `30th-123`. Still waiting on another text: Mega Absol ex ×3
(Terminal Period) [🆕🆕🆕 D609: Terminal Period BUILT, Mega Absol ex ×3 finished], Miraidon `mep-082`, Annihilape `me05-041` and Gengar ex ×2 (an Ability each) [🆕🆕🆕 D598: Annihilape finished (Durable Body)]. Five other `me` sentences
print "place … damage counters on" and stay unbuilt (they need more than a synonym).

| Column | `me` built / units (D592) | Standard pool D592 |
|---|---|---|
| Attacks | 778 / 1,039 (+18) | **2,510 / 2,771** |
| Abilities | 113 / 234 | **489 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 804** (796 + 8).

## 🆕 D591 update (engine 0.475.0) — the activated Abilities: the Flapping trio and the draw engines (WP20a)

11 activated Ability texts / 19 `me` printings are keyed on seven new `abilities` objects (registry.ts D591 block;
`activatedMeD591.test.ts`): Run Errand ×4 (Mega Kangaskhan ex; draw 2, Active only, one Run Errand per turn), Alluring Wings
(Frosmoth; each player draws a card, Active only), Fiery / Flash-Pop / Frosty Flapping ×3 each (both partners in play by
exact name; a Basic Energy of the printed type from the hand to itself), Lunar Cycle ×3 (Lunatone; Solrock in play, pay a
Basic {F}, draw 3, one Lunar Cycle per turn) and Flaring Magic ×2 (Delphox; pay a Basic {R}, draw until 7). No new op,
member or field; nothing dropped. **Finished:** Mega Kangaskhan ex ×4, Moltres ×3, Zapdos ×3, Articuno `mep-097`,
Lunatone ×3. Still waiting on an attack: Delphox ×2 "Energized Storm", Frosmoth "Cold Cyclone", and the `30th` Articuno ×2
"Hail" (tcgdex's `<em>` markup, WP06). [🆕🆕🆕 D607: Delphox ×2's "Energized Storm" is BUILT (WP28a); both are fully built.] [🆕🆕🆕 D612: Hail ×2 is BUILT — WP06 normalised the text.] [🆕🆕🆕 D615: Frosmoth's "Cold Cyclone" is BUILT (WP31a); Frosmoth is fully built.]

| Column | `me` built / units (D591) | Standard pool D591 |
|---|---|---|
| Attacks | 760 / 1,039 | **2,492 / 2,771** |
| Abilities | 113 / 234 (+19) | **489 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 796** (782 + 14).

## 🆕 D590 update (engine 0.474.0) — the on-evolve Abilities and the self-shuffle (WP05)

9 on-evolve Ability texts / 13 `me` printings are keyed on nine new `onEvolve` objects (registry.ts D590 block;
`onEvolveMeD590.test.ts`) — Psychic Draw ×4 (Alakazam ×3, Kadabra; draw behind a confirm), Prison Panic (behind a confirm), Energized Steps,
Heave-Ho Catcher, Cast-Off Shell ×2, Enriching Melody ×2, Multiplying Cocoon, Haphazard Hammer — and *"Shuffle this Pokémon
and all attached cards into your deck."* ×3 derives as `returnSelf` to the deck. No new op. **Dropped:** Flygon ×3 "Sandy
Flapping" (its KO half needs an Active-Spot / by-attack gate on an `onKnockOut` program). [🆕🆕🆕 D626 (D539): Flygon ×3 BUILT at
D626 (K1): `activeOnly` is read for an on-KO program, beside D598's `byOpponentAttack`.] **Finished:** Kadabra, Brambleghast,
Grumpig, Hariyama, Ninjask ×2, Primarina ×2, Silcoon, Tinkatuff, Lokix `me02-010`. Alakazam ×3 still waits on "Powerful
Hand" (WP14) [🆕🆕🆕 D600: built]. Named deviations: Heave-Ho Catcher's forced `gust` (no decline; Defiant Horn's row), and the three
search / look programs shuffle even when nothing is taken.

| Column | `me` built / units (D590) | Standard pool D590 |
|---|---|---|
| Attacks | 760 / 1,039 (+3) | **2,492 / 2,771** |
| Abilities | 94 / 234 (+13) | **470 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 782** (771 + 11).

## 🆕 D589 update (engine 0.473.0) — Mega Greninja ex and the optional-cost family (WP08)

4 `me` attack sentences / 9 printings derive through `deriveAttackOptionalCostBoost`'s third skeleton (*"You may {cost}
and have this attack do N more damage."*) over four new cost rows — Metallic Hammer (discard 3 {M}), Riotous Blasting ×2
(discard all), Ninja Spinner ×5 (a {W} to the hand) and Chrono Burst (shuffle all into the deck) — and Mega Greninja ex ×5
"Mortal Shuriken" is keyed on `MORTAL_SHURIKEN` (Meowscarada ex `sv02-015`'s shape at {W}, 60, `opponentAny`, Active only;
`optionalCostMeD589.test.ts`). No new op; nothing dropped. **Finished:** Mega Greninja ex ×5, Mega Manectric ex ×2,
Metagross `me04-061`, Dialga `me01-095`.

| Column | `me` built / units (D589) | Standard pool D589 |
|---|---|---|
| Attacks | 757 / 1,039 (+9) | **2,489 / 2,771** |
| Abilities | 81 / 234 (+5) | **457 / 610** |
| Trainers | 92 / 183 | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 771** (762 + 9).

## 🆕 D588 update (engine 0.472.0) — Trainer parameters II (WP22)

17 `me` Trainer printings / 8 texts keyed on eight new registry objects (registry.ts D588 block;
`trainerParamsMeD588.test.ts`): Canari ×3 (Earthen Vessel shape, up to 4 {L} Pokémon), Lillie's Determination ×4 (Lacey
shape on `yourPrizesRemaining` [6]), Misty's Vitality ×2 (`attachFromDeck` Basic {W} 4 `oneTarget` + `trainerEndsTurn`),
Rosa's Encouragement ×3 (`morePrizesThanOpponent` + `attachEnergyFrom` discard `count: 2` with the NEW
`AttachTargetRiders.stage2Only`), Rust Syndicate Grunt ×2 (last-turn-KO gate + `discardEnergy` `opponentChosen`),
Waitress (`attachFromTop` 6 / 1), Hole-Digging Shovel (`discardDeckTop self 2`) and Lumiose Galette (`heal self` 20 +
`recoverOneStatus`). **Dropped:** Pokémon Center Lady (its recovery addresses the healed body — a second `healChosen`
rider). [🆕🆕🆕 D617: BUILT, `healChosen.recoverHealed`.] Dawn ×3 stays WP23. [🆕🆕🆕 D621: BUILT.]

| Column | `me` built / units (D588) | Standard pool D588 |
|---|---|---|
| Attacks | 748 / 1,039 | **2,480 / 2,771** |
| Abilities | 76 / 234 | **452 / 610** |
| Trainers | 92 / 183 (+17) | **356 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 762** (745 + 17).

## 🆕 D587 update (engine 0.471.0) — Trainer parameters I (WP04)

19 `me` Trainer printings / 9 texts keyed on nine new registry objects (registry.ts D587 block;
`trainerParamsMeD587.test.ts`), each a built program's op at the printed parameter: Wondrous Patch ×2 and Philippe ×2
(N's PP Up's `attachEnergyFrom`, {P} Benched / {M} with `count: 2`), Jacinthe ×3 (Poké Vital A's heal, `filter` {P}),
Firebreather ×2 (Shivery Chill's search at {R} / 7), Fighting Gong ×3 (Ethan's Adventure's `anyOf` at 1), Tarragon ×2
(Lana's Aid's `anyOf` retrieval at {F} / 4), Poké Pad ×3 (Master Ball with `noRuleBox`), Energy Swatter (Ortega's
first op, `anyEnergy`) and Repel (`opponentSwitchOut`). Two engine lines: Energy Swatter's caption arm and Repel's
empty-Bench play gate. Nothing dropped from the brief; Premium Power Pro and Iron Defender stay out (WP23). [🆕🆕🆕 D621: Premium Power Pro BUILT; Iron Defender dropped.] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]

| Column | `me` built / units (D587) | Standard pool D587 |
|---|---|---|
| Attacks | 748 / 1,039 | **2,480 / 2,771** |
| Abilities | 76 / 234 | **452 / 610** |
| Trainers | 75 / 183 (+19) | **339 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 745** (726 + 19).

## 🆕 D586 update (engine 0.470.0) — rows on existing condition members (WP03)

8 attack sentences / 17 `me` printings now derive through shipped readers (effects.ts D586 rows;
`conditionRowsMeD586.test.ts`): Abyss Eye (Mega Darkrai ex ×5, a KO anchor on `opponentActiveHasSpecialCondition`),
Limit Break (Zacian ×3, `opponentPrizesRemaining` [0–3]), Counter Jewel (Carbink ×2, [0–2]), Electro / Flare / Crystal
Fall (Raikou, Entei, Suicune, `yourEnergyInPlayAtLeast` 4 {L}/{R}/{W}), Seventh Kick (Medicham ×2, `yourHandExactly` 7),
Infernal Slash (Ceruledge ×2, a cancel-head row). Carbink ×2's "Double Type" is keyed on a {F}{P} copy of Scovillain ex's
`typesInPlay` program. No new vocabulary. The "at least N {T} Energy in play" template stays refused: it would claim
exactly the four literal rows.

| Column | `me` built / units (D586) | Standard pool D586 |
|---|---|---|
| Attacks | 748 / 1,039 (+17) | **2,480 / 2,771** |
| Abilities | 76 / 234 (+2) | **452 / 610** |
| Trainers | 56 / 183 | **320 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 726** (709 + 17). Mega Darkrai ex ×5 is finished. The live `me` attack residue
(`censusAtHead.test.ts` D581 tally) is 178 sentences / 286 printings (from 186 / 303).

## 🆕 D585 update (engine 0.469.0) — parameter copies of passives and Abilities (WP19)

19 `me` printings / 8 texts keyed on eight new registry objects (registry.ts D585 block; `paramCopiesMeD585.test.ts`),
each a built `sv` program's op or field at the printed parameter: Tundra Wall (Aurorus ×2), Wash Out (Dewgong),
Powerful a-Salt (Garganacl ×2), Counterattacking Crest (Mega Scrafty ex ×3), Stone Arms (Barbaracle ×2), Scent
Collection (Aromatisse), Sky Transport (Mega Dragonite ex ×5), Synchro Pulse (Ampharos ×3). No new vocabulary.

| Column | `me` built / units (D585) | Standard pool D585 |
|---|---|---|
| Attacks | 731 / 1,039 | **2,463 / 2,771** |
| Abilities | 74 / 234 (+19) | **450 / 610** |
| Trainers | 56 / 183 | **320 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 709** (690 + 19; each one's attack is already reader-built). Mega Scrafty ex ×3 and
Mega Dragonite ex ×5 are finished.

## 🆕 D584 update (engine 0.468.0) — alias tier 2 (WP01)

18 `me` printings / 11 texts keyed (registry.ts D584 block; `reprintAliasMeD584.test.ts`): Ultra Ball ×2, Zoroark
`30th-096` and Hop's Pincurchin ex `me02.5-068` on existing objects; Cinccino ex ×3, Turtonator, Numel ×2, Toucannon ×2,
Nidorina ×2, Pyroar, Slowpoke and Drifloon ×2 on eight new renamed / parameter / attack-index copies. Heatran `sv06-123`
now logs its own "Incandescent Body".

| Column | `me` built / units (D584) | Standard pool D584 |
|---|---|---|
| Attacks | 731 / 1,039 (+2: Float Up) | **2,463 / 2,771** |
| Abilities | 55 / 234 (+14) | **431 / 610** |
| Trainers | 56 / 183 (+2) | **320 / 447** |
| Special Energy | 3 / 11 | **14 / 22** |

**Fully built `me` printings: 690** (672 + 18; every other attack these Pokémon print is reader-built). Still owed from
the D582 list: "Fade Out" ×5 (Drifblim, Meowth ex ×3, Emolga — other index, other name) [🆕🆕🆕 D593: BUILT, three new objects]. Named, not in WP01: Mega Scrafty
ex ×3 prints Counterattack Quills at "place 5" (a 50 `damageAttacker` copy) [🆕🆕🆕 D585: BUILT, `COUNTERATTACKING_CREST`] and Antique Skull Fossil `me05-073` prints
the "place 3" text on a fossil face [🆕🆕🆕 D637: BUILT, `SPINY_SKULL`].

## 🆕 D583 update (engine 0.467.0) — Special Energy by printed text

The D582 gap *"tcgdex tags every `me` Special Energy `energy_type` Normal"* is closed in the ENGINE: cards.ts
`isSpecialEnergy` reads the printed rules text as well as the tag (14 legal printings: 11 `me`, `sv` Reversal / Prism /
Ignition), and map.ts writes "Special" from the next ingest (neither D1 re-ingested yet). Team Rocket's Energy
`me02.5-217`, the alias D582 refused on its tag alone, is keyed on `sv10-182`'s object.

| Column | `me` built / units (D583) | Standard pool D583 |
|---|---|---|
| Special Energy | 3 / 11 | **14 / 22** |

The other columns stand at D582's. **Fully built `me` printings: 672.** The 8 unbuilt `me` Special Energies are the
eight new ones (Growing Grass, Rocky Fighting, Telepathic Psychic, Bubbly Water, Magnetic Metal, Nitro Fire, Shadowy
Darkness, Voltaic Lightning): each still provides one {C} (the unauthored fallback), now as a Special. [🆕🆕🆕 D604 (D539): WITHDRAWN — all eight are built since D604; each provides its printed type]

## 🆕 D582 update (engine 0.466.0) — the Mega ex rule and the alias tier

The 3-Prize **Mega Evolution ex rule** is built (cards.ts `prizeValueOf` / `isMegaEvolutionPokemonEx`; 133 legal
printings, 41 names). The **reprint-alias tier** keys 99 `me` ids on existing program objects (registry.ts D582
block; `reprintAliasMeD582.test.ts`), and banners.ts marks the five `me02.5` Tera reprints.

| Column | `me` built / units (D582) | Standard pool D582 |
|---|---|---|
| Attacks | 729 / 1,039 (+1: Prism Charge `me02.5-178`) | **2,461 / 2,771** |
| Abilities | 41 / 234 | **417 / 610** |
| Trainers | 54 / 183 | **318 / 447** |
| Special Energy | 2 / 11 | **13 / 22** |

**Fully built `me` printings: 671** (was 576) — 16 basic Energy, 513 Pokémon with derived attacks and no Ability,
49 Mega ex (46 + Mega Chandelure ex ×3 via the alias tier), 37 other aliased Pokémon, 54 Trainers, 2 Special Energy.
D581's "alias-ready" figures, re-measured: of 47 ability units, 6 are NOT aliased (Cinccino ex ×3, Turtonator — the
twin program names its Ability; Numel ×2 — twin Heatran `sv06-123`'s D190 program is Armarouge's and logs "Scorching
Armor"; a renamed copy is owed each) [🆕🆕🆕 D584: all six BUILT on renamed copies; Heatran fixed]; of 3 Special Energy, Team Rocket's Energy `me02.5-217` is not
(tcgdex tags it `energy_type` Normal, its `sv` twin Special) [🆕 D583: aliased]; of 8 attack units, only Prism Charge prints at its twin's
index — "Fade Out" ×5 and "Surf Back" ×2 need a new object each [🆕🆕🆕 D584: Surf Back ×2 BUILT, `FLOAT_UP`] [🆕🆕🆕 D593: Fade Out ×5 BUILT, `BALLOON_RETURN` / `TUCK_TAIL` / `SKY_RETURN`]. **New named gaps:** tcgdex tags every `me` Special
Energy (and three `sv` ones: Reversal, Prism, Ignition) `energy_type` Normal, so the engine's `isSpecialEnergy` answers
false for them and the `basicEnergy` filter ("Basic Energy" searches) admits them [🆕 D583 (D539): WITHDRAWN — see the D583 update]; `me` Tera printings with NEW text (Koraidon ex `me02.5-121` prints the banner) are
not in banners.ts. The sections below are the D581 measurement.

## Headline

| Column | `sv` (built / units) | `me` (built / units) | Standard pool D581 | `me` alias-ready |
|---|---|---|---|---|
| Attacks (Pokémon `attacks_json` units with text) | 1,732 / 1,732 | 728 / 1,039 | **2,460 / 2,771** | 8 (3 sentences) |
| Abilities (Pokémon `abilities_json` units) | 376 / 376 | 0 / 234 | **376 / 610** | 47 by text (32 also by name) |
| Trainers (rows with `effect`) | 264 / 264 | 0 / 183 | **264 / 447** | 54 |
| Special Energy (Energy rows with `effect`) | 11 / 11 | 0 / 11 | **11 / 22** | 3 |

Legal rows: `sv` 2,021 (18 sets) + `me` 1,266 (9 sets; `30th-c` is not Standard-legal) = **3,287**.

- **"Built"** for an attack is the census's four-arm predicate (a reader, the gate splitter,
  the trailing splitter, or a registry row **keyed by the id**). No `me` id is a registry key,
  so the `me` non-attack columns are 0 built. [🆕 D582 (D539): WITHDRAWN — the alias tier keys 99 `me` ids; see the D582 update above.]
- **"Alias-ready"** means the exact printed text is already built on a registry id (of any
  legality), so one registry line naming the `me` id would build it with no new code. For a
  Trainer the whole printed face must match (the four `me` fossils share the fossil rule text
  but print new Abilities, so they are NOT alias-ready) [🆕🆕🆕 D637: all four BUILT on their own objects]. For an Ability, a match by text is
  enough for a `passive`; an activated Ability's program also carries the printed name.
- **Already fully built `me` printings: 576** — 514 Pokémon whose every attack text is claimed
  by an existing reader and that print no Ability, 46 **Mega … ex** printings in the same state
  (the 3-Prize Mega ex rule is D582's, so these are not finished until it lands), and the 16
  basic Energies (no text). An alias tier would add 49 more Pokémon (46 + 3 Mega).
- **Data gaps, named:** three legal `30th` Items (Poké Pad, Switch, Ultra Ball `30th-126`…`-128`)
  carry no `effect` in tcgdex; 43 `me` rows carry tcgdex HTML (`<span class="energy-symbol …">`,
  `<em>`) and 2 carry `[R]`-style tokens in their text — the `sv` rows carry none. Normalising
  that markup at ingest would build 18 of the residue's attack sentences (21 printings) with no
  reader work, and would stop the client from showing the raw tags. [🆕🆕🆕 D612: normalised at ingest and at read on the LOCAL D1 — WP06.] **The `suffix` column**
  is inconsistent across the `me` sets: of the 239 legal `me` "… ex" printings, tcgdex tags
  148 `ex`, 70 `EX` (`30th`, `me04`, `me05`) and 21 none (`me02`), so `/cards?suffix=ex` (the
  deck builder's suffix chip) misses 91 of them, and `/facets` now offers `EX` (plus `GX`,
  `Legend`, `SP`, `V` from the non-legal `30th-c`). The engine is unaffected —
  `pokemonSuffixOf` reads the NAME.

Below: every unbuilt `me` text that is NOT alias-ready, grouped by mechanism (first matching
group wins; the grouping is a reading aid, not a census figure).

## Attacks — 186 unbuilt sentences / 303 printings

### Markup only — builds once tcgdex's HTML / `[X]` tokens are normalised (an ingest fix, not a reader) — 18 text(s) / 21 printing(s)

- 2× Put up to 3 &lt;span class="energy-symbol Dragon" title="Dragon">Dragon&lt;/span> Pokémon from your discard pile onto your Bench. [🆕🆕🆕 D612: BUILT — WP06; R-BC1 UNRULED, any stage may be benched (D238's reading)] [🆕🆕🆕 D613 (D539): WITHDRAWN — bench placement is Basic only unless the noun names its card (cards.ts `benchMatches`); R-BC1 is retired, Booming Call benches Basic {N} Pokémon only]
- 2× This attack also does 20 damage to 1 of your opponent's Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 2× This attack does 30 damage to each of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× Discard 2 &lt;span class="energy-symbol Fighting" title="Fighting">Fighting&lt;/span> Energy from this Pokémon. [🆕🆕🆕 D612: BUILT — WP06]
- 1× Discard 2 &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon. [🆕🆕🆕 D612: BUILT — WP06]
- 1× Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× During your next turn, the Defending Pokémon takes 30 more damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>. [🆕🆕🆕 D612: BUILT — WP06]
- 1× During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage &lt;em>(before applying Weakness and Resistance)&lt;/em>. [🆕🆕🆕 D612: BUILT — WP06]
- 1× During your opponent's next turn, this Pokémon takes 50 less damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>. [🆕🆕🆕 D612: BUILT — WP06]
- 1× During your opponent's next turn, this Pokémon takes 60 less damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>. [🆕🆕🆕 D612: BUILT — WP06]
- 1× If this Pokémon has any &lt;span class="energy-symbol Fire" title="Fire">Fire&lt;/span> Energy attached, this attack does 80 more damage. [🆕🆕🆕 D612: BUILT — WP06]
- 1× If this Pokémon has any &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy attached, this attack does 80 more damage. [🆕🆕🆕 D612: BUILT — WP06]
- 1× If your opponent's Active Pokémon is a Pokémon &lt;em>ex&lt;/em>, this attack does 80 more damage. [🆕🆕🆕 D612: BUILT — WP06]
- 1× Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. &lt;em>(Your opponent chooses the new Active Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× This attack also does 20 damage to each of your Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× This attack also does 60 damage to 1 of your opponent's Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× This attack does 20 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D612: BUILT — WP06]
- 1× This attack does 30 more damage for each &lt;span class="energy-symbol Water" title="Water">Water&lt;/span> Energy attached to this Pokémon. [🆕🆕🆕 D612: BUILT — WP06]

### Knock Out / Prize clauses — 16 text(s) / 36 printing(s)

- 5× If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out. [🆕🆕🆕 D586: BUILT]
- 3× Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out. [🆕🆕🆕 D609: BUILT]
- 3× If your opponent has 3 or fewer Prize cards remaining, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 3× If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out. [🆕🆕🆕 D609: BUILT]
- 3× If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon. [🆕🆕🆕 D639: BUILT — K3]
- 3× This attack does 70 damage for each Prize card you have taken. [🆕🆕🆕 D620: BUILT]
- 2× If any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage. [🆕🆕🆕 D593: BUILT]
- 2× If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck. [🆕🆕🆕 D594: dropped from WP33a — `takePrize` queues behind the program, so the "if you do" shuffle would run first] [🆕🆕🆕 D600: dropped again from WP33b, same reason] [🆕🆕🆕 D639: dropped from R1 — the "If you do" after a queued `takePrizes` stage needs a new post-Prize stage (persisted state)]
- 2× If you have exactly 6 Prize cards remaining, this attack does 200 more damage. [🆕🆕🆕 D594: BUILT]
- 2× If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage. [🆕🆕🆕 D586: BUILT]
- 2× Knock Out each of your opponent's Pokémon that has 50 HP or less remaining. [🆕🆕🆕 D609: WP36 rest] [🆕🆕🆕 D639: BUILT — R1]
- 2× This attack does 80 damage for each Prize card you have taken. [🆕🆕🆕 D620: BUILT]
- 1× During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.
- 1× If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card. [🆕🆕🆕 D609: WP36 rest] [🆕🆕🆕 D639: BUILT — K3]
- 1× This attack does 60 more damage for each Prize card your opponent took during their last turn. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: dropped from WP28b — no state records the Prizes taken during the last turn; a persisted record is an MRV bump] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]

### Damage-counter placement and manipulation — 24 text(s) / 34 printing(s)

- 3× Place 2 damage counters on your opponent's Active Pokémon for each card in your hand. [🆕🆕🆕 D600: BUILT]
- 3× Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1. [🆕🆕🆕 D592: BUILT]
- 2× Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck. [🆕🆕🆕 D605: dropped from WP34 — a deck Pokémon switched in for the attacker needs a new op]
- 2× If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 30. [🆕🆕🆕 D620: BUILT]
- 2× Place 13 damage counters on 1 of your opponent's Pokémon. [🆕🆕🆕 D592: BUILT]
- 2× This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D608: BUILT]
- 2× This attack does 40 damage for each damage counter on all of your Benched Rattata. [🆕🆕🆕 D607: BUILT]
- 2× This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: BUILT]
- 1× Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon. [🆕🆕🆕 D608: BUILT]
- 1× Double the number of damage counters on each of your opponent's Pokémon. [🆕🆕🆕 D609: BUILT]
- 1× During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon. [🆕🆕🆕 D636: BUILT (L1)]
- 1× If any of your Benched Pancham have any damage counters on them, this attack does 120 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon has 2 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness. [🆕🆕🆕 D594: BUILT]
- 1× If this Pokémon has any damage counters on it, this attack can be used for {D}. [🆕🆕🆕 D593: BUILT]
- 1× If you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, choose 2 of your opponent's Pokémon and quadruple the number of damage counters on each of them. [🆕🆕🆕 D627: BUILT]
- 1× If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon. [🆕🆕🆕 D627: BUILT]
- 1× If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon. [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× Place 1 damage counter on 1 of your opponent's Pokémon. [🆕🆕🆕 D609: BUILT]
- 1× Place 1 damage counter on your opponent's Active Pokémon. [🆕🆕🆕 D627: BUILT]
- 1× Place 3 damage counters on your opponent's Active Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Place 5 damage counters on 1 of your opponent's Benched Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Place damage counters on your opponent's Active Pokémon until its remaining HP is 50. [🆕🆕🆕 D592: BUILT]
- 1× This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: BUILT]
- 1× This attack does 40 damage for each of your Pokémon that has "Tauros" in its name that has any damage counters on it. [🆕🆕🆕 D607: BUILT]

### Coin flips — 21 text(s) / 32 printing(s)

- 5× For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D605: BUILT]
- 3× Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck. [🆕🆕🆕 D595: BUILT]
- 2× Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has "Tauros" in its name. This attack does 50 damage to the chosen Pokémon for each heads. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D605: BUILT]
- 2× Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck. [🆕🆕🆕 D605: BUILT]
- 2× Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck. [🆕🆕🆕 D605: dropped from WP34 — the revealed-hand pick goes into the deck; `bottomFromOpponentHand.dest` has no shuffle member] [🆕🆕🆕 D634: BUILT (C1)]
- 2× Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck. [🆕🆕🆕 D605: BUILT]
- 2× Flip a coin until you get tails. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck. [🆕🆕🆕 D595: BUILT]
- 1× During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it. [🆕🆕🆕 D636: BUILT (L1)]
- 1× Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon. [🆕🆕🆕 D595: BUILT]
- 1× Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck. [🆕🆕🆕 D595: dropped from WP13 — the bench search reads "a Pokémon" as a card name; only a Basic may go onto the Bench, so it needs a Basic bench-search arm] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip 2 coins. If both of them are heads, this attack does 100 more damage. [🆕🆕🆕 D595: dropped from WP13 — a bonus behind a coin threshold needs a new `AttackCoinFlip` member] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip 3 coins. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like. [🆕🆕🆕 D595: BUILT]
- 1× Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D595: dropped from WP13 — a deck source capped at the heads count] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip a coin until you get tails. Search your deck for an amount of Basic &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck. [🆕🆕🆕 D595: dropped from WP13 — a deck source capped at the heads count, and WP06's markup] [🆕🆕🆕 D612: the markup is normalised (WP06); the clean text still needs a reader] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck. [🆕🆕🆕 D595: dropped from WP13 — a deck source capped at the heads count] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck. [🆕🆕🆕 D595: dropped from WP13 — `returnBenched` cannot take the Active] [🆕🆕🆕 D634: BUILT (C1)]
- 1× Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition. [🆕🆕🆕 D605: BUILT]
- 1× Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat. [🆕🆕🆕 D595: BUILT]
- 1× Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D595: BUILT]
- 1× Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon. [🆕🆕🆕 D595: BUILT]
- 1× Flip a coin. If tails, during your next turn, this Pokémon can't use attacks. [🆕🆕🆕 D592: BUILT]

### Scaled damage ("… for each …") — 25 text(s) / 50 printing(s)

- 6× This attack does 50 damage for each {P} Energy attached to all of your Pokémon.
- 4× Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 4× You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 3× Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 3× Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: dropped from WP28b — an own-hand pick that moves nothing plus a partial public reveal needs a new op and event] [🆕🆕🆕 D633: BUILT (O1)]
- 3× This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon. [🆕🆕🆕 D607: BUILT]
- 2× Discard any amount of [R] Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT — keyed by id on `INFERNO_X`] [🆕🆕🆕 D612: the text is normalised to {R}, the key retired; reader-built]
- 2× Discard the top 6 cards of your deck, and this attack does 100 damage for each Basic {W} Energy card that you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 2× This attack does 10 damage for each card in your hand. [🆕🆕🆕 D600: BUILT]
- 2× This attack does 110 damage for each of your Beedrill and Beedrill ex in play. [🆕🆕🆕 D607: BUILT]
- 2× This attack does 30 damage for each Energy attached to all Pokémon. [🆕🆕🆕 D607: BUILT]
- 2× This attack does 30 damage for each {P} Energy attached to all of your Pokémon.
- 2× This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: BUILT]
- 2× Your opponent reveals their hand, and this attack does 80 damage for each Energy card you find there. [🆕🆕🆕 D607: BUILT]
- 1× Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W} Energy card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 1× Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 1× Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way. [🆕🆕🆕 D597: BUILT]
- 1× Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards. [🆕🆕🆕 D641: BUILT (W1)]
- 1× This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: BUILT]
- 1× This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: BUILT]
- 1× This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name. [🆕🆕🆕 D635: BUILT (F1)]
- 1× This attack does 40 damage for each Pokémon Tool attached to all Pokémon. [🆕🆕🆕 D607: BUILT]
- 1× This attack does 40 damage for each of your Pikachu and Pikachu &lt;em>ex&lt;/em> in play. [🆕🆕🆕 D607: WP28b] [🆕🆕🆕 D623: BUILT]
- 1× This attack does 60 less damage for each Energy attached to your opponent's Active Pokémon. [🆕🆕🆕 D607: BUILT]
- 1× You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way. [🆕🆕🆕 D633: BUILT (O1)]

### Conditional damage bonus / base change — 22 text(s) / 37 printing(s)

- 5× You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage. [🆕🆕🆕 D589: BUILT]
- 4× If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage. [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 3× If you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, this attack does 140 more damage. [🆕🆕🆕 D627: BUILT]
- 3× If you have no cards in your hand, this attack does 160 more damage. [🆕🆕🆕 D594: BUILT]
- 2× If Rosa's Encouragement is in your discard pile, this attack does 150 more damage. [🆕🆕🆕 D600: BUILT]
- 2× If this Pokémon is Burned or Poisoned, this attack does 100 more damage. [🆕🆕🆕 D593: BUILT]
- 2× If your Benched Pokémon have any Shadowy {D} Energy attached, this attack does 70 more damage. [🆕🆕🆕 D600: BUILT]
- 2× You may discard all Energy from this Pokémon and have this attack do 130 more damage. [🆕🆕🆕 D589: BUILT]
- 1× During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance). [🆕🆕🆕 D619: dropped — a new attacker class on persisted state owes an MRV bump] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 1× During your opponent's next turn, this Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance). [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 1× If this Pokémon evolved from Magneton during this turn, this attack does 120 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon used Spiky Rolling during your last turn, this attack does 80 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage. [🆕🆕🆕 D594: dropped from WP33a — needs a remaining-HP member] [🆕🆕🆕 D600: BUILT]
- 1× If you have any Stage 2 {D} Pokémon on your Bench, this attack does 70 more damage. [🆕🆕🆕 D600: BUILT]
- 1× If you have at least 4 {L} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you have at least 4 {R} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you have at least 4 {W} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you played Emma from your hand during this turn, this attack does 60 more damage. [🆕🆕🆕 D619: BUILT]
- 1× If you played a Supporter card that has "Team Rocket" in its name from your hand during this turn, this attack does 100 more damage. [🆕🆕🆕 D619: BUILT]
- 1× If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage. [🆕🆕🆕 D594: dropped from WP33a — needs a "no Retreat Cost" member] [🆕🆕🆕 D600: BUILT]
- 1× You may discard 3 {M} Energy from this Pokémon and have this attack do 150 more damage. [🆕🆕🆕 D589: BUILT]
- 1× You may shuffle all Energy attached to this Pokémon into your deck and have this attack do 80 more damage. [🆕🆕🆕 D589: BUILT]

### Next-turn effects on either Active (protection, vulnerability, locks) — 6 text(s) / 7 printing(s)

- 2× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon. [🆕🆕🆕 D619: dropped — a new attacker class on persisted state owes an MRV bump] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 1× During your opponent's next turn, Energy can't be attached from your opponent's hand to the Defending Pokémon. [🆕🆕🆕 D636: BUILT (L1)]
- 1× During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen. [🆕🆕🆕 D595: dropped from WP13 — `flipLockAttack` is one coin and field-free] [🆕🆕🆕 D636: BUILT (L1) — `flipLockAttack` gains `coins: 2`]
- 1× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon. [🆕🆕🆕 D619: dropped — a new attacker class on persisted state owes an MRV bump] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 1× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability. [🆕🆕🆕 D619: dropped — a new attacker class on persisted state owes an MRV bump] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 1× The Defending Pokémon's Weakness is now &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> until the end of your next turn. &lt;em>(Apply Weakness as ×2.)&lt;/em> [🆕🆕🆕 D612: the markup is normalised (WP06); the clean text still needs a reader]

### Spread / snipe damage — 15 text(s) / 27 printing(s)

- 6× For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck.
- 3× This attack does 50 damage to each of your opponent's Pokémon &lt;em>ex&lt;/em>. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D608: BUILT]
- 3× This attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: BUILT]
- 2× Discard 2 Energy from this Pokémon, and this attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: BUILT]
- 2× If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack. [🆕🆕🆕 D638: BUILT]
- 2× Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: BUILT]
- 1× Discard all &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em> [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D612: the markup is normalised (WP06); the clean text still needs a reader] [🆕🆕🆕 D629: BUILT]
- 1× If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: dropped and named (S1) — the gate reads the declared attack's cost]
- 1× Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon. [🆕🆕🆕 D615: BUILT — declinable, D443's recorded `moveFloor` approximation]
- 1× This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× This attack does 20 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Your opponent's Active Pokémon is now Asleep. [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× This attack does 50 damage to each of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.) &lt;/em>This Pokémon also does 130 damage to itself. [🆕🆕🆕 D608: WP30 rest] [🆕🆕🆕 D629: BUILT]
- 1× This attack does 70 damage to 1 of your opponent's Pokémon that has any Special Energy attached. (Don't apply Weakness and Resistance for Benched Pokémon.) [🆕🆕🆕 D608: BUILT]

### Energy: attach / accelerate — 6 text(s) / 9 printing(s)

- 3× Shuffle this Pokémon and all attached cards into your deck. [🆕🆕🆕 D590: BUILT]
- 2× Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.
- 1× Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.
- 1× If this Pokémon has no Voltaic {L} Energy attached, this attack does nothing. [🆕🆕🆕 D593: BUILT]
- 1× Put 2 {R} Energy attached to this Pokémon into your hand.
- 1× Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.

### Energy: discard / move / return as a cost or effect — 6 text(s) / 11 printing(s)

- 3× Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon. [🆕🆕🆕 D592: BUILT]
- 3× You may discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed. [🆕🆕🆕 D608: BUILT]
- 2× Discard 4 Basic {R} Energy cards from your hand. If you can't discard 4 cards in this way, this attack does nothing. [🆕🆕🆕 D586: BUILT]
- 1× Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed.
- 1× Discard a &lt;span class="energy-symbol Fire" title="Fire">Fire&lt;/span> Energy, a &lt;span class="energy-symbol Water" title="Water">Water&lt;/span> Energy, and a &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon. [🆕🆕🆕 D612: the markup is normalised (WP06); the clean text still needs a reader]
- 1× Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.

### Hand, deck and discard-pile effects — 21 text(s) / 29 printing(s)

- 3× Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck. [🆕🆕🆕 D615: BUILT]
- 3× Your opponent reveals their hand, and you discard a card you find there. [🆕🆕🆕 D592: BUILT]
- 2× Discard the top 3 cards of your deck and put 1 of them into your hand.
- 2× If you don't have exactly 7 cards in your hand, this attack does nothing. [🆕🆕🆕 D586: BUILT]
- 2× If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.
- 2× Your opponent shuffles their hand into their deck and draws 4 cards. [🆕🆕🆕 D615: BUILT]
- 1× Choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck. [🆕🆕🆕 D592: BUILT]
- 1× Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand. [🆕🆕🆕 D615: BUILT]
- 1× Discard random cards from your opponent's hand until they have 5 cards in their hand.
- 1× Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack. [🆕🆕🆕 D638: BUILT]
- 1× If you played Tarragon from your hand during this turn, discard the top 3 cards of your opponent's deck. [🆕🆕🆕 D619: BUILT]
- 1× If your opponent has a Stadium in play, discard it. If you do, your opponent can't play any Stadium cards from their hand during their next turn. [🆕🆕🆕 D636: BUILT (L1)]
- 1× Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand. Shuffle the other cards back into your deck. [🆕🆕🆕 D615: BUILT]
- 1× Look at the top 9 cards of your deck, and you may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck. [🆕🆕🆕 D615: BUILT]
- 1× Put up to 3 Basic Pokémon from your discard pile onto your Bench. [🆕🆕🆕 D615: BUILT]
- 1× Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× You may discard any number of cards from your hand. [🆕🆕🆕 D633: BUILT (O1)]
- 1× You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.
- 1× Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck.

### Special Conditions — 2 text(s) / 2 printing(s)

- 1× If your opponent's Active Pokémon isn't Confused, this attack does nothing. [🆕🆕🆕 D593: BUILT]
- 1× You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed. [🆕🆕🆕 D633: BUILT (O1)]

### Other — 4 text(s) / 8 printing(s)

- 3× Heal 30 damage from each Pokémon (both yours and your opponent's). [🆕🆕🆕 D615: BUILT]
- 2× Heal 120 damage from 1 of your Benched {P} Pokémon.
- 2× If you don't have Lunatone on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance. [🆕🆕🆕 D594: BUILT]
- 1× This Pokémon does 30 damage to itself. [🆕🆕🆕 D592: BUILT]

## Abilities — 100 unbuilt texts / 187 printings

### Mega Evolution-conditioned ("if you have any … Mega Evolution Pokémon ex in play") — 5 text(s) / 8 printing(s)

- 3× **Excited Turbo** — As often as you like during your turn, if you have any {R} Mega Evolution Pokémon ex in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to 1 of your Benched {R} Pokémon. [🆕🆕🆕 D603: BUILT]
- 2× **Excited Heal** — Once during your turn, if you have any {G} Mega Evolution Pokémon ex in play, you may use this Ability. Heal 60 damage from 1 of your Pokémon. [🆕🆕🆕 D603: BUILT]
- 1× **Excited Dash** — Once during your turn, if this Pokémon is on your Bench, and if you have any Mega Evolution Pokémon ex in play, you may use this Ability. Switch this Pokémon with your Active Pokémon. [🆕🆕🆕 D603: BUILT]
- 1× **Excited Power** — If you have any {D} Mega Evolution Pokémon ex in play, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D603: BUILT]
- 1× **Lustrous Assist** [🆕🆕🆕 D628 (D539): Lustrous Assist BUILT at D628 (A1)] — Once during your turn, when your Mega Latias ex moves from your Bench to the Active Spot, you may use this Ability. Move any amount of Energy from your Benched Pokémon to your Active Pokémon. [🆕🆕🆕 D603: dropped — a gate on a named Active's Bench-to-Active move]

### On-evolve / on-bench / on-move triggers ("when you play this Pokémon …", "when … moves …") — 13 text(s) / 23 printing(s)

- 3× **Last-Ditch Catch** [🆕🆕🆕 D628 (D539): Last-Ditch Catch BUILT at D628 (A1)] — Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has "Last-Ditch" in its name each turn. [🆕🆕🆕 D610: left — a name lock on an `onPlayToBench` trigger]
- 3× **Psychic Draw** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards. [🆕🆕🆕 D590: BUILT]
- 3× **Sandy Flapping** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck. [🆕🆕🆕 D590: NOT BUILT — the KO half needs an Active-Spot / by-attack gate on an `onKnockOut` program] [🆕🆕🆕 D598: the by-attack half exists — `TriggeredAbility.byOpponentAttack`; the Active-Spot gate is still owed] [🆕🆕🆕 D626: BUILT]
- 2× **Cast-Off Shell** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Search your deck for a Shedinja and put it onto your Bench. Then, shuffle your deck. [🆕🆕🆕 D590: BUILT]
- 2× **Enriching Melody** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Heal all damage from 1 of your Pokémon. [🆕🆕🆕 D590: BUILT]
- 2× **Fall Back to Reload** — Once during your turn, when this Pokémon moves from the Active Spot to your Bench, you may use this Ability. Attach up to 2 Basic {W} Energy cards from your hand to this Pokémon. [🆕🆕🆕 D610: left — a hand-attach choice inside the non-parking Active→Bench self sweep] [🆕🆕🆕 D628: dropped again (A1) — the same reason, or a persisted moved-to-Bench stamp] [🆕🆕🆕 D636: BUILT — the persisted stamp `benchedTurn`, MRV 44 → 45]
- 2× **Metal Road** — Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may use this Ability. Move any amount of {M} Energy from your other Pokémon to this Pokémon. [🆕🆕🆕 D610: BUILT]
- 1× **Energized Steps** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Look at the top 4 cards of your deck and attach any number of Basic Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck. [🆕🆕🆕 D590: BUILT]
- 1× **Haphazard Hammer** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon. [🆕🆕🆕 D590: BUILT]
- 1× **Heave-Ho Catcher** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Switch in 1 of your opponent's Benched Pokémon to the Active Spot. [🆕🆕🆕 D590: BUILT]
- 1× **Multiplying Cocoon** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Search your deck for a Silcoon or a Cascoon and put it onto your Bench. Then, shuffle your deck. [🆕🆕🆕 D590: BUILT]
- 1× **Prison Panic** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Make your opponent's Active Pokémon Confused. [🆕🆕🆕 D590: BUILT, behind a confirm]
- 1× **Psychic Draw** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 2 cards. [🆕🆕🆕 D590: BUILT]

### Once-per-turn activated Abilities — 34 text(s) / 65 printing(s)

- 5× **Mortal Shuriken** — Once during your turn, if this Pokémon is in the Active Spot, you may discard a Basic {W} Energy card from your hand in order to use this Ability. Place 6 damage counters on 1 of your opponent's Pokémon. [🆕🆕🆕 D589: BUILT]
- 5× **Sky Transport** — Once during your turn, you may use this Ability. Switch your Active Pokémon with 1 of your Benched Pokémon. [🆕🆕🆕 D585: BUILT]
- 4× **Run Errand** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Draw 2 cards. You can't use more than 1 Run Errand Ability each turn. [🆕🆕🆕 D591: BUILT]
- 3× **Lunar Cycle** — Once during your turn, if you have Solrock in play, you may discard a Basic {F} Energy card from your hand in order to use this Ability. Draw 3 cards. You can't use more than 1 Lunar Cycle Ability each turn. [🆕🆕🆕 D591: BUILT]
- 3× **Nighttime Maneuvers** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Search your deck for a card. Shuffle your deck, then put that card on top of it. [🆕🆕🆕 D611: BUILT]
- 3× **Sinister Surge** — Once during your turn, you may use this Ability. Search your deck for a Basic {D} Energy card and attach it to 1 of your Benched {D} Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, place 2 damage counters on that Pokémon. [🆕🆕🆕 D611: BUILT]
- 2× **Aerial Draw** — Once during your turn, you may use this Ability. Draw a card. [🆕🆕🆕 D584: BUILT]
- 2× **Boisterous Wind** — Once during your turn, you may use this Ability. Flip a coin. If heads, put an Energy attached to your opponent's Active Pokémon into their hand. [🆕🆕🆕 D611: BUILT]
- 2× **Call a Buddy** — Once during your turn, if you have no cards in your hand, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D602: BUILT]
- 2× **Destructive Headbutting** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon. [🆕🆕🆕 D611: BUILT]
- 2× **Evidence Gathering** — Once during your turn, you may use this Ability. Switch a card from your hand with the top card of your deck. [🆕🆕🆕 D611: BUILT]
- 2× **Fermented Juice** — Once during your turn, if this Pokémon has any {G} Energy attached, you may use this Ability. Heal 30 damage from 1 of your Pokémon. [🆕🆕🆕 D602: BUILT]
- 2× **Fiery Flapping** — Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic Fire Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Flash-Pop Flapping** — Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic Lightning Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Frilled Generator** — Once during your turn, if you played Canari from your hand this turn, you may use this Ability. Search your deck for up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck. [🆕🆕🆕 D619: BUILT]
- 2× **Frosty Flapping** — Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic Water Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Gathering of Blossoms** — Once during your turn, you may use this Ability. Search your deck for an Erika's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D602: BUILT]
- 2× **Share Happiness** — Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon. [🆕🆕🆕 D584: BUILT]
- 2× **Sky Hunt** — Once during your turn, you may use this Ability. Flip a coin. If heads, discard a random card from your opponent's hand. [🆕🆕🆕 D611: BUILT]
- 2× **Stone Arms** — Once during your turn, you may use this Ability. Attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon. [🆕🆕🆕 D585: BUILT]
- 1× **Alluring Wings** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Each player draws a card. [🆕🆕🆕 D591: BUILT]
- 1× **Evolutionary Guidance** — Once during your turn, if this Pokémon has any Energy attached, you may use this Ability. Search your deck for an Evolution Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D602: dropped — an untyped per-body Energy gate] [🆕🆕🆕 D611: BUILT]
- 1× **Fiery Flapping** — Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Flaring Magic** — Once during your turn, you may discard a Basic Fire Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand. [🆕🆕🆕 D591: BUILT]
- 1× **Flaring Magic** — Once during your turn, you may discard a Basic {R} Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand. [🆕🆕🆕 D591: BUILT]
- 1× **Flash-Pop Flapping** — Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic {L} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Frosty Flapping** — Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic {W} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Grand Wing** — Once during your turn, you may use this Ability. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 4 cards. [🆕🆕🆕 D611: BUILT]
- 1× **Guiding Dance** — Once during your turn, you may use this Ability. Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D602: BUILT]
- 1× **Lethargic Charge** [🆕🆕🆕 D628 (D539): Lethargic Charge BUILT at D628 (A1)] — Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Attach an Energy card from your hand to your Active Larry's Pokémon. [🆕🆕🆕 D602: dropped — an Active-only attach target] [🆕🆕🆕 D611: dropped again — also a which-Energy-card choice]
- 1× **Lovely Fragrance** — Once during your turn, you may use this Ability. Heal 30 damage from each of your Pokémon. [🆕🆕🆕 D602: BUILT]
- 1× **Scent Collection** — Once during your turn, you may use this Ability. Search your deck for up to 2 Basic {P} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D585: BUILT]
- 1× **Spiteful Evolution** — Once during your turn, you may use this Ability. Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to evolve it. If you do, place 2 damage counters on the Pokémon you evolved in this way. You can't use this Ability during your first turn. [🆕🆕🆕 D611: BUILT]
- 1× **Sunrise** — Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Search your deck for up to 2 Basic Metal Energy cards and attach them to this Pokémon. Then, shuffle your deck. [🆕🆕🆕 D602: BUILT]

### "As often as you like" Energy movers / attachers — 3 text(s) / 6 printing(s)

- 4× **Solar Transfer** — As often as you like during your turn, you may use this Ability. Move a Basic {G} Energy from 1 of your Pokémon to another of your Pokémon. [🆕🆕🆕 D610: BUILT]
- 1× **Bubble Gathering** — As often as you like during your turn, you may use this Ability. Move an Energy from 1 of your other Pokémon to this Pokémon. [🆕🆕🆕 D610: BUILT]
- 1× **Wash Out** — As often as you like during your turn, you may use this Ability. Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon. [🆕🆕🆕 D585: BUILT]

### Knock Out / damage-taken triggers — 14 text(s) / 27 printing(s)

- 5× **Shadowy Concealment** — If 1 of your {D} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, that player takes 1 fewer Prize card. The effect of Shadowy Concealment doesn't stack. [🆕🆕🆕 D598: BUILT]
- 3× **Counterattacking Crest** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 5 damage counters on the Attacking Pokémon. [🆕🆕🆕 D585: BUILT]
- 3× **Tenacious Body** — If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10. [🆕🆕🆕 D598: BUILT]
- 2× **Damp** — Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked Out. [🆕🆕🆕 D632: BUILT (R-DMP1)]
- 2× **Fainting Spell** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out. [🆕🆕🆕 D626: BUILT]
- 2× **Fragile Husk** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, your opponent can't take any Prize cards for it. [🆕🆕🆕 D598: BUILT]
- 2× **Photon Cord** — If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2 Basic {L} Energy cards from this Pokémon to 1 of your Benched Pokémon. [🆕🆕🆕 D626: BUILT]
- 2× **Spiteful Swirl** — If your Active {D} Pokémon is damaged by an attack from your opponent's Pokémon (even if your Active {D} Pokémon is Knocked Out), place 1 damage counter on the Attacking Pokémon. [🆕🆕🆕 D642 (D539): Spiteful Swirl BUILT at D642 (K2).]
- 1× **Counterattack Grouping** — If your Wishiwashi or Wishiwashi ex is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if your Pokémon  is Knocked Out), place 3 damage counters on the Attacking Pokémon. [🆕🆕🆕 D642 (D539): Counterattack Grouping BUILT at D642 (K2).]
- 1× **Counterattack Quills** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon. [🆕🆕🆕 D584: BUILT]
- 1× **Durable Body** — If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10. [🆕🆕🆕 D598: BUILT]
- 1× **Final Chain** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for a card and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D598: BUILT]
- 1× **Infinite Shadow** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put it into your hand instead of the discard pile. (Discard all attached cards.) [🆕🆕🆕 D598: BUILT]
- 1× **Needly Armor** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon for each {G} Energy attached to this Pokémon. [🆕🆕🆕 D594: BUILT]

### Damage modifiers (more / less damage, takes less damage) — 7 text(s) / 12 printing(s)

- 3× **Synchro Pulse** — If you have the same number of cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D585: BUILT]
- 2× **Powerful a-Salt** — Attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D585: BUILT]
- 2× **Thick Fat** — This Pokémon takes 30 less damage from attacks from your opponent's {R} or {W} Pokémon (after applying Weakness and Resistance). [🆕🆕🆕 D619: BUILT]
- 2× **Tundra Wall** — All of your Pokémon that have any {W} Energy attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Tundra Wall doesn't stack. [🆕🆕🆕 D585: BUILT]
- 1× **Gloomy Garbage** — Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage (before applying Weakness and Resistance). [🆕🆕🆕 D631: BUILT]
- 1× **Intimidating Fang** — As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance). [🆕🆕🆕 D584: BUILT]
- 1× **Supreme Overlord** — Attacks used by this Pokémon do 30 more damage to your opponent's Active Pokémon for each Prize card your opponent has taken (before applying Weakness and Resistance). [🆕🆕🆕 D631: BUILT]

### HP, Retreat, type and Energy-provision passives — 8 text(s) / 15 printing(s)

- 3× **Multi Adapter** — Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each. [🆕🆕🆕 D636: not taken — a two-Tool cap and a forced discard when the Ability goes away; owes its own bump (45 → 46)] [🆕🆕🆕 D637: not taken at the fossils' bump either; owes 46 → 47] [🆕🆕🆕 D640 (D539): Multi Adapter still unbuilt, owes 47 → 48.] [🆕🆕🆕 D643 (D539): Multi Adapter BUILT at D643 (47 → 48).]
- 2× **Double Type** — As long as this Pokémon is in play, it is {F} and {P} type. [🆕🆕🆕 D586: BUILT]
- 2× **Scale Up** — If this Pokémon has 6 or more Grass Energy attached, it gets +250 HP. [🆕🆕🆕 D610: BUILT]
- 2× **Slimy Sliding** — When your opponent's Active Pokémon retreats, your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch Pokémon. The effect of Slimy Sliding doesn't stack.
- 2× **Tyrannically Gutsy** — If this Pokémon has any Special Energy attached, it gets +150 HP. [🆕🆕🆕 D610: BUILT]
- 2× **Wild Growth** — Each Basic {G} Energy attached to all of your Pokémon provides {G}{G} Energy. The effect of Wild Growth doesn't stack. [🆕🆕🆕 D610 forward note: Scale Up's "6 or more {G} Energy" counts Energy CARDS (`countAttachedEnergy`, D128 / D391 / R-TRE2); with Wild Growth in play that choice decides whether three Basic {G} reach the threshold — settle it when this is built.]
- 1× **Nighttime Byway** — As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is ColorlessColorless less. [🆕🆕🆕 D584: BUILT]
- 1× **Scale Up** — If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP. [🆕🆕🆕 D610: BUILT]

### Prevention / immunity passives — 6 text(s) / 14 printing(s)

- 4× **Hide 'n' Sneak** — Prevent all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon. (Damage is not an effect.) [🆕🆕🆕 D627: BUILT]
- 4× **Luminous Wing** — Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon. [🆕🆕🆕 D610: left — WP37b (prevent Ability effects)] [🆕🆕🆕 D614: BUILT]
- 3× **Damp** — Pokémon in play (both yours and your opponent's) lose any Ability that requires the Pokémon using it to Knock Out itself. [🆕🆕🆕 D632: BUILT]
- 1× **Dopey Face** — This Pokémon can't be Confused. [🆕🆕🆕 D584: BUILT]
- 1× **Life-Locked** — Your opponent's Active Pokémon can't be healed. [🆕🆕🆕 D631: BUILT]
- 1× **Watchful Eye** — Damage counters on each Pokémon (both yours and your opponent's) can't be moved to other Pokémon. [🆕🆕🆕 D644: BUILT]

### Other passives — 10 text(s) / 17 printing(s)

- 3× **Ancient Bulwark** — As long as this Pokémon is on your Bench, prevent all damage done to each of your Pokémon by attacks from your opponent's Pokémon that have 2 or less Energy attached. [🆕🆕🆕 D631: BUILT]
- 3× **Memory Helix** — This Pokémon can use the attacks of any of your Benched Pokémon. (You still need the necessary Energy to use each attack.) [🆕🆕🆕 D638: BUILT]
- 2× **Holes** — Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon. [🆕🆕🆕 D610: BUILT]
- 2× **Sniper's Eye** — If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon. [🆕🆕🆕 D631: BUILT]
- 2× **Swirling Prose** — As long as this Pokémon is in the Active Spot, whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Confused. [🆕🆕🆕 D610: BUILT]
- 1× **Explosiveness** — If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot. [🆕🆕🆕 D644: BUILT]
- 1× **Fighting Roar** — If your opponent's Active Pokémon is a Pokémon ex, this Pokémon can evolve during your first turn or the turn you play it. [🆕🆕🆕 D594: BUILT]
- 1× **Good Sleep** — If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon. [🆕🆕🆕 D631: BUILT]
- 1× **Startling Drop** — During your opponent's turn, if this Pokémon is discarded from your deck by an effect of an attack or Ability from your opponent's Pokémon, or by an effect of your opponent's Item or Supporter cards, discard the top 8 cards of your opponent's deck. [🆕🆕🆕 D644: BUILT]
- 1× **Supereffective Pheromones** — If you have Volbeat in play, apply Weakness for both Active Pokémon as ×3. [🆕🆕🆕 D644: BUILT]

## Trainers — 67 unbuilt texts / 129 printings

### Item — Mega Evolution-conditioned — 1 text(s) / 3 printing(s)

- 3× **Mega Signal** — Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D603: BUILT]

### Item — 17 text(s) / 30 printing(s)

- 2× **Blowtorch** — You can use this card only if you discard a Basic {R} Energy card from your hand. [🆕🆕🆕 D625: BUILT]

Discard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium in play.
- 2× **Dark Bell** — Both Active non-{D} Pokémon are now Confused. [🆕🆕🆕 D625: BUILT]
- 1× **Energy Swatter** — Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck. [🆕🆕🆕 D587: BUILT]
- 3× **Fighting Gong** — Search your deck for a Basic {F} Energy card or a Basic {F} Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D587: BUILT]
- 1× **Great Haul Net** — Choose 1 or both: [🆕🆕🆕 D625: BUILT]
• Shuffle up to 3 {W} Pokémon from your discard pile into your deck.
• Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.
- 1× **Hole-Digging Shovel** — Discard the top 2 cards of your deck. [🆕🆕🆕 D588: BUILT]
- 2× **Iron Defender** — During your opponent's next turn, all of your {M} Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). (This includes new Pokémon that come into play.) [🆕🆕🆕 D621: dropped — two plays stack on D564's overwritten `sideDamageReduction`] [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44).]
- 2× **Jumbo Ice Cream** — Heal 80 damage from your Active Pokémon that has 3 or more Energy attached. [🆕🆕🆕 D625: BUILT]
- 1× **Lumiose Galette** — Heal 20 damage and remove a Special Condition from your Active Pokémon. [🆕🆕🆕 D588: BUILT]
- 3× **Poké Pad** — Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.) [🆕🆕🆕 D587: BUILT]
- 3× **Premium Power Pro** — During this turn, attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D621: BUILT]
- 1× **Repel** — Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) [🆕🆕🆕 D587: BUILT]
- 2× **Special Red Card** — You can use this card only if your opponent has 3 or fewer Prize cards remaining. [🆕🆕🆕 D625: BUILT]

Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards.
- 1× **Strange Timepiece** — Devolve 1 of your evolved {P} Pokémon by putting any number of Evolution cards on it into your hand. (That Pokémon can't evolve this turn.) [🆕🆕🆕 D625: BUILT]
- 1× **Transformation Tome** — You must play 2 Transformation Tome cards at once. (This effect works one time for 2 cards.) [🆕🆕🆕 D644: BUILT]

Choose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon in play. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon.
- 2× **Ultra Ball** — You can use this card only if you discard 2 other cards from your hand. [🆕🆕🆕 D584: BUILT]
Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- 2× **Wondrous Patch** — Attach a Basic {P} Energy card from your discard pile to 1 of your Benched {P} Pokémon. [🆕🆕🆕 D587: BUILT]

### Pokémon-faced Trainers (fossils, Core Memory) — 5 text(s) / 5 printing(s)

- 1× **Antique Armor Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat. [🆕🆕🆕 D635: dropped — a new fossil id in a stack owes MRV 44 → 45, plus a source-Active rider] [🆕🆕🆕 D636: not taken at L1's bump; owes 45 → 46] [🆕🆕🆕 D637: BUILT]

At any time during your turn, you may discard this card from play.
- 1× **Antique Jaw Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat. [🆕🆕🆕 D635: dropped — a new fossil id in a stack owes MRV 44 → 45] [🆕🆕🆕 D636: not taken at L1's bump; owes 45 → 46] [🆕🆕🆕 D637: BUILT]

At any time during your turn, you may discard this card from play.
- 1× **Antique Sail Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat. [🆕🆕🆕 D635: dropped — a new fossil id in a stack owes MRV 44 → 45, plus a Supporter-only holder shield] [🆕🆕🆕 D636: not taken at L1's bump; owes 45 → 46] [🆕🆕🆕 D637: BUILT]

At any time during your turn, you may discard this card from play.
- 1× **Antique Skull Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat. [🆕🆕🆕 D635: dropped — a new fossil id in a stack owes MRV 44 → 45] [🆕🆕🆕 D636: not taken at L1's bump; owes 45 → 46] [🆕🆕🆕 D637: BUILT]

At any time during your turn, you may discard this card from play.
- 1× **Core Memory** — The Mega Zygarde ex this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) [🆕🆕🆕 D620: BUILT]

### Stadium — Mega Evolution-conditioned — 1 text(s) / 1 printing(s)

- 1× **Ange Floette** — You can put this card into play only if you discard a Prism Tower in play, and you can put this card into play during the same turn you play Prism Tower. [🆕🆕🆕 D642 (D539): Ange Floette BUILT at D642 (Z1).]
Each Mega Floette ex in play (both yours and your opponent's) gets +150 HP. [🆕🆕🆕 D618: dropped — a play gate on Prism Tower in play, a second Stadium the same turn, a named HP bonus]

### Stadium — 11 text(s) / 20 printing(s)

- 2× **Battle Cage** — Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of attacks and Abilities from the opponent's Pokémon. (Damage from attacks is still taken.) [🆕🆕🆕 D606: dropped — a Bench damage-counter shield] [🆕🆕🆕 D618: BUILT]
- 2× **Celebratory Fanfare** — Once during each player's turn, that player may heal 10 damage from each of their Pokémon. If a player healed any damage in this way, their turn ends. [🆕🆕🆕 D606: BUILT]
- 1× **Dizzying Valley** — Confused Pokémon (both yours and your opponent's) don't recover from that Special Condition when they evolve or devolve. [🆕🆕🆕 D606: dropped — Confusion kept through evolution] [🆕🆕🆕 D618: dropped again] [🆕🆕🆕 D642 (D539): Dizzying Valley BUILT at D642 (Z1).]
- 3× **Forest of Vitality** — Each player's {G} Pokémon can evolve into {G} Pokémon during the turn they play those Pokémon, except during their first turn. [🆕🆕🆕 D606: dropped — a same-turn evolution rule] [🆕🆕🆕 D618: BUILT]
- 1× **Fossil Quarry** — Once during each player's turn, that player may search their deck for up to 2 Item cards that have "Antique" in their name and put them onto their Bench. Then, that player shuffles their deck. [🆕🆕🆕 D606: dropped — Antique Items deck-to-Bench] [🆕🆕🆕 D618: dropped again] [🆕🆕🆕 D635: BUILT (F1)]
- 2× **Lumiose City** — Once during each player's turn, that player may search their deck for a Basic Pokémon and put it onto their Bench. Then, that player shuffles their deck. If a player searches their deck in this way, their turn ends. [🆕🆕🆕 D606: BUILT]
- 3× **Mystery Garden** — Once during each player's turn, that player may discard an Energy card from their hand in order to draw cards until they have as many cards in their hand as they have {P} Pokémon in play. [🆕🆕🆕 D606: dropped — a draw-until count source] [🆕🆕🆕 D618: BUILT]
- 1× **Nighttime Mine** — Attacks used by each Tera Pokémon in play (both yours and your opponent's) cost {C} more. [🆕🆕🆕 D606: BUILT]
- 2× **Prism Tower** — Once during each player's turn, that player may discard 2 cards from their hand in order to draw a card. [🆕🆕🆕 D606: BUILT]
- 1× **Risky Ruins** — Whenever any player puts a Basic non-{D} Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon. [🆕🆕🆕 D606: dropped — an on-Bench Stadium trigger] [🆕🆕🆕 D618: dropped again] [🆕🆕🆕 D642 (D539): Risky Ruins BUILT at D642 (Z1).]
- 2× **Surfing Beach** — Once during each player's turn, that player may switch their Active {W} Pokémon with 1 of their Benched {W} Pokémon. [🆕🆕🆕 D606: BUILT]

### Supporter — Mega Evolution-conditioned — 2 text(s) / 4 printing(s)

- 1× **Jett** — Draw a card for each of your opponent's Mega Evolution Pokémon ex in play. [🆕🆕🆕 D603: BUILT]
- 3× **Wally's Compassion** — Heal all damage from 1 of your Mega Evolution Pokémon ex. If you healed any damage in this way, put all Energy attached to that Pokémon into your hand. [🆕🆕🆕 D603: dropped — all Energy to the hand from the healed body] [🆕🆕🆕 D625: BUILT]

### Supporter — 22 text(s) / 55 printing(s)

- 3× **AZ's Tranquility** — Switch your Active Pokémon with 1 of your Benched Pokémon. If you moved a Pokémon ex to your Bench in this way, heal 80 damage from that Pokémon. [🆕🆕🆕 D599: DROPPED — heal the demoted body, gated on it being an ex] [🆕🆕🆕 D617: BUILT]
- 4× **Acerola's Mischief** — You can use this card only if your opponent has 2 or fewer Prize cards remaining.

Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's Pokémon ex. [🆕🆕🆕 D621: BUILT]
- 2× **Anthea & Concordia** — You can use this card only if you have N's Darmanitan, N's Zoroark ex, N's Vanilluxe, N's Klinklang, N's Reshiram, and N's Zekrom in play.

During this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your N's Pokémon, take 3 more Prize cards. [🆕🆕🆕 D599: BUILT]
- 3× **Canari** — You can use this card only if you discard another card from your hand.

Search your deck for up to 4 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D588: BUILT]
- 3× **Dawn** — Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D621: BUILT]
- 2× **Emma** — Your opponent reveals their hand, and you draw a card for each Pokémon you find there. [🆕🆕🆕 D599: BUILT]
- 2× **Firebreather** — Search your deck for up to 7 Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D587: BUILT]
- 3× **Gladion's Final Battle** — You can use this card only when it is the last card in your hand.
During this turn, attacks used by your Pokémon that don't have a Rule Box do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). (Pokémon ex, Pokémon V, etc. have Rule Boxes.) [🆕🆕🆕 D599: DROPPED — the last-card gate ships (D554); the side bonus needs an attacker filter] [🆕🆕🆕 D621: BUILT, `SideAttackBonus.attacker`]
- 2× **Grimsley's Move** — Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck. You can't use this card during your first turn. [🆕🆕🆕 D599: DROPPED — a "not your first turn" play gate] [🆕🆕🆕 D617: BUILT]
- 3× **Gwynn** — Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way. (Pokémon ex, Pokémon V, etc. have Rule Boxes.) [🆕🆕🆕 D599: DROPPED — a draw per recorded card] [🆕🆕🆕 D617: BUILT]
- 3× **Jacinthe** — Heal 150 damage from 1 of your {P} Pokémon. [🆕🆕🆕 D587: BUILT]
- 4× **Lillie's Determination** — Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead. [🆕🆕🆕 D588: BUILT]
- 3× **Lt. Surge's Bargain** — Ask your opponent if each player may take a Prize card. If yes, each player takes a Prize card. If no, you draw 4 cards. [🆕🆕🆕 D641: BUILT (Y1b)]
- 2× **Misty's Vitality** — Search your deck for up to 4 Basic {W} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. Your turn ends. [🆕🆕🆕 D588: BUILT]
- 2× **Naveen** — Draw cards until you have 5 cards in your hand. Before drawing cards, you may discard any number of cards from your hand. (If you can't draw any cards in this way, you can't use this card.) [🆕🆕🆕 D599: DROPPED — an uncapped declinable hand discard and a deck-not-empty gate] [🆕🆕🆕 D617: BUILT]
- 2× **Philippe** — Attach up to 2 Basic {M} Energy cards from your discard pile to 1 of your {M} Pokémon. [🆕🆕🆕 D587: BUILT]
- 1× **Pokémon Center Lady** — Heal 60 damage from 1 of your Pokémon, and it recovers from all Special Conditions. [🆕🆕🆕 D588: DROPPED — the recovery addresses the healed body; needs a `healChosen` rider] [🆕🆕🆕 D617: BUILT]
- 3× **Rosa's Encouragement** — You can use this card only if you have more Prize cards remaining than your opponent.

Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon. [🆕🆕🆕 D588: BUILT]
- 3× **Roxie's Performance** — During your opponent's next turn, their Poisoned Pokémon can't retreat. (This includes newly Poisoned Pokémon.) [🆕🆕🆕 D621: BUILT]
- 2× **Rust Syndicate Grunt** — You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.

Discard an Energy from 1 of your opponent's Pokémon. [🆕🆕🆕 D588: BUILT]
- 2× **Tarragon** — Put up to 4 in any combination of {F} Pokémon and Basic {F} Energy cards from your discard pile into your hand. [🆕🆕🆕 D587: BUILT]
- 1× **Waitress** — Look at the top 6 cards of your deck and attach a Basic Energy card you find there to 1 of your Pokémon. Shuffle the other cards back into your deck. [🆕🆕🆕 D588: BUILT]

### Tool — Mega Evolution-conditioned — 1 text(s) / 2 printing(s)

- 2× **Tremendous Bomb** — If the Pokémon this card is attached to isn't a Mega Evolution Pokémon ex, is in the Active Spot, and takes 240 or more damage from an attack from your opponent's Mega Evolution Pokémon ex (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card. [🆕🆕🆕 D620: BUILT]

### Tool — 7 text(s) / 9 printing(s)

- 1× **Adversity Policy** — If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type, is in the Active Spot, and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 3 cards. [🆕🆕🆕 D620: dropped — a holder-has-Weakness-to-the-opponent's-Active gate, a new `BoardCondition` member] [🆕🆕🆕 D626: BUILT]
- 1× **Backtrack Badge** — Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results of those coin flips and begin flipping those coins again. [🆕🆕🆕 D644: dropped and named — the re-flip needs a persisted mid-attack park; waits for an MRV slice]
- 1× **Light Ball** — Attacks used by the Pikachu ex this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance). [🆕🆕🆕 D620: BUILT]
- 2× **Punk Helmet** — If the {D} Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon. [🆕🆕🆕 D620: BUILT]
- 2× **Sacred Charm** — The Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon that have an Ability (after applying Weakness and Resistance). [🆕🆕🆕 D619: BUILT]
- 1× **Team Rocket's Hypnotizer** — If the Team Rocket's Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Team Rocket's Pokémon is Knocked Out), the Attacking Pokémon is now Asleep. [🆕🆕🆕 D620: BUILT]
- 1× **Thick Scale** — The {N} Pokémon this card is attached to takes 50 less damage from attacks from your opponent's {G}, {R}, {W}, or {L} Pokémon (after applying Weakness and Resistance). [🆕🆕🆕 D619: BUILT]

## Special Energy — 8 unbuilt texts / 8 printings [🆕🆕🆕 D604: all 8 BUILT — see the D604 update]

### The Mega Evolution typed Special Energies — 8 text(s) / 8 printing(s)

- 1× **Growing Grass Energy** — As long as this card is attached to a Pokémon, it provides {G} Energy.
The {G} Pokémon this card is attached to gets +20 HP.
- 1× **Rocky Fighting Energy** — As long as this card is attached to a Pokémon, it provides {F} Energy.
Prevent all effects of attacks used by your opponent's Pokémon done to the {F} Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)
- 1× **Telepathic Psychic Energy** — As long as this card is attached to a Pokémon, it provides {P} Energy.
When you attach this card from your hand to a {P} Pokémon, search your deck for up to 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck.
- 1× **Bubbly Water Energy** — As long as this card is attached to a Pokémon, it provides {W} Energy.

The {W} Pokémon this card is attached to recovers from all Special Conditions and can't be affected by any Special Conditions.
- 1× **Magnetic Metal Energy** — As long as this card is attached to a Pokémon, it provides {M} Energy.

The {M} Pokémon this card is attached to has no Retreat Cost.
- 1× **Nitro Fire Energy** — As long as this card is attached to a Pokémon, it provides {R} Energy.

If this card is discarded by an effect of an attack used by the {R} Pokémon this card is attached to, put this card into your hand after attack damage and effects.
- 1× **Shadowy Darkness Energy** — As long as this card is attached to a Pokémon, it provides {D} Energy.

As long as the {D} Pokémon this card is attached to is on your Bench, prevent all damage done to it by attacks from your opponent's Pokémon.
- 1× **Voltaic Lightning Energy** — As long as this card is attached to a Pokémon, it provides {L} Energy.

Attacks used by the {L} Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).
