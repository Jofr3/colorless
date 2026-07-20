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
| **`moveEnergy`** (move an Energy between your Pokémon) | 5 | Energy Switch, Exp. Share, Poppy, Armarouge, Mismagius |
| **`conditionalPlay`** (a "you can use this only if <board condition>" gate) | 5 | Fighting Au Lait, Letter of Encouragement, Dendra, Lunatone, Luxray |
| **`discardOpponentEnergy`** (discard an Energy from an opponent's Pokémon) | 4 | Crushing Hammer, Giacomo, Klawf ex, Mawile |
| **`discardFromHandCost`** (pay "discard N cards from hand" to play) | 4 | Ultra Ball, Superior Energy Retrieval, Revavroom, Tinkaton |
| **`onDamagedByAttack`** (a trigger firing when damaged by an attack, even if KO'd) | 4 | Cacnea, Cacturne, Armarouge, Klawf ex |
| **`shuffleHandIntoDeck` (+ draw)** — the Iono/Judge/Marnie hand-refresh family | 3 | Brassius, Katy, Youngster |
| **`stadiumActivatedAbility`** (a "once during each player's turn" Stadium) | 3 | Artazon, Mesagoza, Town Store |
| **`damageAttacker`** (put counters on the attacking Pokémon) | 3 | Cacnea, Cacturne, Stunfisk |
| **`disableAbilities`** (a continuous Ability-lock aura) | 3 | Klefki, Spiritomb, Ting-Lu ex |
| `drawUntilHandSize` | 2 | Dendra, Grusha |
| `endTurn` (a play that ends your turn) | 2 | Katy, Koraidon ex |
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
   Electric Generator / Hydreigon (also 2 of the remaining attachEnergyFrom
   cards). Next: **`moveEnergy`** — common Items/Abilities.
4. **`conditionalPlay` / `conditionalGate`** as a family — unblocks a cluster of
   Supporters and Abilities at once.
5. The **hand-refresh Supporter family** (`shuffleHandIntoDeck` + draw variants:
   Iono, Judge, Marnie-likes) — high play rate, one op + a couple of draw shapes.
Each is a normal engine slice (new op + interpreter case + registry rows +
tests + review), and each turns dozens of "needs-op" rows into a few data rows.
