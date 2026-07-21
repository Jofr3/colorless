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
| ✅ **`discardPileRetrieval`** (put/shuffle cards from discard → hand/deck) | 6 | **DONE 3/6** (engine 0.15.0, the searchDeck mirror + `supporter`/`pokemonOrBasicEnergy` filters): **Energy Retrieval** (2 Basic Energy → hand), **Pal Pad** (2 Supporters → deck), **Super Rod** (3 Pokémon/Basic Energy → deck). Remaining 3 need MORE: Superior Energy Retrieval (`discardFromHandCost`), Miriam (a conditional "if you shuffled any, draw 3" — a new gate), Pelipper (an Ability, not a Trainer). |
| ✅ **`lookAtTopN`** (reveal/take a matching card from the top N) | 5 | **DONE 2/5** (engine 0.16.0, the top-of-deck twin of searchDeck: candidates are the top-N matches, then a trailing shuffle): **Great Ball** (top 7 → a Pokémon), **Pokégear 3.0** (top 7 → a Supporter). Remaining 3 need MORE: Electric Generator + Hydreigon attach the found Energy (a from-the-top **attach** variant — the 2 attachEnergyFrom cards this also unblocks), Malamar peeks at the OPPONENT's deck top (a distinct info-only op). |
| ✅ **`moveEnergy`** (move an Energy between your Pokémon) | 5 | **DONE 2/5** (engine 0.17.0, the compound-park own→own op + the `anyEnergy` filter): **Energy Switch** (a Basic Energy, max 1), **Poppy** (up to 2 any Energy, max 2). Remaining 3 need MORE: Armarouge "Fire Off" (a {R} Energy benched→Active — fixed-endpoint + provided-type filter, an Ability), Mismagius "Magical Flick" (moves the OPPONENT's Energy on evolve — opponent-side + onEvolve trigger), Exp. Share (an on-KO Tool trigger). |
| ✅ **`conditionalPlay`** (a "you can use this only if <board condition>" gate) | 5 | **PRIMITIVE DONE, 1/5 cards** (engine 0.20.0 — the `BoardCondition` vocabulary + its two consumers: the `trainerPlayableIf` PLAY gate and the `conditionGate` branch op): **Fighting Au Lait** (more Prizes left → heal 60). The same vocabulary also lands **Falkner** (Stadium → draw 2 more) and, with `drawUntilHandSize`, **Grusha** — 2 cards from other rows. Remaining 4 each need a SECOND missing piece: **Letter of Encouragement** (a "were any of your Pokémon KO'd during your opponent's LAST turn" state fact — new per-seat history + flow wiring), **Dendra** (a choose-a-card-from-hand → BOTTOM park, mandatory-exactly-one, + `drawUntilHandSize`), **Luxray** (an in-hand Ability surface — abilities are in-play only today), **Lunatone** (Stadium-effect prevention). Next reader of the same vocabulary: **Defiance Band** (a conditional PASSIVE — the third consumer). |
| ✅ **`discardOpponentEnergy`** (discard an Energy from an opponent's Pokémon) | 4 | **DONE 3/4** (engine 0.21.0 — the `discardEnergy` op + the `specialEnergy` filter; ONE op whose `from` names both the eligible Pokémon and how many are hit, all three arms landing with a real card): **Crushing Hammer** (`opponentChosen`, behind a coin flip), **Giacomo** (`opponentEach` — one Special Energy off EVERY one of their Pokémon that has one), **Mawile** (`opponentActive`, an onPlayToBench trigger). Remaining 1: **Klawf ex**, which needs `onDamagedByAttack` (the row below), not more of this op. |
| ✅ **attack effect programs that can PARK** (a mid-attack `effect:choose`) | ~13 | **DONE — the mechanism (engine 0.22.0), plus 11 catalog rows of its first family.** A new `attackEpilogue` PendingStage carries the §8.1 KO sweep + the §5.3 turn end; `attack.ts` seeds it BEFORE the effect program runs and folds through `settleProgram`'s `resumeTail`, so a parked prompt and the ops behind it survive. Landed with it: `discardEnergy` gained a **`yourActive`** arm and a **`count: "all"`** rider, both DERIVED from the printed sentence (no registry rows) — "Discard an Energy from this Pokémon." covers **Houndoom ×2 (sv01-034, sv03-133), Charcadet, Staraptor, Paldean Tauros, Dedenne ex ×2, Bombirdier**; "Discard all Energy from this Pokémon." covers **Pawmot ×2, Raichu ×2**. STILL BLOCKED, needing more op vocabulary rather than more park: the NUMERIC counts (**Corviknight** "discard 2", **Koraidon** "discard 3", Arcanine ex/Sandaconda/Slither Wing — an exact-N park), the TYPED ones (**Kilowattrel** "a {L} Energy" — an energy-of-type filter, and "{L}" means *provides* {L}, so Special Energy counts), and the multi-sentence riders (**Eiscue ex**, **Weavile**). The opponent-side attack twins (**Pincurchin, Gumshoos**, and **Dedenne/Maschiff/Tympole** behind a flip) are now unblocked mechanically and need only their deriver sentences. |
| **`discardFromHandCost`** (pay "discard N cards from hand" to play) | 4 | Ultra Ball, Superior Energy Retrieval, Revavroom, Tinkaton |
| **`onDamagedByAttack`** (a trigger firing when damaged by an attack, even if KO'd) | 4 | Cacnea, Cacturne, Armarouge, Klawf ex |
| ✅ **`shuffleHandIntoDeck` (+ draw)** — the Iono/Judge hand-refresh family | 3 | **DONE — row CLOSED, +Judge +Iono** (the `handRefresh` op: engine 0.18.0 fully-automatic, reaches the OPPONENT): **Youngster** (draw 5), **Brassius** (draw hand+1), **Katy** (draw 8 + turn ends), **Judge** (both shuffle + draw 4), and **Iono** (engine 0.19.0 — the `toBottom` placement so the deck's ORDER survives, a `prizeCount` draw, and the `onlyIfAnyMoved` cross-seat draw gate). No Marnie exists in the sv01–03 catalog. The other bottom-of-deck cards need different ops: **Dendra** (a chosen card from hand → bottom + `drawUntilHandSize` + a can't-play gate), **Ortega** (reveal the opponent's hand + choose from it). |
| **`stadiumActivatedAbility`** (a "once during each player's turn" Stadium) | 3 | Artazon, Mesagoza, Town Store |
| **`damageAttacker`** (put counters on the attacking Pokémon) | 3 | Cacnea, Cacturne, Stunfisk |
| **`disableAbilities`** (a continuous Ability-lock aura) | 3 | Klefki, Spiritomb, Ting-Lu ex |
| ✅ `drawUntilHandSize` | 2 | **DONE 1/2** (engine 0.20.0 — draws to a floor, never TRIMS a bigger hand; no event at a count ≤ 0): **Grusha** (to 5, or to 7 with no Energy on your board — the `conditionGate` `otherwise` arm). **Dendra** still needs the choose-from-hand → bottom-of-deck park. |
| ✅ `endTurn` (a play that ends your turn) | 2 | **DONE**: Koraidon ex (the `AbilityProgram.endsTurn` fold, engine 0.14.0) + Katy (the same fold on the Trainer path via `trainerEndsTurn`, engine 0.18.0). |
| `conditionalDamageBonus` (Tool: +N under a condition) | 2 | Choice Belt, Defiance Band |
| `statusImmunity` / `preventDamageFromType` / `coinFlipDamagePrevention` / `drawUntil` / `canEvolveEarly` | 2 each | Dachsbun, Bellibolt, Jumpluff/Skiploom, Togekiss, Scatterbug/Spewpa |

**Long tail (~70 single-card ops)** — e.g. `bounceToHand` (Penny), `moveDamageCounters`
(Slowbro), `healBothPlayers` (Picnic Basket), `noRetreatCostAura` (Clefable ex),
`removeWeakness` (Florges), `retaliationDamage` (Rocky Helmet), `preventDamageFromExV`
(Mimikyu), the Iono/Judge prize-count draws, per-card search filters
(`searchFilter:{itemCard,toolCard,evolutionPokemon,…}`), and several bespoke
passives/triggers. Full list in the fan-out result. Many collapse into a few
parameterized ops (an `attachEnergyFrom` with source/filter params; a
`conditionalGate` family; extra `CardFilter` kinds), so the real op count to build
is well under 70.

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
   vocabulary: **Defiance Band** (a conditional PASSIVE — the third consumer) and
   **Dendra** (a choose-from-hand → bottom-of-deck park).
7. ✅ **`discardOpponentEnergy`** — **DONE 3/4** (engine 0.21.0, the `discardEnergy`
   op + the `specialEnergy` filter: Crushing Hammer, Giacomo, Mawile). Building it
   surfaced the next big structural unlock, now its own row above: **attack effect
   programs cannot PARK**, which alone blocks ~13 more cards in the SAME family
   (every "Discard an Energy from this Pokémon" attack, plus the opponent-side
   attack twins of Crushing Hammer). Klawf ex, the 4th card on this row, needs
   `onDamagedByAttack` instead.
8. ✅ **attack effect programs that can PARK** — **DONE** (engine 0.22.0, the
   `attackEpilogue` stage + `discardEnergy`'s `yourActive` / `count:"all"` arms:
   11 catalog rows, all DERIVED from the printed sentence, no registry rows). The
   structural half is what matters — every future attack effect may now hold a
   decision. The remaining self-discard prints need op vocabulary, not park work:
   an **exact-N** discard (Corviknight 2, Koraidon 3) and an **energy-of-type**
   filter (Kilowattrel's "a {L} Energy", where {L} means *provides* {L}).
9. **Next candidates:** the opponent-side attack twins now unblocked
   (**Pincurchin, Gumshoos**, + **Dedenne/Maschiff/Tympole** behind a flip — one
   deriver sentence each on the EXISTING `opponentActive` arm), the from-the-top
   **attach** variant (Electric Generator / Hydreigon — also 2 attachEnergyFrom
   cards), or `discardFromHandCost`
   (Ultra Ball / Superior Energy Retrieval / Earthen Vessel, 4). NOTE that last one
   shares the printed wording "You can use this card only if…" but is NOT a
   `BoardCondition` — it is a COST with a card CHOICE, so it has to park, which is a
   different shape entirely. A related deferral: **Miriam**'s "if you shuffled any
   cards in this way, draw 3" is `onlyIfAnyMoved`'s idea BETWEEN ops and across a
   park — it needs an op-result threaded through the interpreter's continuation,
   not a flag.
Each is a normal engine slice (new op + interpreter case + registry rows +
tests + review), and each turns dozens of "needs-op" rows into a few data rows.
