# Simulator coverage — the new-op backlog (P3-M5)

The engine simulates cards as **data-driven op programs** (registry.ts). A card
is playable when its printed effect maps onto the op vocabulary
(`effects.ts` EffectOp, plus the continuous/energy/ability shapes in
`registry.ts`). M4 built the vocabulary through nine slices; M5 expands **card
coverage** across the SV-era pool.

## Method — a classify → verify Workflow fan-out (2026-07-19)
The 140 un-authored **sv01–sv03** Trainers (61), Special Energies (4) and
Pokémon Abilities (75) were classified by a 10-agent fan-out (5 batches ×
classify + adversarial verify), each card judged against the current op
vocabulary with the deriver doctrine — **exact map or flag** (a wrong-but-plausible
program is worse than a flag). Every authorable program was then hand-verified
against the local catalog before landing.

## Result
| Verdict | Count |
|---|---|
| **authorable now** (landed this pass) | **5** |
| needs a new op (backlog below) | 113 |
| already authored (M4) | 22 |
| **total classified** | 140 |

Only ~4% of the un-authored pool is expressible with today's ops — coverage is
**op-bound, not authoring-bound**: each new primitive unlocks a whole family, so
the backlog below (ranked by cards-unlocked) is the roadmap for the next slices.
Authoring is then a few registry rows per card, exactly as D8 intended.

### Authored this pass (M5 #1)
| Card | id | Program |
|---|---|---|
| Poké Ball | sv01-185 | Item — `coinFlipGate → [searchDeck anyPokemon→hand, shuffleDeck]` |
| Pokémon Catcher | sv01-187 | Item — `coinFlipGate → [gust]` |
| Nemona | sv01-180 | Supporter — `drawCards 3` |
| Copperajah ex (Bronze Body) | sv02-150 | passive `damageReductionAfterWR: 30` |
| Stonjourner (Exoskeleton) | sv01-121 | passive `damageReductionAfterWR: 20` |

(The fan-out mis-placed Poké Ball's `shuffleDeck` *after* the coin gate — it must
be *inside* it, or a tails play reorders the deck; fixed + pinned by a test.)

## New-op backlog — ranked by cards unlocked (sv01–03)
Build these to expand coverage; the count is how many classified cards each
unblocks. High-value ops first.

| New op / capability | Cards | Example cards |
|---|---:|---|
| 🚧 **`attachEnergyFrom`** (attach Energy from hand/discard/deck to a chosen Pokémon) | 11 | **DONE 4/11: Quaquaval, Baxcalibur** (single attach from hand/discard, engine 0.12.0) + **Gardevoir ex** (the `targetType`/`bonusCounters`/`notIfKO` riders, engine 0.13.0) + **Koraidon ex "Dino Cry"** (multi-attach = N ops + `basicOnly` + the `endsTurn` fold, engine 0.14.0). Remaining 7 need MORE ops on top: Forretress ex (deck-search + self-KO), Charizard ex (onEvolve + deck-search-multi), Geeta (deck-search + can't-attack), Electric Generator/Hydreigon (need `lookAtTopN`), Pawmot (deck-search→self, needs the source uid in EffectContext), Wigglytuff (a Special Energy by name) |
| ✅ **`discardPileRetrieval`** (put/shuffle cards from discard → hand/deck) | 6 | **DONE 5/6** — engine 0.15.0 landed the core (the searchDeck mirror + `supporter`/`pokemonOrBasicEnergy` filters): **Energy Retrieval** (2 Basic Energy → hand), **Pal Pad** (2 Supporters → deck), **Super Rod** (3 Pokémon/Basic Energy → deck); engine 0.28.0's §9.2 op→op record landed the two that had to read their own earlier clause: **Superior Energy Retrieval** ×2 (the new `exclude` rider — the cost pays INTO this pile, so without it the payment refunds itself) and **Miriam** ×3 (the new `recordAs` rider + a `recordGate` two ops downstream). Remaining 1: **Pelipper** (an Ability, not a Trainer). |
| ✅ **`lookAtTopN`** (reveal/take a matching card from the top N) | 5 | **DONE 2/5** (engine 0.16.0, the top-of-deck twin of searchDeck: candidates are the top-N matches, then a trailing shuffle): **Great Ball** (top 7 → a Pokémon), **Pokégear 3.0** (top 7 → a Supporter). Remaining 3 need MORE: Electric Generator + Hydreigon attach the found Energy (a from-the-top **attach** variant — the 2 attachEnergyFrom cards this also unblocks), Malamar peeks at the OPPONENT's deck top (a distinct info-only op). |
| ✅ **`moveEnergy`** (move an Energy between your Pokémon) | 5 | **DONE 3/5** (engine 0.17.0, the compound-park own→own op + the `anyEnergy` filter): **Energy Switch** (a Basic Energy, max 1), **Poppy** (up to 2 any Energy, max 2), and — engine 0.24.0, the `route: "benchToActive"` rider + the `providesEnergy` filter — **Armarouge** "Fire Off" (a {R} Energy benched→Active, as often as you like). Remaining 2 need MORE: Mismagius "Magical Flick" (moves the OPPONENT's Energy on evolve — opponent-side + onEvolve trigger), Exp. Share (an on-KO Tool trigger). |
| ✅ **`conditionalPlay`** (a "you can use this only if <board condition>" gate) | 5 | **PRIMITIVE DONE, 1/5 cards** (engine 0.20.0 — the `BoardCondition` vocabulary + its two consumers: the `trainerPlayableIf` PLAY gate and the `conditionGate` branch op): **Fighting Au Lait** (more Prizes left → heal 60). The same vocabulary also lands **Falkner** (Stadium → draw 2 more) and, with `drawUntilHandSize`, **Grusha** — 2 cards from other rows. Remaining 4 each need a SECOND missing piece: **Letter of Encouragement** (a "were any of your Pokémon KO'd during your opponent's LAST turn" state fact — new per-seat history + flow wiring), ~~**Dendra**~~ (**DONE**, engine 0.27.0 — the gate turned out to be §7.5's hand COST, not a `BoardCondition`: `payFromHand` `to: "deckBottom"` + `drawUntilHandSize`), **Luxray** (an in-hand Ability surface — abilities are in-play only today), **Lunatone** (Stadium-effect prevention). Next reader of the same vocabulary: ~~**Defiance Band**~~ (**DONE**, engine 0.42.0 — the conditional PASSIVE, the third consumer, reusing `morePrizesThanOpponent`). |
| ✅ **`discardOpponentEnergy`** (discard an Energy from an opponent's Pokémon) | 4 | **DONE 3/4** (engine 0.21.0 — the `discardEnergy` op + the `specialEnergy` filter; ONE op whose `from` names both the eligible Pokémon and how many are hit, all three arms landing with a real card): **Crushing Hammer** (`opponentChosen`, behind a coin flip), **Giacomo** (`opponentEach` — one Special Energy off EVERY one of their Pokémon that has one), **Mawile** (`opponentActive`, an onPlayToBench trigger). Remaining 1: **Klawf ex**, which needs `onDamagedByAttack` (the row below), not more of this op. |
| ✅ **attack effect programs that can PARK** (a mid-attack `effect:choose`) | ~13 | **DONE — the mechanism (engine 0.22.0), plus 12 catalog rows of its first family.** A new `attackEpilogue` PendingStage carries the §8.1 KO sweep + the §5.3 turn end; `attack.ts` seeds it BEFORE the effect program runs and folds through `settleProgram`'s `resumeTail`, so a parked prompt and the ops behind it survive. Landed with it: `discardEnergy` gained a **`yourActive`** arm and a **`count: "all"`** rider, both DERIVED from the printed sentence (no registry rows) — "Discard an Energy from this Pokémon." covers **Houndoom ×2 (sv01-034, sv03-133), Charcadet, Staraptor, Paldean Tauros, Dedenne ex ×2, Bombirdier**; "Discard all Energy from this Pokémon." covers **Pawmot ×2, Raichu ×2**. |
| ✅ **the discardEnergy ATTACK arms** — the opponent-side twins + the exact-N count | 11 | **DONE (engine 0.23.0), again with ZERO registry rows — two deriver sentences and one widened field.** The **twins** ("Discard an Energy from your opponent's Active Pokémon.", bare and behind a flip) run the EXISTING `opponentActive` arm with an `anyEnergy` filter: **Pincurchin** (sv02-072), **Gumshoos** (sv03-177), **Dragonite V ×2** (swsh10.5-049/-076); **Dedenne** (sv01-094), **Maschiff** (sv01-136), **Tympole** (sv03-050), **Yveltal** (sv06.5-035). The **exact-N** self-discard widens `count` from `"all"` to any number: **Corviknight** (sv02-148), **Slither Wing** (sv06.5-026), **Koraidon** (sv01-124). The prompt's `scope` became `{kind:"total",count} \| {kind:"each"}` and the interchangeable collapse now keeps `count` reps per class. STILL BLOCKED after it: the **TYPED** discards (closed by the row below), the multi-sentence riders (**Sandaconda**, **Eiscue ex**, **Weavile**), and **Krookodile**'s flip-until-tails repeat count. |
| ✅ **the `providesEnergy` CardFilter** — "an Energy that PROVIDES {X}" | 7 | **DONE (engine 0.24.0) — the last missing piece of the energy-discard family, and the first filter a CARD alone cannot answer.** "{L} Energy" is not "a Basic Lightning card": a Special providing {L} IS one, a wildcard (Luminous) is one of EVERY type, and provision is a while-ATTACHED property that Luminous's own text makes depend on the holder's other attachments — so the predicate reads what an Energy gives ON ITS HOST, through the very code §8.2's cost matcher reads (`unitsProvidedBy`). `matchesFilter`, the deck/hand/discard scanner, answers FALSE for it (a card in a pile is attached to nothing), so authoring it into a pile-scanning op is a loud no-op rather than a wrong card. TWO consumers, one vocabulary (the D40 shape): the **typed self-discard**, DERIVED in both printed notations — the modern "{R}" and the swsh-era spelled-out "Fire" — for **Kilowattrel** (sv01-079), **Arcanine ex ×2** (sv01-032/-224), **Charmeleon** (swsh10.5-009) and **Charizard** (swsh10.5-010) with ZERO registry rows; and **`moveEnergy`'s `benchToActive` route**, authoring **Armarouge ×2** (sv01-041/-203). STILL BLOCKED, and now every one of them for sentence STRUCTURE rather than for any missing filter: **Pawmot ex** (a typed discard COST plus "220 damage to 1 of your opponent's Pokémon" — both halves exist as ops since 0.39.0's `opponentAny`, but the deriver's whole-sentence anchor reads one clause, not a compound), **Bellibolt ex** ("you may … to make it Paralyzed" — an optional discard BUYING an effect), ~~**Mewtwo VSTAR**~~ (**DONE**, D97/engine 0.48.0 — the CAPPED Hail Blade shape: `discardEnergy` gained `cap?: number` bounding the `count: "any"` up-to to "up to 3", and the authored-attack seam became index-keyed so its idx-1 "Star Raid" stays unsimulated), **Sandaconda** / **Eiscue ex** / **Weavile** (rider clauses) and **Krookodile** (a repeat count). (**Chien-Pao ex** left this list in D96 — registry-AUTHORED, not derived: the deriver still refuses the sentence.) |
| ✅ **`discardFromHandCost`** → **`payFromHand`** (pay N cards out of hand to play) | 4 | **DONE 3/4, and the row's real size was bigger than this count** (engine 0.26.0 — the printed COST that PARKS, so it is an OP at the head of its program rather than a field paid before it). Two printed wordings, ONE mechanism, and the wording tracks where the paying card sits: TRAINERS say "only if you discard 2 **other** cards" because the card is in the hand it pays from — **Ultra Ball** (sv01-196), **Earthen Vessel** (sv06.5-096, "another card"); ABILITIES never say "other" because the card is on the board — **Revavroom** (sv01-142, "an Energy card" → draw to 6, the ORDER witness), **Tinkaton** (sv02-105, "a card" → draw 3, the unfiltered general case). The same sentence is printed on **Meowscarada ex** and **Radiant Blastoise** (swsh10.5-018), so the old `AbilityProgram.cost` field — which could only express the FUNGIBLE case — was REMOVED and Meowscarada migrated onto the op: 9 catalog rows in all. `chooseCards` gained a required `min` (the first MANDATORY card park; every "up to" consumer declares 0). **Row CLOSED at engine 0.28.0**: **Superior Energy Retrieval** (sv02-189/-277) landed with the §9.2 record, its "(You can't choose a card you discarded with the effect of this card.)" becoming `discardPileRetrieval.exclude` reading the uids `payFromHand` filed. |
| ✅ **`onDamagedByAttack`** (a trigger firing when damaged by an attack, even if KO'd) | 4 | **DONE — row CLOSED 4/4.** ~~Cacnea, Cacturne~~ (covered by the `damageAttacker` PASSIVE, D98 — counters-on-attacker, no trigger needed), ~~**Armarouge**~~ (sv03-044 "Scorching Armor" → Burn the attacker — D99, engine 0.50.0: the general trigger, a new `TriggerTiming` `onDamagedByAttack` firing a NON-parking `applyStatus`), ~~**Klawf ex**~~ (sv03-120 "Counterattacking Pincer" → discard an Energy from the attacker — **DONE, D101, engine 0.52.0**, the PARKING opponent-side discard). D101 made the trigger a STAGED `damagedTrigger` PendingStage (the twin of `koTrigger`): attack.ts records it at damage time and seeds it AFTER the attack's own effect program, BEFORE the attackEpilogue; flow.ts `runDamagedTrigger` folds it through settleProgram with `resumeTail` **under the DAMAGED seat**, so — like an on-KO trigger — the DEFENDER is the answerer (no `decider`/`answerer`), the attacker still owns the turn (`koParkActiveSeat` reads the attackEpilogue behind the park), finishAttack resumes after the pick ("even if KO'd" free; Klawf ex prizes 2). D99's inline `runDamagedByAttackTriggers` became the `damagedByAttackAbility` gated lookup; Armarouge's Burn rides the same staged path byte-identically. `counterattackingPincer.test.ts` (8). (Out of this sv01–sv03 row but in the pool: Fezandipiti sv06.5-073 "Adrena-Pheromone" — a coin-flip damage-PREVENTION-on-damaged read, a different shape. ✅ **BUILT AT D258**, and the shape call here was right: it is NOT a trigger at all but a `passivesOf` fold read inside the §8.5 damage pipeline through `coinFlipShieldPrevents`.) |
| ✅ **`shuffleHandIntoDeck` (+ draw)** — the Iono/Judge hand-refresh family | 3 | **DONE — row CLOSED, +Judge +Iono** (the `handRefresh` op: engine 0.18.0 fully-automatic, reaches the OPPONENT): **Youngster** (draw 5), **Brassius** (draw hand+1), **Katy** (draw 8 + turn ends), **Judge** (both shuffle + draw 4), and **Iono** (engine 0.19.0 — the `toBottom` placement so the deck's ORDER survives, a `prizeCount` draw, and the `onlyIfAnyMoved` cross-seat draw gate). No Marnie exists in the sv01–03 catalog. The other bottom-of-deck cards: **Dendra** (**DONE** engine 0.27.0 — a CHOSEN card, so it is `payFromHand` `to: "deckBottom"`, not this op) and **Skwovet** ×2 "Nest Stash" (**DONE** engine 0.27.0 — this op exactly, `toBottom` + `onlyIfAnyMoved` + a fixed draw of 1, on the ABILITY path; zero new code). Still open: none — **Ortega** landed in engine 0.32.0 (`bottomFromOpponentHand`, the row below). |
| ✅ **`stadiumActivatedAbility`** (a "once during each player's turn" Stadium) | 3 | **DONE — row CLOSED 3/3 (engine 0.53.0, D102).** A new `useStadiumAbility {seat}` action (no target — one shared Stadium) runs `StadiumEffects.ability?: {label, program}` under the turn's own player, gated by a new per-turn `TurnAllowances.stadiumAbilityUsed` bool that **re-arms every turn** (freshAllowances), so "each player's turn" needs NO non-active-seat routing (the opponent activates on THEIR turn; the D100 lock never touches a Stadium). The three programs need **no new op** — Nest Ball / Poké Ball search shapes: **Artazon** (sv02-171/-229, `searchDeck basicPokemon{noRuleBox} → bench`), **Mesagoza** (sv01-178, the Poké Ball coin gate around `searchDeck anyPokemon → hand`), **Town Store** (sv03-196, `searchDeck toolCard → hand`). Two new CardFilter kinds: `basicPokemon.noRuleBox` (cards.ts `hasRuleBox` = suffix ∪ "Radiant " prefix) + `toolCard`. New event STADIUM_ABILITY_ACTIVATED. `stadiumAbility.test.ts` (13). **ENGINE + tests only — the HUD button (a target-less "global" affordance + a projection field) is a DEFERRED follow-up.** (Out of scope but in the pool: **Academy at Night sv06.5-054** "…put a card from hand on top of their deck" — sv06.5, and needs a `payFromHand to:"deckTop"` op.) |
| ✅ **`damageAttacker`** (put counters on the attacking Pokémon) | 3 | **DONE — row CLOSED 3/3 (engine 0.49.0, D98).** Modelled as a defender-side `PassiveEffects` field `damageAttacker?: {amount, requiresTool?}` — NOT a new op or trigger — because "if this Pokémon is damaged by an attack, put N counters on the Attacking Pokémon" is a reactive continuous read exactly like `damageReductionAfterWR`. continuous.ts sums it seat-free (evaluating Custom Trap's `requiresTool` against the holder's board); attack.ts folds it right after DAMAGE_DEALT, placing flat counters (outside the §8.5 W/R pipeline) on the attacker's Active when `dealt > 0`, BEFORE finishAttack's both-board §8.1 sweep — so "even if Knocked Out" is free and a lethal retaliation KOs the attacker, prized to the defender. **Cacnea** (sv01-005) + **Cacturne** (sv01-006) "Counterattack Quills" (30, byte-identical → one const), **Stunfisk** (sv03-112) "Custom Trap" (50, `requiresTool`). The "in the Active Spot" clause is enforced by the READ SITE (only the main-hit Active defender retaliates; a benched holder hit by spread does not — a documented follow-up, since a snipe/spread hit on the Active does not retaliate yet either). `damageAttacker.test.ts` (8). |
| ✅ **`disableAbilities`** (a continuous Ability-lock aura) | 3 | **DONE — row CLOSED 3/3 (engine 0.51.0, D100).** ONE new `PassiveEffects` field `disableAbilities?: {stage?, suffix?, side, requiresDamage?, requiresActive?, exemptSuffix?, exemptAbilityNamed?}` — seven narrowing predicates that between them express all three printed sentences, no new op / timing / action / phase. But it is the FIRST passive that does not modify its HOLDER, so continuous.ts reads it through a dedicated both-boards pass, **`disabledAbilityUids(state)`** (the top uids whose Abilities are off; empty on every board with no lock in play), and only a TOP CARD grants an aura — never a Tool. **Four read sites consult that Set by uid:** activated (`useAbility` → the new `ABILITY_DISABLED`, checked BEFORE activeOnly/oncePerTurn/cost so the lock is what gets reported), passive (`passivesOf` — the top card's printed passive only; the holder's **Tools keep working**), triggered (`triggersOf` — the single choke for onPlayToBench/onEvolve/betweenTurns/onDamagedByAttack; **onKnockOut deliberately NOT gated**, it fires as the Pokémon leaves play) and the HUD (`redact.ts` — the row greys, `reason: null`). **Klefki** (sv01-096) "Mischievous Lock" (Basic, both sides, Active-only, `exemptAbilityNamed` so a mirror match leaves both locks on), **Spiritomb** (sv02-089) "Fettered in Misfortune" (Basic **V**, both sides, and — no Active-Spot clause — it locks FROM THE BENCH; the other Spiritomb sv01-129 has no Ability and is deliberately unregistered), **Ting-Lu ex** (sv02-127 + -243/-263/-275) "Cursed Land" (the opponent's DAMAGED Pokémon, Active-only, `exemptSuffix: "ex"`). **KNOWN LIMITATION:** auras are collected UNGATED, so a lock never turns another lock off — an Active Ting-Lu ex opposite a damaged Klefki should switch Mischievous Lock off and does not. That needs a fixpoint pass rather than one read; deferred, and pinned by a tripwire test that asserts the current behaviour. `abilityLock.test.ts` (19) — a set-membership matrix over every predicate plus a lock-ON/lock-OFF pair per read site. |
| ✅ `drawUntilHandSize` | 2 | **DONE — row CLOSED 2/2.** (engine 0.20.0 — draws to a floor, never TRIMS a bigger hand; no event at a count ≤ 0): **Grusha** (to 5, or to 7 with no Energy on your board — the `conditionGate` `otherwise` arm), and — engine 0.27.0 — **Dendra** (draw to 5, counting the card just paid to the bottom of the deck: the payment is the program's FIRST op, so a hand of 4 draws three). |
| ✅ `endTurn` (a play that ends your turn) | 2 | **DONE**: Koraidon ex (the `AbilityProgram.endsTurn` fold, engine 0.14.0) + Katy (the same fold on the Trainer path via `trainerEndsTurn`, engine 0.18.0). |
| ✅ `conditionalDamageBonus` (Tool: +N under a condition) | 2 | **DONE — row CLOSED 2/2.** **Defiance Band** (sv01-169, engine 0.42.0): the D40 `BoardCondition` vocabulary's **third consumer and first PASSIVE one** — the conditional twin of Vitality Band. New `PassiveEffects.damageBonusBeforeWRIf {amount, cond}` reusing the EXISTING `morePrizesThanOpponent` (no new condition), so it is a card row + one field, not a new primitive. continuous.ts stays the seat-FREE aggregation point (collects the gated bonuses raw); the fold lives in interpreter.ts `attackerPreWRBonus`, shared by the two pre-W/R read sites (attack.ts main hit + snipeActive) so `conditionHolds` is evaluated once, at the only sites that know the attacker's seat. **Choice Belt** (sv02-176, engine 0.43.0): the TARGET-gated twin — +30 before W/R, but only when the DEFENDER is a Pokémon **V**. A SIBLING field `damageBonusBeforeWRIfTarget {amount, targetSuffix}` rather than the D40 vocabulary, because the gate reads the card being HIT, not the holder's seat-relative board; aggregated raw by the same seat-free `passivesOf` and folded by the same `attackerPreWRBonus`, which now also takes the `defenderCard` (both read sites had it in hand). The "is a V" test needed **no schema/ingest/DB change**: tcgdex's `suffix` is dropped at ingest but the marker is ALSO printed in the card NAME, which IS persisted, so `cards.ts pokemonSuffixOf` derives it from `name`, matching each suffix as a whole marker (a VMAX/VSTAR defender is untouched — exactly the distinction Choice Belt draws). The SV-era pool holds no Pokémon V, so the gate is **dormant against the live catalog** and fires once a prior-era set is ingested; correct either way. |
| ✅ **prize value — a KO owes its rule box's real Prize count** (§8.1) | — | **DONE (engine 0.44.0) — a rules FIX, the D92 follow-up, not a coverage row.** `prizeValueOf` stops returning 1 for every KO: **3 for a VMAX, 2 for any other rule box (ex / V / VSTAR / GX), 1 for a plain body**, the class read off D92's `pokemonSuffixOf` (the printed NAME suffix), so — like Choice Belt — **no schema/ingest/DB/API/web change**. Unlike Choice Belt this one FIRES against the live SV-era pool (full of ex Pokémon). The "wide blast radius" three sessions deferred was **measured and empty**: the one-line change left all 1952 pre-existing tests green because every KO test knocks out a plain body. The prize `count` was already a variable at both read sites (flow.ts `takePrizes` + the §14 tie-guard), both clamping to the Prizes that remain, so a 2-Prize KO with one Prize left wins (§14.1) rather than over-drawing — no flow change. Pinned by a dedicated `prizeValue.test.ts` on a mulligan-free `PRIZE_DECK` + unit cases in `cards.test.ts`. See D93. |
| `statusImmunity` / `preventDamageFromType` / `coinFlipDamagePrevention` / `drawUntil` / `canEvolveEarly` | 2 each | Dachsbun, Bellibolt, Jumpluff/Skiploom, Togekiss, Scatterbug/Spewpa |
| ✅ **the hand cost paid UNDER THE DECK** (`payFromHand`'s `to: "deckBottom"`) | 5 | **DONE — the same op one field wider, plus one card that needed no op at all** (engine 0.27.0). **Dendra** ×3 (sv02-179/-250/-266): "Put a card from your hand on the bottom of your deck. If you do, draw cards until you have 5 cards in your hand. (If you have no other cards in your hand, you can't use this card.)" — nothing is discarded and the word "cost" never appears, but it is the same mandatory exact pick, the same conditional benefit ("if you do") and the same printed play gate, stated as its contrapositive with the same word "other". So `discardFromHandCost` became **`payFromHand`** with a required `to: "discard" \| "deckBottom"`, and `handCostUnmet` gates the card with no new code. **Skwovet** ×2 (sv01-151/-222) "Nest Stash" reaches the same destination with the WHOLE hand — `handRefresh` + Iono's `toBottom` + `onlyIfAnyMoved`, ZERO new ops, and the first `handRefresh` on the Ability path. No longer blocked: **Ortega** reaches the same destination on the OPPONENT's side and got its own op (engine 0.32.0, the row below) — the hand it reads is REVEALED by the effect, which is what `payFromHand` could never say. |
| ✅ **"choose N" is EXACT** (`choosePokemonMulti`'s `min`/`max` + `declinable`) | — | **DONE (engine 0.27.0) — a rules FIX, not a coverage row.** The printed number in a *choose* clause is a floor as well as a ceiling (rules doc **§9.1**), so Meowscarada ex / Radiant Blastoise can no longer pay their irreversible hand cost and then place nothing, and Hawlucha's "**you may** choose 2" is all-or-nothing (2 or none, never 1 of 2 — its trigger auto-fires, so the pick is the only place its "may" can live). The next consumer that will need the OTHER end of the range is **Janine's Secret Art** ("choose **up to** 2 of your {D} Pokémon"). |
| ✅ **§9.2 — a clause that reads what an earlier clause DID** (the op→op record) | 5 | **DONE (engine 0.28.0) — the engine's first op→op data flow, and the last mechanism the `payFromHand` and `discardPileRetrieval` rows were waiting on.** Some printed clauses cannot be answered from the board, because the board after an effect looks the same whether a card got there by that effect or was already sitting there. So an op files the uids it MOVED under a named `EffectSlot` (`recordAs`), and a later op reads them. TWO readers, one record (the D40 shape): the **gate** — a new `recordGate {slot, then, otherwise?}`, spliced into the work queue like the other two gates — landing **Miriam** ×3 (sv01-179/-238/-251, "If you shuffled any cards into your deck **in this way**, draw 3 cards") and finally letting **Dendra** state its own printed "**If you do**"; and the **exclusion** — `discardPileRetrieval.exclude` — landing **Superior Energy Retrieval** ×2 (sv02-189/-277), whose cost pays INTO the very pile its next clause reads, so without it a player discards 2 Basic Energy and takes the same two straight back. The record is keyed by UID, not by card id (an identical print already in the pile stays choosable), and by SLOT, not by position: Miriam prints a deck shuffle BETWEEN the retrieval and the sentence about it, so "the previous op" was never a workable reading of "in this way" — the same shape **Janine's Secret Art** prints. It rides `EffectContinuation.record` (an accumulator, sibling to `rest`) rather than `EffectContext` (a constant), and is absent when empty, so every program predating §9.2 parks into a byte-identical phase. Both cards this row left open have since landed: **Janine's Secret Art** (engine 0.29.0 — the per-target deck search, whose own gate is the `contains` narrowing) and **Ortega** (engine 0.32.0 — the gate over an opponent-side pick, the row two below). |
| ✅ **the reveal-and-bottom family + the OPPONENT's own decision** (`bottomFromOpponentHand` + `opponentMayDraw`) | 3 | **DONE (engine 0.32.0) — the last row the §9.2 and `payFromHand` rows both left open, and it needed a mechanism neither of them did.** Two ops. `bottomFromOpponentHand` reveals the opponent's whole hand (a new PUBLIC `HAND_REVEALED` naming every uid — that is what the printed word means at a table, and it is the one hand event in the file that is not count-only), the controller picks one card, and it goes under the OPPONENT's deck (`CARD_TO_BOTTOM_OF_DECK`, named, with an `actor`: unlike Dendra's payment this move happened face up at BOTH ends, so which card sits on the bottom is real public information). The offer collapses to one representative per interchangeable class — sound here precisely where it is not in `payFromHand`, whose collapse over a still-hidden hand leaks its duplicate structure. `opponentMayDraw` is the engine's **first decision answered by the NON-controller**: the park carries a `decider`, the phase a `answerer` beside its controller `seat` (absent when they agree, so every older park serializes byte-identically), and `resolveEffect` admits only that seat — the controller cannot consent for them. Rules doc **§9.4**. Lands **Ortega** ×2 (sv03-190/-219, the Miriam shape with both halves across the table) and **Greavard** "Underworld Stroll" (sv01-105) DERIVED from attack text — its Supporter-filtered twin has no second sentence, and its plain second attack (Sharp Fang) is exactly why the per-CARD registry `attack` field could not have carried it. `programPlayable` gained the empty-opponent-hand gate (a PUBLIC count — the Catcher/Hammer class, not Poké Ball's; it reads hand LENGTH and never the filter, since whether a hidden hand holds a match is what the game state does not establish) and is now EXPORTED, so the HUD greys a dead Trainer/Ability row with the predicate that rejects it. |

**Long tail (~70 single-card ops)** — e.g. `bounceToHand` (Penny), `moveDamageCounters`
(Slowbro), ~~`healBothPlayers` (Picnic Basket)~~ (**DONE**, engine 0.54.0 / D103 — the op is
`healEachAll`, the seat-blind twin of `healEach`; the FIRST long-tail slice), ~~`removeWeakness`
(Florges)~~ (**DONE**, engine 0.55.0 / D104 — a `PassiveEffects.removeWeakness` flag + the own-board
`seatRemovesWeakness` scan; the FIRST long-tail passive aura), ~~`noRetreatCostAura` (Clefable ex)~~
(**DONE**, engine 0.59.0 / D108 — a `PassiveEffects.noRetreatCostAura
{requiresEnergyType?}` + the per-TARGET `hasFreeRetreatAura` scan folded into
`effectiveRetreatCost`; the FIRST CONDITIONAL aura and the first retreat-cost
modifier), ~~`retaliationDamage` (Rocky Helmet)~~ (**DONE**, engine 0.57.0 /
D106 — the D98 `damageAttacker` recoil on a Tool, a PURE data row: `passivesOf`
already folds attached-Tool passives), ~~`preventDamageFromExV` (Mimikyu)~~
(**DONE**, engine 0.58.0 / D107 — a `PassiveEffects.preventDamageFromExV` flag +
the new `cards.ts isExOrV` gate at all four attack-damage read sites; the FIRST
attacker-class-gated prevention), the Iono/Judge prize-count draws, per-card search filters
(`searchFilter:{itemCard,toolCard,~~evolutionPokemon~~,…}` — `toolCard` done
D102, **`evolutionPokemon` done D105/0.56.0** (Jacq); `itemCard`'s only sv01–03
user Arven needs a dual-target search, not a filter), and several bespoke
passives/triggers. Full list in the fan-out result. Many collapse into a few
parameterized ops (an `attachEnergyFrom` with source/filter params; a
`conditionalGate` family; extra `CardFilter` kinds), so the real op count to build
is well under 70.

### Landed from the long tail
| Card | id | Op | Engine |
|---|---|---|---|
| Picnic Basket | sv01-184 | `healEachAll` (heal 30 from EVERY Pokémon, both boards; non-parking, seat-blind twin of `healEach`) | 0.54.0 (D103) |
| Florges | sv01-093 | `removeWeakness` (own-board "no Weakness" aura; a `PassiveEffects` flag + `seatRemovesWeakness` scan gated through `disabledAbilityUids`, wired into both W/R read sites) | 0.55.0 (D104) |
| Jacq | sv01-175/-236/-250 | `evolutionPokemon` CardFilter (search up to 2 Evolution Pokémon → hand; a bare union variant reading `evolveFromOf`, the D102 pattern, ZERO new op — the Flamigo search-to-hand shape) | 0.56.0 (D105) |
| Rocky Helmet | sv01-193 | `damageAttacker` on a TOOL (2 counters = 20 HP recoil on the attacker; the D98 family's Tool member — a PURE data row, `passivesOf` already folds attached-Tool passives, no `requiresTool` since the Tool IS the source) | 0.57.0 (D106) |
| Mimikyu | sv02-097 | `preventDamageFromExV` (Safeguard — prevent ALL damage from an opponent's ex/V; a bare `PassiveEffects` flag riding `passivesOf`, GATED at all four attack-damage read sites on the attacker's class via the new `cards.ts isExOrV`, NOT `hasRuleBox`; a `prevented` DAMAGE_DEALT flag; honored on the Bench too — no Active-Spot clause) | 0.58.0 (D107) |
| Calamitous Wasteland | sv02-175 | `basicRetreatSurcharge` (Stadium — "The Retreat Cost of each Basic non-{F} Pokémon in play (both yours and your opponent's) is {C} more"; Beach Court's sign-flipped twin, a `StadiumEffects.basicRetreatSurcharge { amount, excludesType? }` object because THIS print narrows where Beach Court's does not, plus one clause in `effectiveRetreatCost` matching `excludesType` against `Card.types`. The smallest long-tail slice yet: no new op, no new scan, no new read site. The ± deltas can never stack — one Stadium in the zone AND one Stadium play per turn — so the only real composition is Lunar Zone's set-to-zero beating it) | 0.60.0 (D109) |
| Clefable ex | sv03-082 | `noRetreatCostAura` (Lunar Zone — "All of your Pokémon that have {P} Energy attached have no Retreat Cost"; a `PassiveEffects.noRetreatCostAura { requiresEnergyType? }` read through the new per-TARGET `hasFreeRetreatAura(state, pokemon)` scan, which DERIVES the seat so `effectiveRetreatCost`'s three readers stay untouched; a SET-TO-ZERO checked before Beach Court's ± `basicRetreatDiscount`, stage-agnostic, self-inclusive; the {P} clause is a PROVISION read so a wildcard Luminous counts) | 0.59.0 (D108) |
| Next candidates | — | `moveDamageCounters` (Slowbro sv01-043, repeatable parking Ability — needs a move-counter op + the as-often-as-you-like repeat path) · `bounceToHand` (Penny — real print is "Basic Pokémon", so an Active bounce needs mid-turn promotion). BOTH need genuinely new machinery — the one-field-flag passive avenue is now spent (D104/D107), the "one new filter kind" avenue is spent (`itemCard`'s only user Arven needs a dual-target search), and D108 drained the last aura that a new read site alone could carry. **The retreat-cost seam is now half-built** (D108 zero-aura + D109 Stadium surcharge); its two remaining rows, cheapest-first: **the four "damage per {C} of the opponent's Retreat Cost" attacks** (Heracross sv01-002, Spidops ex "Wire Hang", Sharpedo sv03-047, Stoutland sv03-172) — one attack-shape reading `effectiveRetreatCost` on the DEFENDER, four cards at once, the payoff for one derivation point; and **Spidops ex sv01-019/-223/-243 "Trap Territory"** (opponent's Active Retreat Cost {C} MORE — the opponent-side additive aura; the first delta that is not a Stadium, so it is what should introduce a `retreatCostModifiers(state, pokemon)` fold). Note Spidops ex needs BOTH rows (its own ability and Wire Hang), so building the readers first makes it a one-card finish. | — |

## Suggested sequencing
1. ✅ **`attachEnergyFrom`** — the single biggest unlock (11+, and the engine of most
   evolving-deck Abilities). **DONE 4/11** (engine 0.14.0: single-attach + the
   targetType/bonusCounters/notIfKO/basicOnly/multi/endsTurn riders — Quaquaval,
   Baxcalibur, Gardevoir ex, Koraidon ex). The rest need a deck-search source /
   `lookAtTopN` / per-card riders.
2. ✅ **`discardPileRetrieval`** — **DONE 3/6** (engine 0.15.0, the searchDeck mirror
   + `supporter`/`pokemonOrBasicEnergy` filters: Energy Retrieval, Pal Pad, Super
   Rod). Extra `CardFilter` kinds (Item/Tool/Evolution/no-rule-box) still layer on
   for other searchers.
3. ✅ **`lookAtTopN`** — **DONE 2/5** (engine 0.16.0: Great Ball, Pokégear 3.0 —
   the reveal-to-hand core). A from-the-top **attach** variant then unblocks
   Electric Generator / Hydreigon (also 2 of the remaining attachEnergyFrom cards).
4. ✅ **`moveEnergy`** — **DONE 2/5** (engine 0.17.0: Energy Switch, Poppy — the
   own→own core, the interpreter's first compound-park op + the `anyEnergy` filter).
   The remaining 3 layer riders on it: a fixed-endpoint provided-type move
   (Armarouge), an opponent-side move on evolve (Mismagius), an on-KO Tool move
   (Exp. Share). Next candidates: the from-the-top **attach** variant (Electric
   Generator / Hydreigon, also 2 attachEnergyFrom cards), the **`conditionalPlay`**
   family (5), or the **hand-refresh Supporter family** (Iono/Judge/Marnie).
5. ✅ The **hand-refresh Supporter family** — **DONE, row CLOSED** (engine 0.18.0, the
   `handRefresh` op: the whole `shuffleHandIntoDeck` row — Youngster / Brassius /
   Katy — **plus Judge**, the first op to affect the OPPONENT's hand/deck; and it
   closes the `endTurn` row via the Trainer-path `trainerEndsTurn` fold; then engine
   0.19.0 added **Iono** as three riders — `toBottom` (deck order survives),
   `prizeCount` draw, `onlyIfAnyMoved` gate). No Marnie in the sv01–03 catalog.
6. ✅ **`conditionalPlay` / `conditionalGate`** — **PRIMITIVE DONE** (engine
   0.20.0): one `BoardCondition` vocabulary with two consumers — the
   `trainerPlayableIf` PLAY gate and the `conditionGate` branch op — plus
   `drawUntilHandSize`. Lands **Fighting Au Lait**, **Falkner** and **Grusha**.
   Every remaining gated card needs a second missing piece (see the row above),
   so the primitive is done but the row is not. Cheapest next readers of the same
   vocabulary: ~~**Defiance Band**~~ (**DONE**, engine 0.42.0 — the conditional PASSIVE, the third consumer) and
   ~~**Dendra**~~ (**DONE**, engine 0.27.0 — the choose-from-hand → bottom-of-deck park, which turned out to be the §7.5 hand cost with a second destination rather than a new op).
7. ✅ **`discardOpponentEnergy`** — **DONE 3/4** (engine 0.21.0, the `discardEnergy`
   op + the `specialEnergy` filter: Crushing Hammer, Giacomo, Mawile). Building it
   surfaced the next big structural unlock, now its own row above: **attack effect
   programs cannot PARK**, which alone blocks ~13 more cards in the SAME family
   (every "Discard an Energy from this Pokémon" attack, plus the opponent-side
   attack twins of Crushing Hammer). Klawf ex, the 4th card on this row, needs
   `onDamagedByAttack` instead.
8. ✅ **attack effect programs that can PARK** — **DONE** (engine 0.22.0, the
   `attackEpilogue` stage + `discardEnergy`'s `yourActive` / `count:"all"` arms:
   12 catalog rows, all DERIVED from the printed sentence, no registry rows). The
   structural half is what matters — every future attack effect may now hold a
   decision. The remaining self-discard prints need op vocabulary, not park work:
   an **exact-N** discard (Corviknight 2, Koraidon 3) and an **energy-of-type**
   filter (Kilowattrel's "a {L} Energy", where {L} means *provides* {L}).
9. ✅ **The discardEnergy ATTACK arms** — **DONE** (engine 0.23.0): the
   opponent-side twins (bare + coin-gated) and the exact-N `count`, **11 catalog
   rows for two deriver sentences and one widened field, zero registry rows.**
   What is left of the whole energy-discard family is now ONE missing primitive,
   a **`providesEnergy` CardFilter** ("an Energy that PROVIDES {X}" — NOT
   `basicEnergy` + type, since a Special Energy providing {L} counts and a
   {C}-providing one does not). It closes **Kilowattrel, Arcanine ex ×2,
   Charmeleon, Charizard** here and also unblocks **Armarouge**'s benched→Active
   {R} move (a `moveEnergy` rider) — the same filter read by two ops, the D40
   two-consumers shape. The remaining prints after that need sentence STRUCTURE,
   not filters: Sandaconda/Eiscue ex/Weavile (a rider clause after the discard)
   and Krookodile (a flip-until-tails repeat count).
10. ✅ **The `providesEnergy` filter** — **DONE** (engine 0.24.0): "an Energy that
   PROVIDES {X}", read by TWO ops — the DERIVED typed self-discard (5 catalog rows,
   zero registry rows) and `moveEnergy`'s new `benchToActive` route (Armarouge, 2
   rows). It is the first filter a card alone cannot answer: provision is a
   while-attached property, and a wildcard Special (Luminous) is an Energy of every
   type until another Special demotes it to {C}. Single-sourced with the §8.2 cost
   matcher, so what can PAY a {L} cost is exactly what a "{L} Energy" effect can
   take. **The whole energy-removal family is now filter-complete**: every card
   still unauthored in it is blocked by sentence STRUCTURE (an optional discard
   buying an effect, a variable count with damage scaling, a rider clause, a repeat
   count) rather than by any missing predicate.
11. ✅ **`attachFromTop`** (engine 0.25.0 — Electric Generator / Hydreigon) and
   ✅ **`discardFromHandCost`** (engine 0.26.0 — Ultra Ball / Earthen Vessel /
   Revavroom / Tinkaton, + Meowscarada ex and Radiant Blastoise migrated off the
   removed `AbilityProgram.cost` field: 9 catalog rows). The second shares the
   printed wording "You can use this card only if…" but is NOT a `BoardCondition`
   — it is a COST with a card CHOICE, so it PARKS, and it is the first op of its
   program because the payment is observable before what it buys.
12. ✅ **The FLOOR, and the payment that is not a discard** — **DONE** (engine
   0.27.0). Two mandatory-exactly-N fixes, one on each prompt that could still say
   "up to": `choosePokemonMulti` gained `min`/`max` + `declinable` (rules doc
   §9.1 — Meowscarada ex / Radiant Blastoise could pay an irreversible cost and
   place nothing; Hawlucha's "you may choose 2" is all-or-nothing), and
   `discardFromHandCost` became **`payFromHand`** with a required `to`, landing
   **Dendra** ×3 under the deck and **Skwovet** ×2 with no new op at all.
13. ✅ **op→op data flow** — **DONE** (engine 0.28.0), and it closed BOTH deferrals
   this family had left, with **5 catalog rows for one mechanism**: **Superior
   Energy Retrieval** ×2 ("you can't choose a card you discarded with the effect
   of this card" → `discardPileRetrieval.exclude`) and **Miriam** ×3 ("if you
   shuffled any cards into your deck in this way, draw 3" → the new `recordGate`),
   plus **Dendra**'s printed "if you do", which the vocabulary could not state
   before. An op files the uids it MOVED under a named `EffectSlot`; a later op
   reads them. The record rides `EffectContinuation` rather than `EffectContext`
   (an accumulator, sibling to `rest` — the context is a constant), and it is
   keyed by SLOT rather than by position because Miriam prints a deck shuffle
   BETWEEN the retrieval and the clause referring to it. Rules doc **§9.2**.
14. **Next candidates** *(as written at D48; all three named here have since
   landed — Janine's Secret Art in 0.29.0, Saguaro in 0.31.0, Ortega in 0.32.0.
   Kept for the reasoning, not the pointer.)*: **Janine's Secret Art**
   (sv06.5-059/-088) is the single best-supported row on the board — it needs a
   per-target deck search, the first printed "choose **up to** N Pokémon" (the
   other end of the range §9.1 added), AND an "in this way" gate (§9.2, which now
   exists), so two of its three pieces are built. Otherwise: ~~**Defiance Band**~~
   (**DONE**, engine 0.42.0 — the conditional PASSIVE, the D40 vocabulary's third
   consumer), or **Saguaro** (the
   cheapest reader of "choose up to N Pokémon" alone — `healChosen` widened with a
   count).
Each is a normal engine slice (new op + interpreter case + registry rows +
tests + review), and each turns dozens of "needs-op" rows into a few data rows.

## Snipe/damage-family riders authored since 0.41.0 (not new-op rows)
These are DERIVER riders on the D59 any-target snipe / D57–D58 benched-snipe
families, each a field or token on an EXISTING op rather than a table row above:
- ✅ **each-of-spread "also" rider** (D94, engine 0.45.0) — "also" optional in
  `SPREAD_EACH_BENCH`, deriving to the same `spreadDamage` op. Cetoddle sv02-053
  "Avalanche".
- ✅ **Umbreon "Feint Attack" `ignoreWR`** (D95, engine 0.46.0) — the any-target
  snipe whose damage "isn't affected by Weakness or Resistance, or by any effects
  on that Pokémon." A `damageChosen.ignoreWR?: true` field: it nulls W/R AND the
  target's `damageReductionAfterWR` passive on both arms, while KEEPING the
  attacker's own pre-W/R bonus. Umbreon **sv03-130** (verbatim tcgdex-confirmed).
  **LESSON for the next snipe rider:** the printed SV text was LONGER than this
  doc's shorthand ("no-W/R-on-Active flag") — it had a second "or by any effects on
  that Pokémon" clause that materially changed the op (skip the reduction too).
  **Fetch the exact tcgdex attack text before scoping any snipe/damage rider** — the
  shorthand names the family, not the whole sentence.

- ✅ **Chien-Pao ex "Hail Blade"** (D96, engine 0.47.0) — the COMPOUND
  discard-any-amount → damage-scales-off-count park, and the engine's FIRST
  **registry-AUTHORED attack** (the `programFor(id)?.attack` seam). Three gaps in
  one slice: `discardEnergy` `from: "yours"` (the whole own board, the printed
  "from your Pokémon"), `count: "any"` (the one DECLINABLE discard — a
  `DiscardScope {kind:"upTo"}` whose pick may be empty), and a §9.2
  `recordAs: "discarded"` read by a new `damageDefender` op that deals `per × N`
  to the DEFENDER through the existing `snipeActive` (so it is genuine attack
  damage — Weakness doubles it — and the printed "60×" base is SUPPRESSED).
  Chien-Pao ex **sv02-061** (verbatim tcgdex-confirmed). The D95 lesson held
  AGAIN: the print is "from **your** Pokémon" (whole board) and "for each
  **card**", both broader than this doc's shorthand. **Model A (post-damage):**
  §8 runs damage BEFORE the program, so an attack whose number depends on a
  mid-attack choice must re-enter the W/R math from inside the program.
  Behavioural tests: `hailBlade.test.ts` (engine 0.47.0, the session after —
  D96 landed under a hard autoloop landing without them).

- ✅ **Mewtwo VSTAR "Psy Purge"** (D97, engine 0.48.0) — the CAPPED Hail Blade
  shape, and the first authored attack on a MULTI-attack card. swsh10.5-031
  (verbatim tcgdex-confirmed): "Discard **up to 3** Psychic Energy from your
  Pokémon. This attack does 90 damage for each card you discarded in this way."
  Two small changes on D96's machinery: (a) `discardEnergy` gained **`cap?: number`**
  bounding the `count: "any"` up-to (the park max becomes `min(cap, offered)`; the
  wire validator was already cap-agnostic); (b) `CardProgram.attack` became
  **index-keyed** (`{ [attackIndex]: EffectOp[] }`, read as `programFor(id)?.attack?.[index]`)
  so Psy Purge is authored at idx 0 while its idx-1 "Star Raid" (a VSTAR Power)
  falls through to unsimulated instead of inheriting the discard program.
  Behavioural tests: `psyPurge.test.ts` (11). **Catalog note:** the live D1 pool's
  Pokémon GO set (swsh10.5) holds 13 Pokémon V, 2 VMAX, 5 VSTAR — the stale
  `cards.ts` "no V/VMAX/VSTAR" comment (Choice Belt dormancy) was corrected.

Still OPEN in these families: the dormant **"count-2"** snipe (D94 warning: no
verifiable real card — confirm live or take knowingly as dormant).
*(**Answered 2026-08-04**: the card exists and is NOT dormant — **Camerupt
`swsh10.5-014` "Split Bomb"**, "This attack does 50 damage to 2 of your
opponent's Pokémon." See the census below.)*

---

# 2026-08-04 — the whole-catalog re-census (978 rows / 6 sets)

⚠️ **The 2026-07-19 section above measured a NARROWER POPULATION** — the 140
un-authored **sv01–sv03** Trainers / Special Energies / Pokémon Abilities, judged
card-by-card. This section measures **every printed rules sentence in all six
sets** (978 rows: sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, swsh10.5 88),
attack text included. The numbers therefore differ by construction; the older
figures are kept as honest provenance, annotated rather than rewritten.

## Method — the built set was DERIVED, not read off a doc
Every figure below comes from a query run on
`apps/api/.wrangler/state/v3/d1/…8437d866….sqlite` on 2026-08-04, cross-joined
against the engine's own coverage seam rather than against any prose:

* **Every column that can hold printed rules text was enumerated first**, from
  `PRAGMA table_info(cards)`: `attacks_json` (per-attack `effect`), `abilities_json`
  (per-ability `effect`) and `effect` (Trainer + Special Energy). No Pokémon row
  carries a top-level `effect` (verified: 0 of 810), and **no card in the pool
  carries more than one Ability** (verified: 0 of 978) — so an ability's coverage
  is exactly its card's coverage, and the three columns are the whole surface.
* **A "printing" is a TEXT UNIT, not a card**: one attack's effect, one ability,
  one Trainer/Energy effect. **1108 units** carry printed rules text —
  **811 attack**, **160 ability**, **133 Trainer**, **4 Special Energy**.
* **BUILT** = `programFor(id)?.attack?.[index]` OR any of the six text derivers
  (`deriveAttackEffect`, `…DamageBonus`, `…DamagePenalty`, `…DamageMultiplier`,
  `…AttackCoinFlip`, `…AttackRequirement`) returning non-null for the exact printed
  string, for attacks; a registry `abilities`/`passive`/`triggered`/`stadium`/
  `energy` entry for abilities; a registry `trainer`/`stadium`/`rareCandy`/
  `passive`/`triggered`/`energy` entry for Trainers and Special Energies.
  ⚠️ **Abilities and Trainers have NO deriver** — every one of them is a registry
  row or it is unsimulated. Only attack text is derived.

## Result
| | Units | Built | **UNBUILT** |
|---|---:|---:|---:|
| attack effect text | 811 | 488 | **323** |
| ability text | 160 | 76 | **84** |
| Trainer effect text | 133 | 83 | **50** |
| Special Energy effect text | 4 | 3 | **1** |
| **total** | **1108** | **650** | **458** |

**458 unbuilt printings / 281 distinct printed sentences / 411 of 978 cards** have
at least one unsimulated sentence. Per set (printings / cards): sv01 93/84,
sv02 121/109, sv03 100/92, sv06.5 74/67, swsh10.5 70/59. `sve` is pure basic
Energy and has no rules text at all.

⚠️ **MEASURED AT A MOVING TARGET, AND IT MOVED DURING THE CENSUS.** HEAD was
`26e33f9` (D176) with `effects.ts` / `registry.ts` / `interpreter.ts` DIRTY under
another session. At HEAD the count is **462**; the working tree read **458**
because the §12 **discrete** status-clear family (the `clearStatus` op — work-list
item 1) landed mid-census. Those 4 printings — **Gardevoir ex `sv01-086`/`-228`/
`-245` "Miracle Force"** (attack idx 0) and **Blissey `sv01-145` "Busybody Nurse"**
(ability) — are the ONLY difference; `git diff` shows exactly one new op name in
the tree. **Do not re-price that family.** Every other figure here is stable
against HEAD.

## The families, ranked CHEAPEST-PER-PRINTING first
A **family = one printed SENTENCE SHAPE**, not one card. "Sentences" is the
distinct-string count inside the family; "printings" is the text-unit count.

> ## ⚠️⚠️ HOW TO RE-DERIVE ANYTHING IN THIS FILE — AND WHY EVERY NUMBER IN IT IS OVER A ROTATED-OUT POPULATION (2026-08-04, D180/D181)
>
> ### 1. The local sqlite is NOT in the repository
> It lives under `apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`, and
> `.wrangler/` is in `.gitignore` — dev state written by `wrangler dev`, not a build input.
> **A fresh clone has no local D1 at all**: `find / -name '*.sqlite'` returns zero rows, and
> `bun run scripts/catalog-manifest.ts --check` dies with `SQLITE_CANTOPEN` rather than
> reporting staleness (so it cannot even tell you the manifest is unverifiable — it crashes).
> Rebuilding it needs `apps/api/scripts/ingest.ts`, which fetches `https://api.tcgdex.net/v2/en`
> and may be blocked outright by a restricted egress policy (D180's session got **403 to the
> CONNECT**).
>
> ### 2. The REMOTE D1 is queryable, and is the practical oracle
> Cloudflare D1 database `luminous`, uuid `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, reachable via
> the Cloudflare MCP. It holds **20 sets / 3,786 rows**, and it CONTAINS the six sets the local
> D1 holds at **exactly 978 rows** — byte-identical to the population every census in this file
> and in `progress.md` was measured against.
>
> **⚠️ SO EVERY QUERY MUST BE SCOPED.** `where set_id in ('sv01','sv02','sv03','sv06.5','sve','swsh10.5')`
> — otherwise the count includes 14 sets the local D1 never had and **is not comparable to any
> documented number in this repo**. That scoping rule is the durable fact; the row count is not.
>
> ### 3. ⚠️⚠️ AND EVERY NUMBER IN THIS FILE IS OVER CARDS THAT ARE ROTATED OUT OF STANDARD
> **Legality tracks the regulation mark exactly** — this is a real rotation, not missing ingest
> data. `cards` carries `regulation_mark`, `legal_standard` and `legal_expanded`:
>
> | mark | rows | Standard-legal |
> |---|---:|---:|
> | H | 1248 | **1248** |
> | I | 736 | **736** |
> | G | 1647 | 1 |
> | F | 85 | 0 |
> | D / none | 4 | 0 |
>
> **Standard = marks H and I, plus Basic Energy** (no mark, always legal). 2,021 of the remote's
> 3,786 rows are Standard-legal — and **only 127 of the six-set 978 are** (98 from `sv06.5`, 24
> `sve` Basic Energy, 5 stragglers; `swsh10.5` is **0 of 88**, and sv01/sv02/sv03 are 2/2/1, all
> Basic Energy).
>
> **So the D179 census below — 458 unbuilt printings, and the whole cheapest-per-printing
> ranking built on it — ranks families over a population that is almost entirely illegal.**
> Do not read those rankings as current. They are a true census of a rotated-out pool.
>
> ### 4. The rule that follows, and it is the point of this note
> **A census owes a POPULATION *and* a LEGALITY.** This repo already learned the first half the
> hard way (D154–D160, the `890 rows / 5 sets` episode); the second is new with D181. Quote both,
> always, and mark an uncounted legality as *not measured* rather than as zero.
>
> ⚠️ **A DERIVER ARM SURVIVES THE ROTATION AND A REGISTRY ROW DOES NOT.** An arm is a TEXT
> PARSER and printed sentences transfer across sets — D181's four anchors serve **34 measured
> Standard-legal printings against 19 at six-set scope**. A registry row is keyed by CARD ID and
> serves exactly the printings it names; D180's four aliases serve **zero** Standard-legal
> printings, because all four ids are rotated out. Weight the tiers accordingly.
>
> ### 5. In-repo substitutes when no database is reachable at all
> 1. `packages/engine/src/testFixtures.ts` — `FIXTURE_POOL` real-card fixtures carry **verbatim
>    printed effect text**. The best source there is.
> 2. Existing `packages/engine/src/*.test.ts` — many pin printed sentences as string literals,
>    often with the catalog id in a comment (`flipGatedOp.test.ts`'s `REAL_NEAR_MISSES` is a
>    verbatim D1 transcription).
> 3. `packages/engine/src/catalogManifest.ts` — committed counts, plus per-fixture names, types,
>    attack NAMES and ability NAMES. ⚠️ **No effect text at all.**
> 4. This file and `docs/workstreams/simulator.md` — prose, i.e. exactly the class of claim this
>    repo's own standing warnings say rots.
>
> ⚠️ **The failure mode to fear is a SILENTLY DEAD REGEX.** `deriveAttackEffect`'s anchors are
> `^…$` with a required trailing period, so a sentence paraphrased out of prose yields a regex
> that matches no real card, passes a test written against the same paraphrase, and is invisible.

### Tier 0 — a REGISTRY MAP ENTRY. No new code at all. ✅ **BUILT — D180.**
| Family | Printings | Sentences | The rows |
|---|---:|---:|---|
| ~~**Reprint-alias gaps**~~ ✅ **BUILT (D180)** | **4** | 3 | **`sv02-245` Copperajah ex** "Bronze Body" → `COPPERAJAH_EX` · **`swsh10.5-069` Rare Candy** → `RARE_CANDY` · **`swsh10.5-078` + `swsh10.5-084` Professor's Research** → `PROFESSORS_RESEARCH` |

This is the whole of it: a full text-equality sweep of unbuilt against built over
all three columns returns **3 sentences / 4 printings** and nothing else.

✅ **All four printings are MEASURED byte-identical to their twins** against the
978-row / 6-set catalog (2026-08-04, remote D1). ⚠️ **But the SWEEP that says
there are no OTHERS has still never been re-run by anyone** — D180 shipped
without a reachable catalog and nobody has run it since. The exact scoped SQL is
in `packages/engine/src/reprintAlias.test.ts`; the emptiness is deliberately NOT
pinned, because a pin claiming a measurement nobody made goes green forever.

⚠️⚠️ **AND ALL FOUR IDS ARE ROTATED OUT OF STANDARD** (`swsh10.5` mark F, `sv02`
mark G), so **Tier 0 served ZERO Standard-legal printings.** Correct rows, four
lines, no coverage. **This is the standing rule for reading every tier below:** a
REGISTRY ROW is keyed by CARD ID and serves exactly the printings it names, while
a DERIVER ARM is a TEXT PARSER whose sentences transfer across sets — D181's four
anchors serve 34 Standard-legal printings against 19 at six-set scope. **Never
price the two on the same scale, and never rank a tier by its six-set count
alone.**

### Tier 1 — ONE DERIVER ARM on an op that already exists. Zero new ops, zero registry rows.
Attack text is derived, so every one of these is a regex + a `return` in
`deriveAttackEffect`.

| Family | Printings | Sentences | Existing op | The rows |
|---|---:|---:|---|---|
| ~~**Draw, in attack text**~~ ✅ **BUILT (D181)** — the two printed sentences are `Draw a card.` ×7 and `Draw 2 cards.` ×5; there is no other count. **22 + 9 = 31 Standard-legal printings.** | **12** | 2 | `drawCards` | `sv01-077` Wattrel "Collect" · `sv01-155` Lechonk "Collect" · `sv01-164` Cyclizar "Touring" · `sv02-046` Delibird "Double Draw" · `sv02-100` Tinkatink "Collect" · `sv02-166` Tandemaus "Collect" · `sv03-001` Oddish "Feelin' Fine" · `sv03-079` Miraidon ex "Rapid Draw" · `sv03-154`/`sv03-206` Varoom "Spinning Draw" · `sv03-165` Kangaskhan "Spike Draw" (idx 1) · `sv06.5-003` Rowlet "Add On" (all idx 0 unless noted) |
| ~~**Draw-until, in attack text**~~ ✅ **BUILT (D181)** — N is **always 7**; the "N" here was a generalisation. **1 Standard-legal printing.** | **3** | 1 | `drawUntilHandSize` | `sv03-080`/`sv03-202` Cleffa "Grasping Draw" idx 0 · `sv06.5-005` Decidueye "Stock Up on Feathers" idx 0 |
| ⚠️ **Self-switch, in attack text** — **STILL UNBUILT, AND THIS ROW'S PRICE IS WRONG.** D181 measured it and refused it: `switchActive` exists, but deriving it from ATTACK text lets the attacker leave the Active Spot mid-attack, and `finishAttack` addresses the Attacking Pokémon as `players[attackerSeat].active` — an invariant `vengefulPunch.test.ts` SWEEPS and whose repair it names (a required uid on the `attackEpilogue` `PendingStage`, which is PERSISTED → **a `MATCH_RECORD_VERSION` bump**). The 2 "You may" printings additionally need the D186 confirm-park. **10 Standard-legal printings.** NOT "one regex + one return". | **9** | 3 | `switchActive` | bare (6): `sv01-063` Magnemite "Magnetic Switch" idx 0 · `sv01-102` Flittle "Dash Off" idx 0 · `sv01-143`/`-233`/`-248` Iron Treads ex "Cybernetic Wheels" **idx 1** · `sv02-131` Murkrow "Spin Turn" idx 0 — flip-gated (1): `sv02-022` Bramblin "Ride the Wind" idx 0 (`coinFlipGate` already exists) — **"You may" (2)**: `sv03-033` Victini ex / `sv03-057` Frogadier "Strafe" idx 0, which need an OPTIONAL wrapper the vocabulary does not have |
| ~~**Gust, in attack text**~~ ✅ **BUILT (D181)**, both sentences (bare + `coinFlipGate`). **2 Standard-legal printings** measured on the bare one; the gated one is not measured. ⚠️ The flip-gated printing is attributed to **Bombirdier** by `flipGatedOp.test.ts`'s verbatim D1 transcription (D134) and to Tarountula `sv01-016` here; there is exactly ONE such printing, so one attribution is wrong — UNRESOLVED. | **4** | 2 | `gust` | `sv01-129` Spiritomb "Taunt" idx 0 · `sv03-002`/`sv03-198` Gloom "Inviting Scent" idx 0 · flip-gated: `sv01-016` Tarountula "String Haul" idx 0 |
| **Deck-search-and-attach-to-SELF, in attack text** | **7** | 5 | `attachFromDeck` (`toSelf` already exists) | `sv01-028` Capsakid "Increasing Spice" · `sv01-031` Growlithe "Stoke" · `sv02-064`/`sv02-211` Raichu "Electrocharge" · `sv03-153` Melmetal ex "Metal-bolize" · `sv06.5-053`/`sv06.5-079` Bewear "Power Charger" (all idx 0) |
| **The K-target snipe count widening** — "…does N damage to **K** of your opponent's Pokémon." K≥2. `damageChosen.count` is ALREADY a number; only the regex pins it to 1 | **5** | 3 | `damageChosen` | `sv01-143`/`-233`/`-248` Iron Treads ex "Triple Laser" idx 0 (K=3) · `swsh10.5-014` Camerupt "Split Bomb" idx 0 (K=2 — **this is D94's "count-2" card, and it is real**) · `sv06.5-047` Kyurem "Trifrost" idx 0 (K=3, behind a discard-all clause) |
| **Item-card discard-pile retrieval, in attack text** — "Put an Item card from your discard pile into your hand." | **4** | 1 | `discardPileRetrieval` + **one new `CardFilter` kind `itemCard`** | `sv01-070` Rotom "Junk Hunt" · `sv02-101`/`sv02-216` Tinkatink "Scrap Pickup" · `swsh10.5-019` Slowpoke "Ideal Fishing Day" (idx 1) |

**Tier-1 total: 44 printings for 7 regexes and 1 filter kind.** ⚠️ **19 of them are BUILT
(D181: draw, draw-until, gust) and 9 are RE-PRICED as a persisted-shape change, not a regex
(D181: self-switch).** 16 remain at the stated price.

### Tier 2 — one new FIELD / union member on an existing mechanism.
| Family | Printings | Sentences | The price | The rows |
|---|---:|---:|---|---|
| **Damage-scaling COUNT SOURCES** — 4 new `DamageCountSource` members, each 1 regex + 1 arm in `scaledAttackDamage`. The fold, the pre-W/R plumbing and the `per ≥ 1` guard all exist ⚠️ **28 → 33: the discard-pile sub-row was 5 printings short** | **33** | 19 | 4 union members | see the four sub-rows below |
|  ↳ **Energy attached to THIS Pokémon** (typed and untyped; the `providesEnergy` predicate already answers "an Energy that provides {X}") | 10 | 9 | 1 member `energyOnSelf {energyType?}` | `sv01-047` Floatzel "Hydro Pump" · `sv03-030` Entei "Blaze Ball" · `sv03-089` Mawile "Mischievous Crunch" · `sv03-153` Melmetal ex "Full Metal Knuckle" idx 1 · `sv06.5-012`/`sv06.5-080` Kingdra ex "Hydro Pump" idx 1 · `sv06.5-073` Fezandipiti "Energy Feather" · `swsh10.5-016` Wartortle "Hydro Pump" idx 1 · `swsh10.5-017` Blastoise "Hydro Pump" · `swsh10.5-034` Lunatone "Moon Kinesis" idx 1 |
|  ↳ **Energy attached to the OPPONENT** (Active, and whole board) | 7 | 4 | 1 member `energyOnOpponent {zone}` | `sv01-085`/`sv01-212` Kirlia "Psychic" idx 1 · `sv01-103` Espathra "Psychic" idx 1 · `sv03-038` Chandelure "Combustion Chain" · `sv03-039` Heatmor "Energy Burner" · `sv01-065`/`sv01-226` Magnezone ex "Energy Crush" (whole board) |
|  ↳ **Cards in your DISCARD PILE** matching a filter ⚠️ **the 7/4 was WRONG — re-measured 2026-08-04 at 12 printings / 5 sentences** (the row already listed 12 ids) | 12 | 5 | 1 member + 3 filter kinds (by attack NAME, by Pokémon TYPE, by card NAME) | `sv02-080` Wattrel / `sv02-131` Murkrow / `sv02-170`+`sv02-227` Flamigo / `sv06.5-004` Dartrix **"United Wings"** (5, and the filter is *"has the United Wings attack"* — an ATTACK-NAME predicate the vocabulary has never needed) · `sv01-104`/`sv01-214` Greavard "Graveyard Gamboling" + `sv01-106` Houndstone / `sv03-102` Houndstone ex "Last Respects" (typed) · `sv01-061`/`sv01-207` Dondozo "Release Rage" + `swsh10.5-021` Magikarp "Raging Fin" (by name) |
|  ↳ **The opponent's Benched COUNT** | 4 | 1 | 1 member | `sv01-158`/`sv01-234` Oinkologne ex "Maddening Scent" · `sv02-135`/`sv02-222` Tyranitar "Rout" (all idx 0) |
| **Main-hit damage-modifier SUPPRESSION** — the D95 riders, at the MAIN-HIT read site instead of the snipe's | **10** | 2 | 2 boolean flags | *"This attack's damage isn't affected by Resistance."* (4): `sv01-110` Meditite "Feint" · `sv02-006`/`sv02-194` Heracross "Smashing Horn" idx 1 · `sv03-025` Scovillain "Spicy Headbutt" — *"…isn't affected by any effects on your opponent's Active Pokémon."* (6): `sv02-104`/`sv02-217` Tinkatuff + `sv02-240`/`sv02-262` Tinkaton ex "Pulverizing Press" idx 1 · `sv03-078`/`sv03-201` Bellibolt "Thunderous Edge" |
| **`moveEnergy` self→Bench** — the mirror of the built `benchToActive` route | **7** | 2 | 1 route value + `count: "all"` | "Move an Energy…" (4): `sv02-118` Passimian "Make the Assist" · `sv03-085` Togekiss "Power Cyclone" · `swsh10.5-030`/`swsh10.5-072` Mewtwo V "Transfer Break" idx 1 — "Move all Energy…" (3): `sv01-145` Blissey "Happy Cyclone" · `sv02-007`/`sv02-195` Tropius "Tropic Breeze" idx 1 |
| **The `anyCard` search filter** — "search your deck for **a card** / **up to N cards**" | **14** | 7 | 1 filter kind (+ per-card riders) | `sv01-131`/`sv01-232` Toxicroak ex "Nasty Plot" · `swsh10.5-035` Sylveon "Souvenir" · `swsh10.5-042` Alolan Raticate "Chase Up" · `sv02-086`/`sv02-238` Slowking ex "Wise Headbutt" idx 1 ("You may") · `sv03-164`/`-217`/`-225` **Pidgeot ex "Quick Search"** (ability) · `sv06.5-056`/`-086`/`-094` **Cassiopeia** (Supporter; also needs a "last card in your hand" gate) · `sv02-178` Delivery Drone (2-coin gate) · `sv02-085` Slowpoke "Tail-Fishing" (needs a tails `otherwise` arm). A separate 3 printings want a **"a card that evolves from X"** search, not this filter: `sv01-153` Indeedee · `sv02-124` Glimmet · `sv03-060` Finizen |
| **Once-per-turn BY NAME** — the printed "You can't use more than 1 *X* Ability each turn". `cardplay.ts` keys `abilitiesUsed` on `` `${uid}:${ability.name}` `` — per COPY. The print is per NAME, across copies | **13** | 4 | drop `uid` from the key, behind a new flag | `sv03-164`/`-217`/`-225` Pidgeot ex · `sv06.5-038`/`-084`/`-092` Fezandipiti ex · `sv02-169`/`-247`/`-264` Squawkabilly ex · `sv06.5-039`/`-085`/`-093`/`-095` Pecharunt ex. ⚠️ **A GATE ONLY** — every one of these four cards ALSO needs its body op, so this row unlocks nothing alone; it is a prerequisite the four rows above/below share |

### Tier 3 — a genuinely NEW OP.
| Family | Printings | Sentences | The rows |
|---|---:|---:|---|
| **The opponent-chooses SWITCH-OUT** — "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)" | **16** | 6 | attacks (11): `sv01-154` Lechonk "Repelling Odor" · `sv02-014`/`sv02-197` Floragato "Magic Whip" idx 1 · `sv02-164`/`sv02-225` Rookidee "Send Back" · `sv03-065` Magnezone "Magnetic Repulsion" ("You may") · `sv02-052`/`-235`/`-260`/`-273` Quaquaval ex "Exciting Dance" + `sv03-094` Baltoy "Rapid Spin" (compound: self-switch **then** this) — abilities (3): `sv01-137`/`sv01-218` Mabosstiff "Intimidating Howl" · `sv02-068` Shinx "Big Roar" — Supporters (2): `sv03-194`/`sv03-221` **Ryme** (`drawCards 3` + this). Near-twin, same op with a status rider: `sv01-082`/`sv01-210` Drowzee "Forced Sleep" (*"Your opponent chooses 1 of their Benched Pokémon and switches it…"* — **a different VERB for the same mechanic**) |
| **`discardStadium`** — "Discard a Stadium in play." / "You may discard a Stadium in play." | **7** | 2 | `sv01-123`/`-230`/`-246` Great Tusk ex "Bedrock Breaker" · `sv02-031` Litleo "Blazing Destruction" · `sv03-164`/`-217`/`-225` Pidgeot ex "Blustery Wind" (all idx 0). **Pidgeot ex needs this AND the `anyCard` filter AND the by-name gate** — build the three and Pidgeot ex is finished whole |
| ~~**The card-type PLAY LOCK**~~ ✅ **BUILT IN STANDARD ON BOTH SURFACES (D283 attacks, D284 abilities)** — "…they can't play any *X* cards from their hand." | **7** (this row's OUT-OF-STANDARD population; the STANDARD census is **8 attacks + 7 abilities**, measured 2026-08-08) | 5 | ✅ **ATTACK HALF, D283** — `preventHandPlay` + `GameState.handPlayLockedTurn` (a per-seat × per-class TURN STAMP), 8 legal Standard printings on 3 sentences: Scream Tail ex `sv06-094`/`-197` (Supporter) · Budew `sv08.5-004` + Frillish `sv10.5w-044`/`-126` (Item) · Galvantula ex `sv07-051`/`-159`/`-168` (Item, behind a printed cost). ✅ **ABILITY HALF, D284** — `PassiveEffects.preventOpponentHandPlay: readonly HandPlayClass[]` (a CONTINUOUS Active-Spot scan read through the SAME widened `handPlayBarred` funnel), 4 of 7 legal Standard printings on 2 sentences: `sv09-095` Tyranitar "Daunting Gaze" (Item) · `sv10.5w-045`/`-160`/`-168` Jellicent ex "Oceanic Curse" (Item **or Tool** — the Tool half is a FOURTH read site, `cardplay.ts attachTool`). ⚠️ **STILL REFUSED, WITH THE MISSING MECHANISM NAMED (D284)**: `sv06.5-042` Copperajah "Massive Body" (Stadium — the CLASS is spellable, the READ is not; `redactedTrainersOf` skips Stadium rows entirely, so **a Stadium payability mirror on the wire is missing**) · `sv10-113` Team Rocket's Arbok "Potent Glare" (a POKÉMON play + a has-an-Ability filter + an owner-prefix exception — **a play-from-hand gate for the Pokémon surface is missing**, same seam as `sv05-069` Bronzong's evolve-bar) · `sv06.5-040` Genesect "ACE Nullifier" (⚠️ its window is *"If this Pokémon has a **Pokémon Tool attached**"*, **NOT** the Active Spot — D283's note said otherwise and was wrong; and **ACE SPEC is a RARITY axis orthogonal to `trainerType`**, `rarity = "ACE SPEC Rare"` / 33 legal rows, so **an engine-side ACE SPEC classifier is missing** and reading a rules property off a rarity label is an INGEST call). The out-of-Standard rows below are unchanged and unbuilt: `sv01-088`/`sv01-229` Banette ex "Everlasting Darkness" (Item) · `sv01-087` Shuppet "Enveloping Shadow" (Item, flip-gated) · `sv02-153`/`sv02-246` Noivern ex "Dominating Echo" idx 1 (Special Energy **or** Stadium) |
| **Multi-status + both-Actives** — "is now X **and** Y", "is now X, Y, **and** Z", "**Both** Active Pokémon are now X" | **7** | 6 | `sv03-010` Amoonguss "Dangerous Spores" + `swsh10.5-007` Ariados "Poison String-Up" (Paralyzed **and** Poisoned) · `sv06.5-058` **Dangerous Laser** (Item — Burned and Confused) · `swsh10.5-004` Radiant Venusaur "Pollen Hazard" (Burned, Confused, **and** Poisoned) · `swsh10.5-003` Venusaur "Loopy Lasso" (ability) · `sv03-129` Paldean Clodsire "Splattering Poison" + `swsh10.5-020` Slowbro "Tumbling Tackle" (**both** Actives) |
| **The flip-to-attack lock** — "During your opponent's next turn, if the Defending Pokémon tries to attack, your opponent flips a coin. If tails, that attack doesn't happen." | **4** | 1 | `sv01-022`/`sv01-200` Dolliv "Apply Oil" idx 1 · `sv02-049`/`sv02-206` Quaxly "Apply Gel" idx 0 |

## The five to build next
| # | Family | Price | Why |
|---|---|---|---|
| 1 | **Opponent-chooses switch-out** | 1 new op + 1 deriver arm + 3 registry rows | **16 printings for one primitive — the single largest unlock in the census**, and it reaches all three columns (attacks, abilities, a Supporter) at once. The cross-seat decision machinery it needs already exists (`opponentMayDraw`'s `decider`/`answerer`, engine 0.32.0) |
| 2 | **The draw + switch DERIVER ARMS** (draw 12, draw-until 3, self-switch 9, gust 4) | 4 regexes, **zero new ops, zero registry rows** | **28 printings for four `return`s.** Every op already exists and is already tested on the Trainer path; the deriver simply has no arm for them. Cheapest printing-per-line in the whole backlog |
| 3 | **The four damage-scaling COUNT SOURCES** | 4 `DamageCountSource` members + 4 regexes | **28 printings** onto a fold (`scaledAttackDamage`) that has absorbed six members already with no new argument. The Energy-on-self member is free of new predicate work — `providesEnergy` / `unitsProvidedBy` already answers it |
| 4 | **Main-hit damage-modifier suppression** | 2 boolean flags at the §8.5 read site | **10 printings for two flags**, and the semantics were already settled once by D95 for the snipe (`damageChosen.ignoreWR` nulls W/R *and* the target's `damageReductionAfterWR`). This is that decision applied at the main hit |
| 5 | **`discardStadium` + the `anyCard` filter + once-per-turn-by-name** | 1 op + 1 filter kind + 1 gate flag | 7 + 14 + 13 printings with heavy overlap, and together they **finish Pidgeot ex `sv03-164`/`-217`/`-225` whole** (all three of its printed sentences). Buying three small primitives that share three cards is better value than any one of them alone |

**Highest UNLOCK per primitive** (ignoring cost): opponent-chooses switch-out (16),
the `anyCard` filter (14), once-per-turn-by-name (13), draw (12), main-hit
suppression (10), Energy-on-self scaling (10).

## ⚠️ Families whose cost is NOT the parse
The repo's repeated surprise. Each of these is cheap to *recognise* and expensive
somewhere else:
* **Opponent-chooses switch-out (16)** — the park must be answered by the
  NON-controller. The engine can express that (`decider`/`answerer`), but the HUD
  has to *offer* a decision to the seat whose turn it is not. **A render/answerer
  surface, not a parse.**
* **The flip-to-attack lock (4)** — the coin is flipped by the OPPONENT at *their*
  attack-declaration time. That is a new DETECTION SITE (a gate inside the attack
  action) plus a park owned by the defender.
* **The card-type play lock (7)** — needs a per-seat next-turn restriction channel,
  a gate in `cardplay.ts` for each card class, **and** the HUD greying, or the
  player is offered a card that will be refused. Three read sites for one sentence.
* **Once-per-turn by name (13)** — the projection greys a used Ability by uid; a
  name key changes what the HUD must compute, not just what the engine allows.
* **`discardStadium` (7)** — discarding the Stadium must also STOP its continuous
  effects (`continuous.ts` reads the zone), and needs its own public event.
* **Penny `sv01-183`/`-239`/`-252` (3, bounce-to-hand)** — the printed target is
  "1 of your **Basic** Pokémon"; bouncing the ACTIVE needs mid-turn promotion,
  which is flow work, not op work. (Unchanged from the 2026-07-19 note.)
* **Poké Vital A `sv06.5-062`** — `healChosen 150` is authorable **today**, but its
  second sentence ("This card can't be put into your hand or deck from the discard
  pile") has **no reader** — D159's finding, re-confirmed: no `CardFilter` names an
  Item, so nothing can currently retrieve it and the omission is inert. Author it
  knowing the sentence is unenforced, or wait for `itemCard`.

## LIST ROT — what the 2026-07-19 section says that is no longer true
Verified card-by-card against the 978-row catalog, not against prose.

| The old entry | What the census found |
|---|---|
| `statusImmunity` — *2 — Dachsbun* | **BUILT.** `sv02-020` Dachsbun has 0 unbuilt units; the §12 family closed 4/4 at D172 |
| `preventDamageFromType` — *2 — Bellibolt* | **BUILT** (`PassiveEffects.preventDamageFromType`). Bellibolt's 4 remaining unbuilt printings are two OTHER sentences: `sv02-079`/`-237` "Paralyzing Ball" (an optional discard buying a status) and `sv03-078`/`-201` "Thunderous Edge" (the main-hit suppression row above) |
| `drawUntil` — *2 — Togekiss* | **THE OP IS BUILT** (`drawUntilHandSize`, engine 0.20.0) and **the count was wrong**: the family is **4 printings / 4 distinct sentences** — `sv03-085` Togekiss "Precious Gift", `swsh10.5-004` Radiant Venusaur "Sunny Bloom", `sv06.5-029` Crobat "Shadowy Envoy", plus `sv03-144` Bronzor "Mirror Draw" (*"…until you have the same number of cards in your hand as your opponent"* — a variable size). What is missing is the **end-of-your-turn Ability TIMING**, not the op |
| `coinFlipDamagePrevention` — *2 — Jumpluff/Skiploom* | ✅ **BUILT AT D258, AND THIS CELL WAS WRONG TWICE OVER — WHICH IS THE LESSON.** It said 2, then a re-measure said 3+1, and the STANDARD-LEGAL truth is **5 printings on 2 sentences and NONE of the cards this row names**: Fezandipiti `sv06-096`/`sv06.5-073`/`sv08.5-045` "Adrena-Pheromone" (3) and Kecleon `sv08-150`/`sv08-213` "Expert Hider" (2). Skiploom `sv02-002`, Jumpluff `sv02-003` and Ambipom `swsh10.5-057` print Kecleon's sentence VERBATIM and are all `legal_standard = 0` — ROTATED OUT, so the field carries them unchanged the day the format moves. 🆕 **A COUNT IN A BACKLOG CELL ROTS EXACTLY LIKE ONE IN A TEST, AND A CELL THAT NAMES CARDS CAN BE STALE IN ITS *SUBJECT* AND NOT JUST ITS NUMBER — re-measure the row you are about to build even when another doc already states it.** Built as `PassiveEffects.preventDamageOnCoinFlip` + the prevent family's first funnel, `continuous.ts coinFlipShieldPrevents`; `MATCH_RECORD_VERSION` unchanged at 13. See `packages/engine/src/expertHider.test.ts` and backlog row **15-C** in `coverage-backlog-legal.md`. |
| `canEvolveEarly` — *2 — Scatterbug/Spewpa* | **Confirmed exactly 2** (`sv01-008`, `sv01-009`), still unbuilt. No rot |
| `attachEnergyFrom` remaining 7: *…Charizard ex…Pawmot…* | **Charizard ex is BUILT** (all 8 of its text units). **Pawmot is 5/6 BUILT** — the only unbuilt Pawmot printing left is `sv03-073` **Pawmot ex** "Levin Strike" idx 1, a different card and a different sentence. Still unbuilt from that list: Forretress ex `sv02-005`/`-230`, Geeta `sv03-188`/`-218`/`-226`, Wigglytuff `sv02-084` |
| `discardOpponentEnergy` remaining 1: *Klawf ex* | **BUILT** (D101). `sv03-120` has 0 unbuilt units |
| `moveEnergy` remaining 2: *Mismagius, Exp. Share* | **Exp. Share `sv01-174` is BUILT** (D171). Mismagius `sv02-088`/`sv02-212` still unbuilt |
| "Next candidates" cell: *the four "damage per {C} of the opponent's Retreat Cost" attacks* and *Spidops ex "Trap Territory"* | **BOTH ROWS CLOSED.** All 6 printings of the retreat-cost scaling (Heracross `sv01-002`, Spidops ex `sv01-019`/`-223`/`-243`, Sharpedo `sv03-047`, Stoutland `sv03-172`) are built, and Spidops ex has 0 unbuilt units across all 6 of its text rows |
| *Still OPEN: the dormant "count-2" snipe (no verifiable real card)* | **THE CARD IS REAL AND LIVE: `swsh10.5-014` Camerupt "Split Bomb"** — *"This attack does 50 damage to 2 of your opponent's Pokémon."* It entered the pool with swsh10.5, after the sv01–sv03 census that raised the warning. Not dormant |
| *No Marnie exists in the sv01–03 catalog* | **Still true, and now true of ALL SIX SETS**: `name LIKE '%Marnie%'` returns 0 rows of 978 |
| Choice Belt: *the SV-era pool holds no Pokémon V* | Already corrected at D97 and **re-confirmed by query**: 13 Pokémon V, 2 VMAX, 5 VSTAR, **all in swsh10.5**; 132 `ex`; 0 GX |
| *Long tail (~70 single-card ops)* | The real remainder over the whole catalog is **281 distinct unbuilt sentences / 458 printings**. The "~70" was a count over the 140-card sv01–03 slice and should not be read as a catalog figure |
| Next-candidates: *`moveDamageCounters` (Slowbro `sv01-043`)*, *`bounceToHand` (Penny)* | **Both still unbuilt**, unchanged. (Slowbro `swsh10.5-020` is a DIFFERENT Slowbro with two unbuilt attacks — "Tumbling Tackle" is in the both-Actives status row) |

## ⚠️ THE VERB LEDGER — predicates tried that returned NOTHING
The standing warning is that **a census is only as wide as its verbs**. Every
predicate below was run against **all three text columns** of all 978 rows. The
ZERO rows are the point: they are what nobody needs to run again.

| Mechanic | Predicate | Result |
|---|---|---|
| §12 status recovery | `recovers from` | **5** (the family; 4 of them the mid-census `clearStatus` landing) |
| §12 | `is no longer (Asleep\|Confused\|Paralyzed\|Poisoned\|Burned)` | **ZERO** |
| §12 | `remove(s)? all Special Conditions` | **ZERO** |
| §12 | `heal(s)? all Special Conditions` | **ZERO** |
| §12 | `is cured` | **ZERO** |
| §12 | `(isn't\|not) affected by Special Conditions` | **ZERO** |
| §12 | `Special Conditions? (are\|is) removed` | **ZERO** |
| status application | `becomes? (Asleep\|Confused\|Paralyzed\|Poisoned\|Burned)` | **ZERO** — the pool says "is now", never "becomes" |
| status application | ⚠️ `make .{0,60}(Poisoned\|Burned\|…)` | **4, ALL UNBUILT** — `sv02-079`/`-237` Bellibolt ex "Paralyzing Ball", `sv02-130`/`-244` Paldean Clodsire ex "Toxic Wetland". **An "is now" sweep misses every one of them.** This is the D174 lesson repeating on a second family — and note a `{0,30}` window returns ZERO here, a FALSE negative caused by the window, not by the verb |
| switch | `swap` | **ZERO** |
| switch | `return .{0,60}to the Bench` | **ZERO** |
| switch | `put .{0,60}in(to)? the Active Spot` | **ZERO** — the pool always says "switch in" |
| switch | `becomes? the Active` | **ZERO** |
| switch | ⚠️ `[Yy]our opponent (chooses\|switches)` | **18** — the 16-printing family **plus 2 the family regex misses**: `sv01-082`/`sv01-210` Drowzee "Forced Sleep" |
| draw | `take \d+ cards` | **ZERO** |
| draw | `put the top .{0,60}into your hand` | **ZERO** |
| damage scaling | `times the number` | **ZERO** |
| damage scaling | `multiplied by` | **ZERO** |
| damage scaling | `damage equal to the number` | **ZERO** |
| damage scaling | `×` / `x the number` (in TEXT) | **ZERO** — the "×" lives in the `damage` COLUMN (199 attacks carry a non-numeric damage suffix), never in effect text |
| damage modifiers | `[Ii]gnore` | **ZERO** — the pool only ever says "isn't affected by" |
| damage modifiers | `regardless of` | **ZERO** |
| damage modifiers | `without applying` | **ZERO** |
| healing | `remove .{0,40}damage counters` | **ZERO** — healing is always "Heal N damage from…" |
| bounce | `return .{0,60}to (your\|their) hand` | **ZERO** — the pool says "put … into your hand" |
| Stadium removal | `Stadium .{0,40}discard` / `put a Stadium .{0,20}discard` / `discard that Stadium` / `the Stadium (card )?in play` | **ZERO** — "Discard a Stadium in play." is the only wording |
| ability lock | `can't use (any )?Abilit` | **ZERO** as written; **16 with the wider `can't use .{0,40}Abilit`**, of which 13 are the once-per-turn-BY-NAME rider, not a lock. Another window-width false negative |
| Supporter hand-refresh | `name LIKE '%Marnie%'` | **ZERO rows** |
| pre-SV rule boxes | `name LIKE '%-GX'` | **ZERO rows** |

**Two false negatives were produced and caught while writing this ledger**, both
from a too-narrow `.{0,N}` window (`make …` and `can't use … Ability`). **Widen
the window before recording a ZERO** — a bounded wildcard is itself a predicate.

## Structural notes for whoever builds next
* **323 of the 458 unbuilt printings are ATTACK text** — derivable, i.e. payable in
  regexes rather than registry rows. **84 are Abilities and 50 are Trainers, and
  those have no deriver at all**: each is a hand-authored registry row forever. The
  cards-per-line-of-code ratio is therefore much better on the attack side, which
  is where all of Tier 1 sits.
* **The last unbuilt Special Energy is `sv02-192` Reversal Energy** — the only one
  of the four printed Special Energies with no program. Its text is a conditional
  wildcard provision gated on BOTH a Prize comparison and the holder being a
  no-rule-box Evolution: `morePrizesThanOpponent` exists (D40), `hasRuleBox` exists
  (D102), `evolveFromOf` exists (D105) — the three predicates are all built, and
  what is missing is a **conditional `provides`** in `EnergyProgram`.
* **`sv01-129` Spiritomb** is described elsewhere as "deliberately unregistered
  (no Ability)". True of its Ability; its ATTACK "Taunt" is a plain gust and is in
  the Tier-1 gust row.
* The population figure to quote is **978 rows / 6 sets**, measured 2026-08-04
  against HEAD `26e33f9` with `effects.ts`/`registry.ts`/`interpreter.ts` dirty.
