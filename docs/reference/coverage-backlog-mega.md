# Simulator coverage — the MEGA EVOLUTION serie backlog (D581, 2026-10-07)

> The `me` serie's legal printings, measured against the **LOCAL D1** right after D581
> ingested it (`apps/api/.wrangler/state/v3/d1/…/8437d866….sqlite`; the remote D1 has not
> been re-ingested). Engine **0.465.0**. The `sv` serie's census is
> `coverage-backlog-legal.md`; its pool is unchanged and whole. The suite-side figures are
> `censusAtHead.test.ts`'s D581 block and `censusAttackCorpusMe.ts`.

## 🆕 D593 update (engine 0.477.0) — more clause rows and the "Fade Out" objects (WP07)

9 attack texts / 15 `me` printings (`clauseRowsMeD593.test.ts`). Seven clause rows on shipped members: Master's Punch
(Benched Pancham damaged), Horrifying Revenge ×2 (a Hop's Pokémon KO'd by an attack last turn), Upper Spark (evolved from
Magneton this turn), Spiky Rolling (used Spiky Rolling last turn), Giga Railgun (needs Voltaic Lightning Energy attached),
Brain Crush (opponent's Active Confused), plus Facade ×2 on the one new member `yourActiveBurnedOrPoisoned`. Cutting
Riposte is the eighth `ATTACK_GATE_CLAUSES` row (`alternateCostIf` at {D}). "Fade Out" ×5 is keyed on three new
attack-only objects named for the printed attack (Balloon Return, Tuck Tail ×3, Sky Return). Nothing dropped. **Finished:**
Pangoro, Hop's Trevenant ×2, Magnezone, Crawdaunt, Vikavolt, Larry's Staraptor ×2, Togedemaru ex, Malamar, Drifblim, Emolga.
Meowth ex ×3 still waits on its Ability, Last-Ditch Catch. Voltaic Lightning Energy itself is unbuilt (it provides {C}).

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
(Terminal Period), Miraidon `mep-082`, Annihilape `me05-041` and Gengar ex ×2 (an Ability each). Five other `me` sentences
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
"Hail" (tcgdex's `<em>` markup, WP06).

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
Flapping" (its KO half needs an Active-Spot / by-attack gate on an `onKnockOut` program). **Finished:** Kadabra, Brambleghast,
Grumpig, Hariyama, Ninjask ×2, Primarina ×2, Silcoon, Tinkatuff, Lokix `me02-010`. Alakazam ×3 still waits on "Powerful
Hand" (WP14). Named deviations: Heave-Ho Catcher's forced `gust` (no decline; Defiant Horn's row), and the three
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
rider). Dawn ×3 stays WP23.

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
empty-Bench play gate. Nothing dropped from the brief; Premium Power Pro and Iron Defender stay out (WP23).

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
the "place 3" text on a fossil face.

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
Darkness, Voltaic Lightning): each still provides one {C} (the unauthored fallback), now as a Special.

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
  but print new Abilities, so they are NOT alias-ready). For an Ability, a match by text is
  enough for a `passive`; an activated Ability's program also carries the printed name.
- **Already fully built `me` printings: 576** — 514 Pokémon whose every attack text is claimed
  by an existing reader and that print no Ability, 46 **Mega … ex** printings in the same state
  (the 3-Prize Mega ex rule is D582's, so these are not finished until it lands), and the 16
  basic Energies (no text). An alias tier would add 49 more Pokémon (46 + 3 Mega).
- **Data gaps, named:** three legal `30th` Items (Poké Pad, Switch, Ultra Ball `30th-126`…`-128`)
  carry no `effect` in tcgdex; 43 `me` rows carry tcgdex HTML (`<span class="energy-symbol …">`,
  `<em>`) and 2 carry `[R]`-style tokens in their text — the `sv` rows carry none. Normalising
  that markup at ingest would build 18 of the residue's attack sentences (21 printings) with no
  reader work, and would stop the client from showing the raw tags. **The `suffix` column**
  is inconsistent across the `me` sets: of the 239 legal `me` "… ex" printings, tcgdex tags
  148 `ex`, 70 `EX` (`30th`, `me04`, `me05`) and 21 none (`me02`), so `/cards?suffix=ex` (the
  deck builder's suffix chip) misses 91 of them, and `/facets` now offers `EX` (plus `GX`,
  `Legend`, `SP`, `V` from the non-legal `30th-c`). The engine is unaffected —
  `pokemonSuffixOf` reads the NAME.

Below: every unbuilt `me` text that is NOT alias-ready, grouped by mechanism (first matching
group wins; the grouping is a reading aid, not a census figure).

## Attacks — 186 unbuilt sentences / 303 printings

### Markup only — builds once tcgdex's HTML / `[X]` tokens are normalised (an ingest fix, not a reader) — 18 text(s) / 21 printing(s)

- 2× Put up to 3 &lt;span class="energy-symbol Dragon" title="Dragon">Dragon&lt;/span> Pokémon from your discard pile onto your Bench.
- 2× This attack also does 20 damage to 1 of your opponent's Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 2× This attack does 30 damage to each of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× Discard 2 &lt;span class="energy-symbol Fighting" title="Fighting">Fighting&lt;/span> Energy from this Pokémon.
- 1× Discard 2 &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon.
- 1× Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× During your next turn, the Defending Pokémon takes 30 more damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>.
- 1× During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage &lt;em>(before applying Weakness and Resistance)&lt;/em>.
- 1× During your opponent's next turn, this Pokémon takes 50 less damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>.
- 1× During your opponent's next turn, this Pokémon takes 60 less damage from attacks &lt;em>(after applying Weakness and Resistance)&lt;/em>.
- 1× If this Pokémon has any &lt;span class="energy-symbol Fire" title="Fire">Fire&lt;/span> Energy attached, this attack does 80 more damage.
- 1× If this Pokémon has any &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy attached, this attack does 80 more damage.
- 1× If your opponent's Active Pokémon is a Pokémon &lt;em>ex&lt;/em>, this attack does 80 more damage.
- 1× Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. &lt;em>(Your opponent chooses the new Active Pokémon.)&lt;/em>
- 1× This attack also does 20 damage to each of your Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× This attack also does 60 damage to 1 of your opponent's Benched Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× This attack does 20 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× This attack does 30 more damage for each &lt;span class="energy-symbol Water" title="Water">Water&lt;/span> Energy attached to this Pokémon.

### Knock Out / Prize clauses — 16 text(s) / 36 printing(s)

- 5× If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out. [🆕🆕🆕 D586: BUILT]
- 3× Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out.
- 3× If your opponent has 3 or fewer Prize cards remaining, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 3× If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.
- 3× If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.
- 3× This attack does 70 damage for each Prize card you have taken.
- 2× If any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage. [🆕🆕🆕 D593: BUILT]
- 2× If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.
- 2× If you have exactly 6 Prize cards remaining, this attack does 200 more damage.
- 2× If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage. [🆕🆕🆕 D586: BUILT]
- 2× Knock Out each of your opponent's Pokémon that has 50 HP or less remaining.
- 2× This attack does 80 damage for each Prize card you have taken.
- 1× During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.
- 1× If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card.
- 1× This attack does 60 more damage for each Prize card your opponent took during their last turn.

### Damage-counter placement and manipulation — 24 text(s) / 34 printing(s)

- 3× Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.
- 3× Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1. [🆕🆕🆕 D592: BUILT]
- 2× Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.
- 2× If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 30.
- 2× Place 13 damage counters on 1 of your opponent's Pokémon. [🆕🆕🆕 D592: BUILT]
- 2× This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 2× This attack does 40 damage for each damage counter on all of your Benched Rattata.
- 2× This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it.
- 1× Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon.
- 1× Double the number of damage counters on each of your opponent's Pokémon.
- 1× During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon.
- 1× If any of your Benched Pancham have any damage counters on them, this attack does 120 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon has 2 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness.
- 1× If this Pokémon has any damage counters on it, this attack can be used for {D}. [🆕🆕🆕 D593: BUILT]
- 1× If you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, choose 2 of your opponent's Pokémon and quadruple the number of damage counters on each of them.
- 1× If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon.
- 1× If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.
- 1× Place 1 damage counter on 1 of your opponent's Pokémon.
- 1× Place 1 damage counter on your opponent's Active Pokémon.
- 1× Place 3 damage counters on your opponent's Active Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Place 5 damage counters on 1 of your opponent's Benched Pokémon. [🆕🆕🆕 D592: BUILT]
- 1× Place damage counters on your opponent's Active Pokémon until its remaining HP is 50. [🆕🆕🆕 D592: BUILT]
- 1× This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× This attack does 40 damage for each of your Pokémon that has "Tauros" in its name that has any damage counters on it.

### Coin flips — 21 text(s) / 32 printing(s)

- 5× For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 3× Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.
- 2× Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has "Tauros" in its name. This attack does 50 damage to the chosen Pokémon for each heads. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 2× Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.
- 2× Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck.
- 2× Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck.
- 2× Flip a coin until you get tails. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck.
- 1× During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it.
- 1× Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon.
- 1× Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.
- 1× Flip 2 coins. If both of them are heads, this attack does 100 more damage.
- 1× Flip 3 coins. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like.
- 1× Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck.
- 1× Flip a coin until you get tails. Search your deck for an amount of Basic &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.
- 1× Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.
- 1× Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck.
- 1× Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.
- 1× Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.
- 1× Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck.
- 1× Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon.
- 1× Flip a coin. If tails, during your next turn, this Pokémon can't use attacks. [🆕🆕🆕 D592: BUILT]

### Scaled damage ("… for each …") — 25 text(s) / 50 printing(s)

- 6× This attack does 50 damage for each {P} Energy attached to all of your Pokémon.
- 4× Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.
- 4× You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.
- 3× Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card you discarded in this way.
- 3× Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.
- 3× This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon.
- 2× Discard any amount of [R] Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.
- 2× Discard the top 6 cards of your deck, and this attack does 100 damage for each Basic {W} Energy card that you discarded in this way.
- 2× This attack does 10 damage for each card in your hand.
- 2× This attack does 110 damage for each of your Beedrill and Beedrill ex in play.
- 2× This attack does 30 damage for each Energy attached to all Pokémon.
- 2× This attack does 30 damage for each {P} Energy attached to all of your Pokémon.
- 2× This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached.
- 2× Your opponent reveals their hand, and this attack does 80 damage for each Energy card you find there.
- 1× Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W} Energy card you discarded in this way.
- 1× Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way.
- 1× Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way.
- 1× Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards.
- 1× This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck.
- 1× This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30.
- 1× This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name.
- 1× This attack does 40 damage for each Pokémon Tool attached to all Pokémon.
- 1× This attack does 40 damage for each of your Pikachu and Pikachu &lt;em>ex&lt;/em> in play.
- 1× This attack does 60 less damage for each Energy attached to your opponent's Active Pokémon.
- 1× You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.

### Conditional damage bonus / base change — 22 text(s) / 37 printing(s)

- 5× You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage. [🆕🆕🆕 D589: BUILT]
- 4× If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage.
- 3× If you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, this attack does 140 more damage.
- 3× If you have no cards in your hand, this attack does 160 more damage.
- 2× If Rosa's Encouragement is in your discard pile, this attack does 150 more damage.
- 2× If this Pokémon is Burned or Poisoned, this attack does 100 more damage. [🆕🆕🆕 D593: BUILT]
- 2× If your Benched Pokémon have any Shadowy {D} Energy attached, this attack does 70 more damage.
- 2× You may discard all Energy from this Pokémon and have this attack do 130 more damage. [🆕🆕🆕 D589: BUILT]
- 1× During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance).
- 1× During your opponent's next turn, this Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance).
- 1× If this Pokémon evolved from Magneton during this turn, this attack does 120 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon used Spiky Rolling during your last turn, this attack does 80 more damage. [🆕🆕🆕 D593: BUILT]
- 1× If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage.
- 1× If you have any Stage 2 {D} Pokémon on your Bench, this attack does 70 more damage.
- 1× If you have at least 4 {L} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you have at least 4 {R} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you have at least 4 {W} Energy in play, this attack does 90 more damage. [🆕🆕🆕 D586: BUILT]
- 1× If you played Emma from your hand during this turn, this attack does 60 more damage.
- 1× If you played a Supporter card that has "Team Rocket" in its name from your hand during this turn, this attack does 100 more damage.
- 1× If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage.
- 1× You may discard 3 {M} Energy from this Pokémon and have this attack do 150 more damage. [🆕🆕🆕 D589: BUILT]
- 1× You may shuffle all Energy attached to this Pokémon into your deck and have this attack do 80 more damage. [🆕🆕🆕 D589: BUILT]

### Next-turn effects on either Active (protection, vulnerability, locks) — 6 text(s) / 7 printing(s)

- 2× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon.
- 1× During your opponent's next turn, Energy can't be attached from your opponent's hand to the Defending Pokémon.
- 1× During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen.
- 1× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon.
- 1× During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability.
- 1× The Defending Pokémon's Weakness is now &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> until the end of your next turn. &lt;em>(Apply Weakness as ×2.)&lt;/em>

### Spread / snipe damage — 15 text(s) / 27 printing(s)

- 6× For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck.
- 3× This attack does 50 damage to each of your opponent's Pokémon &lt;em>ex&lt;/em>. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 3× This attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 2× Discard 2 Energy from this Pokémon, and this attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 2× If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.
- 2× Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× Discard all &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.)&lt;/em>
- 1× If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.
- 1× This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× This attack does 20 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Your opponent's Active Pokémon is now Asleep.
- 1× This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
- 1× This attack does 50 damage to each of your opponent's Pokémon. &lt;em>(Don't apply Weakness and Resistance for Benched Pokémon.) &lt;/em>This Pokémon also does 130 damage to itself.
- 1× This attack does 70 damage to 1 of your opponent's Pokémon that has any Special Energy attached. (Don't apply Weakness and Resistance for Benched Pokémon.)

### Energy: attach / accelerate — 6 text(s) / 9 printing(s)

- 3× Shuffle this Pokémon and all attached cards into your deck. [🆕🆕🆕 D590: BUILT]
- 2× Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.
- 1× Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.
- 1× If this Pokémon has no Voltaic {L} Energy attached, this attack does nothing. [🆕🆕🆕 D593: BUILT]
- 1× Put 2 {R} Energy attached to this Pokémon into your hand.
- 1× Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.

### Energy: discard / move / return as a cost or effect — 6 text(s) / 11 printing(s)

- 3× Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon. [🆕🆕🆕 D592: BUILT]
- 3× You may discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed.
- 2× Discard 4 Basic {R} Energy cards from your hand. If you can't discard 4 cards in this way, this attack does nothing. [🆕🆕🆕 D586: BUILT]
- 1× Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed.
- 1× Discard a &lt;span class="energy-symbol Fire" title="Fire">Fire&lt;/span> Energy, a &lt;span class="energy-symbol Water" title="Water">Water&lt;/span> Energy, and a &lt;span class="energy-symbol Lightning" title="Lightning">Lightning&lt;/span> Energy from this Pokémon.
- 1× Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.

### Hand, deck and discard-pile effects — 21 text(s) / 29 printing(s)

- 3× Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck.
- 3× Your opponent reveals their hand, and you discard a card you find there. [🆕🆕🆕 D592: BUILT]
- 2× Discard the top 3 cards of your deck and put 1 of them into your hand.
- 2× If you don't have exactly 7 cards in your hand, this attack does nothing. [🆕🆕🆕 D586: BUILT]
- 2× If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.
- 2× Your opponent shuffles their hand into their deck and draws 4 cards.
- 1× Choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck. [🆕🆕🆕 D592: BUILT]
- 1× Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.
- 1× Discard random cards from your opponent's hand until they have 5 cards in their hand.
- 1× Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack.
- 1× If you played Tarragon from your hand during this turn, discard the top 3 cards of your opponent's deck.
- 1× If your opponent has a Stadium in play, discard it. If you do, your opponent can't play any Stadium cards from their hand during their next turn.
- 1× Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand. Shuffle the other cards back into your deck.
- 1× Look at the top 9 cards of your deck, and you may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.
- 1× Put up to 3 Basic Pokémon from your discard pile onto your Bench.
- 1× Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck.
- 1× You may discard any number of cards from your hand.
- 1× You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.
- 1× Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck.

### Special Conditions — 2 text(s) / 2 printing(s)

- 1× If your opponent's Active Pokémon isn't Confused, this attack does nothing. [🆕🆕🆕 D593: BUILT]
- 1× You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed.

### Other — 4 text(s) / 8 printing(s)

- 3× Heal 30 damage from each Pokémon (both yours and your opponent's).
- 2× Heal 120 damage from 1 of your Benched {P} Pokémon.
- 2× If you don't have Lunatone on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.
- 1× This Pokémon does 30 damage to itself. [🆕🆕🆕 D592: BUILT]

## Abilities — 100 unbuilt texts / 187 printings

### Mega Evolution-conditioned ("if you have any … Mega Evolution Pokémon ex in play") — 5 text(s) / 8 printing(s)

- 3× **Excited Turbo** — As often as you like during your turn, if you have any {R} Mega Evolution Pokémon ex in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to 1 of your Benched {R} Pokémon.
- 2× **Excited Heal** — Once during your turn, if you have any {G} Mega Evolution Pokémon ex in play, you may use this Ability. Heal 60 damage from 1 of your Pokémon.
- 1× **Excited Dash** — Once during your turn, if this Pokémon is on your Bench, and if you have any Mega Evolution Pokémon ex in play, you may use this Ability. Switch this Pokémon with your Active Pokémon.
- 1× **Excited Power** — If you have any {D} Mega Evolution Pokémon ex in play, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).
- 1× **Lustrous Assist** — Once during your turn, when your Mega Latias ex moves from your Bench to the Active Spot, you may use this Ability. Move any amount of Energy from your Benched Pokémon to your Active Pokémon.

### On-evolve / on-bench / on-move triggers ("when you play this Pokémon …", "when … moves …") — 13 text(s) / 23 printing(s)

- 3× **Last-Ditch Catch** — Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has "Last-Ditch" in its name each turn.
- 3× **Psychic Draw** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards. [🆕🆕🆕 D590: BUILT]
- 3× **Sandy Flapping** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck. [🆕🆕🆕 D590: NOT BUILT — the KO half needs an Active-Spot / by-attack gate on an `onKnockOut` program]
- 2× **Cast-Off Shell** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Search your deck for a Shedinja and put it onto your Bench. Then, shuffle your deck. [🆕🆕🆕 D590: BUILT]
- 2× **Enriching Melody** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Heal all damage from 1 of your Pokémon. [🆕🆕🆕 D590: BUILT]
- 2× **Fall Back to Reload** — Once during your turn, when this Pokémon moves from the Active Spot to your Bench, you may use this Ability. Attach up to 2 Basic {W} Energy cards from your hand to this Pokémon.
- 2× **Metal Road** — Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may use this Ability. Move any amount of {M} Energy from your other Pokémon to this Pokémon.
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
- 3× **Nighttime Maneuvers** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Search your deck for a card. Shuffle your deck, then put that card on top of it.
- 3× **Sinister Surge** — Once during your turn, you may use this Ability. Search your deck for a Basic {D} Energy card and attach it to 1 of your Benched {D} Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, place 2 damage counters on that Pokémon.
- 2× **Aerial Draw** — Once during your turn, you may use this Ability. Draw a card. [🆕🆕🆕 D584: BUILT]
- 2× **Boisterous Wind** — Once during your turn, you may use this Ability. Flip a coin. If heads, put an Energy attached to your opponent's Active Pokémon into their hand.
- 2× **Call a Buddy** — Once during your turn, if you have no cards in your hand, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.
- 2× **Destructive Headbutting** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.
- 2× **Evidence Gathering** — Once during your turn, you may use this Ability. Switch a card from your hand with the top card of your deck.
- 2× **Fermented Juice** — Once during your turn, if this Pokémon has any {G} Energy attached, you may use this Ability. Heal 30 damage from 1 of your Pokémon.
- 2× **Fiery Flapping** — Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic Fire Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Flash-Pop Flapping** — Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic Lightning Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Frilled Generator** — Once during your turn, if you played Canari from your hand this turn, you may use this Ability. Search your deck for up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck.
- 2× **Frosty Flapping** — Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic Water Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 2× **Gathering of Blossoms** — Once during your turn, you may use this Ability. Search your deck for an Erika's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- 2× **Share Happiness** — Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon. [🆕🆕🆕 D584: BUILT]
- 2× **Sky Hunt** — Once during your turn, you may use this Ability. Flip a coin. If heads, discard a random card from your opponent's hand.
- 2× **Stone Arms** — Once during your turn, you may use this Ability. Attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon. [🆕🆕🆕 D585: BUILT]
- 1× **Alluring Wings** — Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Each player draws a card. [🆕🆕🆕 D591: BUILT]
- 1× **Evolutionary Guidance** — Once during your turn, if this Pokémon has any Energy attached, you may use this Ability. Search your deck for an Evolution Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- 1× **Fiery Flapping** — Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Flaring Magic** — Once during your turn, you may discard a Basic Fire Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand. [🆕🆕🆕 D591: BUILT]
- 1× **Flaring Magic** — Once during your turn, you may discard a Basic {R} Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand. [🆕🆕🆕 D591: BUILT]
- 1× **Flash-Pop Flapping** — Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic {L} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Frosty Flapping** — Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic {W} Energy card from your hand to this Pokémon. [🆕🆕🆕 D591: BUILT]
- 1× **Grand Wing** — Once during your turn, you may use this Ability. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 4 cards.
- 1× **Guiding Dance** — Once during your turn, you may use this Ability. Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- 1× **Lethargic Charge** — Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Attach an Energy card from your hand to your Active Larry's Pokémon.
- 1× **Lovely Fragrance** — Once during your turn, you may use this Ability. Heal 30 damage from each of your Pokémon.
- 1× **Scent Collection** — Once during your turn, you may use this Ability. Search your deck for up to 2 Basic {P} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D585: BUILT]
- 1× **Spiteful Evolution** — Once during your turn, you may use this Ability. Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to evolve it. If you do, place 2 damage counters on the Pokémon you evolved in this way. You can't use this Ability during your first turn.
- 1× **Sunrise** — Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Search your deck for up to 2 Basic Metal Energy cards and attach them to this Pokémon. Then, shuffle your deck.

### "As often as you like" Energy movers / attachers — 3 text(s) / 6 printing(s)

- 4× **Solar Transfer** — As often as you like during your turn, you may use this Ability. Move a Basic {G} Energy from 1 of your Pokémon to another of your Pokémon.
- 1× **Bubble Gathering** — As often as you like during your turn, you may use this Ability. Move an Energy from 1 of your other Pokémon to this Pokémon.
- 1× **Wash Out** — As often as you like during your turn, you may use this Ability. Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon. [🆕🆕🆕 D585: BUILT]

### Knock Out / damage-taken triggers — 14 text(s) / 27 printing(s)

- 5× **Shadowy Concealment** — If 1 of your {D} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, that player takes 1 fewer Prize card. The effect of Shadowy Concealment doesn't stack.
- 3× **Counterattacking Crest** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 5 damage counters on the Attacking Pokémon. [🆕🆕🆕 D585: BUILT]
- 3× **Tenacious Body** — If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10.
- 2× **Damp** — Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked Out.
- 2× **Fainting Spell** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out.
- 2× **Fragile Husk** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, your opponent can't take any Prize cards for it.
- 2× **Photon Cord** — If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2 Basic {L} Energy cards from this Pokémon to 1 of your Benched Pokémon.
- 2× **Spiteful Swirl** — If your Active {D} Pokémon is damaged by an attack from your opponent's Pokémon (even if your Active {D} Pokémon is Knocked Out), place 1 damage counter on the Attacking Pokémon.
- 1× **Counterattack Grouping** — If your Wishiwashi or Wishiwashi ex is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if your Pokémon  is Knocked Out), place 3 damage counters on the Attacking Pokémon.
- 1× **Counterattack Quills** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon. [🆕🆕🆕 D584: BUILT]
- 1× **Durable Body** — If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10.
- 1× **Final Chain** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for a card and put it into your hand. Then, shuffle your deck.
- 1× **Infinite Shadow** — If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put it into your hand instead of the discard pile. (Discard all attached cards.)
- 1× **Needly Armor** — If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon for each {G} Energy attached to this Pokémon.

### Damage modifiers (more / less damage, takes less damage) — 7 text(s) / 12 printing(s)

- 3× **Synchro Pulse** — If you have the same number of cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D585: BUILT]
- 2× **Powerful a-Salt** — Attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). [🆕🆕🆕 D585: BUILT]
- 2× **Thick Fat** — This Pokémon takes 30 less damage from attacks from your opponent's {R} or {W} Pokémon (after applying Weakness and Resistance).
- 2× **Tundra Wall** — All of your Pokémon that have any {W} Energy attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Tundra Wall doesn't stack. [🆕🆕🆕 D585: BUILT]
- 1× **Gloomy Garbage** — Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage (before applying Weakness and Resistance).
- 1× **Intimidating Fang** — As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance). [🆕🆕🆕 D584: BUILT]
- 1× **Supreme Overlord** — Attacks used by this Pokémon do 30 more damage to your opponent's Active Pokémon for each Prize card your opponent has taken (before applying Weakness and Resistance).

### HP, Retreat, type and Energy-provision passives — 8 text(s) / 15 printing(s)

- 3× **Multi Adapter** — Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each.
- 2× **Double Type** — As long as this Pokémon is in play, it is {F} and {P} type. [🆕🆕🆕 D586: BUILT]
- 2× **Scale Up** — If this Pokémon has 6 or more Grass Energy attached, it gets +250 HP.
- 2× **Slimy Sliding** — When your opponent's Active Pokémon retreats, your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch Pokémon. The effect of Slimy Sliding doesn't stack.
- 2× **Tyrannically Gutsy** — If this Pokémon has any Special Energy attached, it gets +150 HP.
- 2× **Wild Growth** — Each Basic {G} Energy attached to all of your Pokémon provides {G}{G} Energy. The effect of Wild Growth doesn't stack.
- 1× **Nighttime Byway** — As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is ColorlessColorless less. [🆕🆕🆕 D584: BUILT]
- 1× **Scale Up** — If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP.

### Prevention / immunity passives — 6 text(s) / 14 printing(s)

- 4× **Hide 'n' Sneak** — Prevent all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon. (Damage is not an effect.)
- 4× **Luminous Wing** — Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon.
- 3× **Damp** — Pokémon in play (both yours and your opponent's) lose any Ability that requires the Pokémon using it to Knock Out itself.
- 1× **Dopey Face** — This Pokémon can't be Confused. [🆕🆕🆕 D584: BUILT]
- 1× **Life-Locked** — Your opponent's Active Pokémon can't be healed.
- 1× **Watchful Eye** — Damage counters on each Pokémon (both yours and your opponent's) can't be moved to other Pokémon.

### Other passives — 10 text(s) / 17 printing(s)

- 3× **Ancient Bulwark** — As long as this Pokémon is on your Bench, prevent all damage done to each of your Pokémon by attacks from your opponent's Pokémon that have 2 or less Energy attached.
- 3× **Memory Helix** — This Pokémon can use the attacks of any of your Benched Pokémon. (You still need the necessary Energy to use each attack.)
- 2× **Holes** — Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon.
- 2× **Sniper's Eye** — If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon.
- 2× **Swirling Prose** — As long as this Pokémon is in the Active Spot, whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Confused.
- 1× **Explosiveness** — If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot.
- 1× **Fighting Roar** — If your opponent's Active Pokémon is a Pokémon ex, this Pokémon can evolve during your first turn or the turn you play it.
- 1× **Good Sleep** — If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon.
- 1× **Startling Drop** — During your opponent's turn, if this Pokémon is discarded from your deck by an effect of an attack or Ability from your opponent's Pokémon, or by an effect of your opponent's Item or Supporter cards, discard the top 8 cards of your opponent's deck.
- 1× **Supereffective Pheromones** — If you have Volbeat in play, apply Weakness for both Active Pokémon as ×3.

## Trainers — 67 unbuilt texts / 129 printings

### Item — Mega Evolution-conditioned — 1 text(s) / 3 printing(s)

- 3× **Mega Signal** — Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck.

### Item — 17 text(s) / 30 printing(s)

- 2× **Blowtorch** — You can use this card only if you discard a Basic {R} Energy card from your hand.

Discard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium in play.
- 2× **Dark Bell** — Both Active non-{D} Pokémon are now Confused.
- 1× **Energy Swatter** — Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck. [🆕🆕🆕 D587: BUILT]
- 3× **Fighting Gong** — Search your deck for a Basic {F} Energy card or a Basic {F} Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. [🆕🆕🆕 D587: BUILT]
- 1× **Great Haul Net** — Choose 1 or both:
• Shuffle up to 3 {W} Pokémon from your discard pile into your deck.
• Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.
- 1× **Hole-Digging Shovel** — Discard the top 2 cards of your deck. [🆕🆕🆕 D588: BUILT]
- 2× **Iron Defender** — During your opponent's next turn, all of your {M} Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). (This includes new Pokémon that come into play.)
- 2× **Jumbo Ice Cream** — Heal 80 damage from your Active Pokémon that has 3 or more Energy attached.
- 1× **Lumiose Galette** — Heal 20 damage and remove a Special Condition from your Active Pokémon. [🆕🆕🆕 D588: BUILT]
- 3× **Poké Pad** — Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.) [🆕🆕🆕 D587: BUILT]
- 3× **Premium Power Pro** — During this turn, attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).
- 1× **Repel** — Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) [🆕🆕🆕 D587: BUILT]
- 2× **Special Red Card** — You can use this card only if your opponent has 3 or fewer Prize cards remaining.

Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards.
- 1× **Strange Timepiece** — Devolve 1 of your evolved {P} Pokémon by putting any number of Evolution cards on it into your hand. (That Pokémon can't evolve this turn.)
- 1× **Transformation Tome** — You must play 2 Transformation Tome cards at once. (This effect works one time for 2 cards.)

Choose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon in play. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon.
- 2× **Ultra Ball** — You can use this card only if you discard 2 other cards from your hand. [🆕🆕🆕 D584: BUILT]
Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- 2× **Wondrous Patch** — Attach a Basic {P} Energy card from your discard pile to 1 of your Benched {P} Pokémon. [🆕🆕🆕 D587: BUILT]

### Pokémon-faced Trainers (fossils, Core Memory) — 5 text(s) / 5 printing(s)

- 1× **Antique Armor Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.

At any time during your turn, you may discard this card from play.
- 1× **Antique Jaw Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.

At any time during your turn, you may discard this card from play.
- 1× **Antique Sail Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.

At any time during your turn, you may discard this card from play.
- 1× **Antique Skull Fossil** — Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.

At any time during your turn, you may discard this card from play.
- 1× **Core Memory** — The Mega Zygarde ex this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.)

### Stadium — Mega Evolution-conditioned — 1 text(s) / 1 printing(s)

- 1× **Ange Floette** — You can put this card into play only if you discard a Prism Tower in play, and you can put this card into play during the same turn you play Prism Tower.
Each Mega Floette ex in play (both yours and your opponent's) gets +150 HP.

### Stadium — 11 text(s) / 20 printing(s)

- 2× **Battle Cage** — Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of attacks and Abilities from the opponent's Pokémon. (Damage from attacks is still taken.)
- 2× **Celebratory Fanfare** — Once during each player's turn, that player may heal 10 damage from each of their Pokémon. If a player healed any damage in this way, their turn ends.
- 1× **Dizzying Valley** — Confused Pokémon (both yours and your opponent's) don't recover from that Special Condition when they evolve or devolve.
- 3× **Forest of Vitality** — Each player's {G} Pokémon can evolve into {G} Pokémon during the turn they play those Pokémon, except during their first turn.
- 1× **Fossil Quarry** — Once during each player's turn, that player may search their deck for up to 2 Item cards that have "Antique" in their name and put them onto their Bench. Then, that player shuffles their deck.
- 2× **Lumiose City** — Once during each player's turn, that player may search their deck for a Basic Pokémon and put it onto their Bench. Then, that player shuffles their deck. If a player searches their deck in this way, their turn ends.
- 3× **Mystery Garden** — Once during each player's turn, that player may discard an Energy card from their hand in order to draw cards until they have as many cards in their hand as they have {P} Pokémon in play.
- 1× **Nighttime Mine** — Attacks used by each Tera Pokémon in play (both yours and your opponent's) cost {C} more.
- 2× **Prism Tower** — Once during each player's turn, that player may discard 2 cards from their hand in order to draw a card.
- 1× **Risky Ruins** — Whenever any player puts a Basic non-{D} Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon.
- 2× **Surfing Beach** — Once during each player's turn, that player may switch their Active {W} Pokémon with 1 of their Benched {W} Pokémon.

### Supporter — Mega Evolution-conditioned — 2 text(s) / 4 printing(s)

- 1× **Jett** — Draw a card for each of your opponent's Mega Evolution Pokémon ex in play.
- 3× **Wally's Compassion** — Heal all damage from 1 of your Mega Evolution Pokémon ex. If you healed any damage in this way, put all Energy attached to that Pokémon into your hand.

### Supporter — 22 text(s) / 55 printing(s)

- 3× **AZ's Tranquility** — Switch your Active Pokémon with 1 of your Benched Pokémon. If you moved a Pokémon ex to your Bench in this way, heal 80 damage from that Pokémon.
- 4× **Acerola's Mischief** — You can use this card only if your opponent has 2 or fewer Prize cards remaining.

Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's Pokémon ex.
- 2× **Anthea & Concordia** — You can use this card only if you have N's Darmanitan, N's Zoroark ex, N's Vanilluxe, N's Klinklang, N's Reshiram, and N's Zekrom in play.

During this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your N's Pokémon, take 3 more Prize cards.
- 3× **Canari** — You can use this card only if you discard another card from your hand.

Search your deck for up to 4 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D588: BUILT]
- 3× **Dawn** — Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
- 2× **Emma** — Your opponent reveals their hand, and you draw a card for each Pokémon you find there.
- 2× **Firebreather** — Search your deck for up to 7 Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck. [🆕🆕🆕 D587: BUILT]
- 3× **Gladion's Final Battle** — You can use this card only when it is the last card in your hand.
During this turn, attacks used by your Pokémon that don't have a Rule Box do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). (Pokémon ex, Pokémon V, etc. have Rule Boxes.)
- 2× **Grimsley's Move** — Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck. You can't use this card during your first turn.
- 3× **Gwynn** — Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)
- 3× **Jacinthe** — Heal 150 damage from 1 of your {P} Pokémon. [🆕🆕🆕 D587: BUILT]
- 4× **Lillie's Determination** — Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead. [🆕🆕🆕 D588: BUILT]
- 3× **Lt. Surge's Bargain** — Ask your opponent if each player may take a Prize card. If yes, each player takes a Prize card. If no, you draw 4 cards.
- 2× **Misty's Vitality** — Search your deck for up to 4 Basic {W} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. Your turn ends. [🆕🆕🆕 D588: BUILT]
- 2× **Naveen** — Draw cards until you have 5 cards in your hand. Before drawing cards, you may discard any number of cards from your hand. (If you can't draw any cards in this way, you can't use this card.)
- 2× **Philippe** — Attach up to 2 Basic {M} Energy cards from your discard pile to 1 of your {M} Pokémon. [🆕🆕🆕 D587: BUILT]
- 1× **Pokémon Center Lady** — Heal 60 damage from 1 of your Pokémon, and it recovers from all Special Conditions. [🆕🆕🆕 D588: DROPPED — the recovery addresses the healed body; needs a `healChosen` rider]
- 3× **Rosa's Encouragement** — You can use this card only if you have more Prize cards remaining than your opponent.

Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon. [🆕🆕🆕 D588: BUILT]
- 3× **Roxie's Performance** — During your opponent's next turn, their Poisoned Pokémon can't retreat. (This includes newly Poisoned Pokémon.)
- 2× **Rust Syndicate Grunt** — You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.

Discard an Energy from 1 of your opponent's Pokémon. [🆕🆕🆕 D588: BUILT]
- 2× **Tarragon** — Put up to 4 in any combination of {F} Pokémon and Basic {F} Energy cards from your discard pile into your hand. [🆕🆕🆕 D587: BUILT]
- 1× **Waitress** — Look at the top 6 cards of your deck and attach a Basic Energy card you find there to 1 of your Pokémon. Shuffle the other cards back into your deck. [🆕🆕🆕 D588: BUILT]

### Tool — Mega Evolution-conditioned — 1 text(s) / 2 printing(s)

- 2× **Tremendous Bomb** — If the Pokémon this card is attached to isn't a Mega Evolution Pokémon ex, is in the Active Spot, and takes 240 or more damage from an attack from your opponent's Mega Evolution Pokémon ex (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card.

### Tool — 7 text(s) / 9 printing(s)

- 1× **Adversity Policy** — If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type, is in the Active Spot, and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 3 cards.
- 1× **Backtrack Badge** — Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results of those coin flips and begin flipping those coins again.
- 1× **Light Ball** — Attacks used by the Pikachu ex this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).
- 2× **Punk Helmet** — If the {D} Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon.
- 2× **Sacred Charm** — The Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon that have an Ability (after applying Weakness and Resistance).
- 1× **Team Rocket's Hypnotizer** — If the Team Rocket's Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Team Rocket's Pokémon is Knocked Out), the Attacking Pokémon is now Asleep.
- 1× **Thick Scale** — The {N} Pokémon this card is attached to takes 50 less damage from attacks from your opponent's {G}, {R}, {W}, or {L} Pokémon (after applying Weakness and Resistance).

## Special Energy — 8 unbuilt texts / 8 printings

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
