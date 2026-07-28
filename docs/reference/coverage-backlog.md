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
| ✅ **`onDamagedByAttack`** (a trigger firing when damaged by an attack, even if KO'd) | 4 | **DONE — row CLOSED 4/4.** ~~Cacnea, Cacturne~~ (covered by the `damageAttacker` PASSIVE, D98 — counters-on-attacker, no trigger needed), ~~**Armarouge**~~ (sv03-044 "Scorching Armor" → Burn the attacker — D99, engine 0.50.0: the general trigger, a new `TriggerTiming` `onDamagedByAttack` firing a NON-parking `applyStatus`), ~~**Klawf ex**~~ (sv03-120 "Counterattacking Pincer" → discard an Energy from the attacker — **DONE, D101, engine 0.52.0**, the PARKING opponent-side discard). D101 made the trigger a STAGED `damagedTrigger` PendingStage (the twin of `koTrigger`): attack.ts records it at damage time and seeds it AFTER the attack's own effect program, BEFORE the attackEpilogue; flow.ts `runDamagedTrigger` folds it through settleProgram with `resumeTail` **under the DAMAGED seat**, so — like an on-KO trigger — the DEFENDER is the answerer (no `decider`/`answerer`), the attacker still owns the turn (`koParkActiveSeat` reads the attackEpilogue behind the park), finishAttack resumes after the pick ("even if KO'd" free; Klawf ex prizes 2). D99's inline `runDamagedByAttackTriggers` became the `damagedByAttackAbility` gated lookup; Armarouge's Burn rides the same staged path byte-identically. `counterattackingPincer.test.ts` (8). (Out of this sv01–sv03 row but in the pool: Fezandipiti sv06.5-073 "Adrena-Pheromone" — a coin-flip damage-PREVENTION-on-damaged read, a different shape.) |
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
`seatRemovesWeakness` scan; the FIRST long-tail passive aura), `noRetreatCostAura`
(Clefable ex), `retaliationDamage` (Rocky Helmet), `preventDamageFromExV`
(Mimikyu), the Iono/Judge prize-count draws, per-card search filters
(`searchFilter:{itemCard,toolCard,evolutionPokemon,…}`), and several bespoke
passives/triggers. Full list in the fan-out result. Many collapse into a few
parameterized ops (an `attachEnergyFrom` with source/filter params; a
`conditionalGate` family; extra `CardFilter` kinds), so the real op count to build
is well under 70.

### Landed from the long tail
| Card | id | Op | Engine |
|---|---|---|---|
| Picnic Basket | sv01-184 | `healEachAll` (heal 30 from EVERY Pokémon, both boards; non-parking, seat-blind twin of `healEach`) | 0.54.0 (D103) |
| Florges | sv01-093 | `removeWeakness` (own-board "no Weakness" aura; a `PassiveEffects` flag + `seatRemovesWeakness` scan gated through `disabledAbilityUids`, wired into both W/R read sites) | 0.55.0 (D104) |
| Next candidates | — | `moveDamageCounters` (Slowbro sv01-043, repeatable parking Ability) · more `CardFilter` kinds (`itemCard`/`evolutionPokemon`, the cheapest) · `bounceToHand` (Penny — real print is "Basic Pokémon", so an Active bounce needs mid-turn promotion) | — |

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
