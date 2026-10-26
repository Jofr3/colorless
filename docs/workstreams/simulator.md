# Workstream: Simulator Engine (Phase 3)

Goal: replicate a real game of the Pokémon TCG well enough to play — first
approximately, then more accurately each pass. Reused by online matches (P4).

**Depends on:** P2 (real, usable decks) and `reference/ptcg-rules.md`.

## Approach
1. **Rules first.** `reference/ptcg-rules.md` (researched by a sub-agent) is the
   spec: setup, turn structure, zones, status conditions, KO/prizes, win
   conditions, first-turn restrictions, weakness/resistance math.
2. **Deterministic core.** A pure, seedable state machine:
   `GameState → Action → GameState` (+ emitted events for the UI/log). No
   randomness except a **seeded RNG** (shuffle, coin flips) so games are
   replayable and testable.
3. **Composable, data-driven card effects.** Most cards are minor variations on a
   few archetypes, so effects are authored as **data** — parameterized primitive
   ops over shared templates, not one function per card — and every op emits a
   semantic **event** the UI animates. Full design in the next section.
4. **State shape** builds on the existing playmat types
   (`src/features/playmat/types.ts`: BoardState, PlayerBoard, CardModel, zones)
   and the canonical `Card` (D5).

## Card-effect system — composable & data-driven

Most cards are minor variations on a **small set of effect archetypes**, so the
engine models effects as **composable primitives authored as data**, not a
bespoke function per card. Four layers:

1. **Primitive ops (`EffectOp`)** — the engine's instruction set: `Damage`,
   `ModifyDamage`, `PlaceDamageCounters`, `Heal`, `HealStatus`, `ApplyStatus`,
   `DrawCards`, `SearchDeck`, `Shuffle`, `AttachEnergy`, `DiscardEnergy`,
   `MoveCard`, `Switch`, `CoinFlip`, `ForEach`, `Conditional`, … Each op is a
   pure `(GameState, Ctx) → GameState` **and emits a semantic event** (below).
2. **Selectors & filters** — declarative targets (`self`, `opponentActive`,
   `yourBench`, `allYourPokemonMatching(filter)`, `playerChooses(filter)`) and
   card predicates (category / type / stage / isBasic / nameTag / energyCount…).
   Parameters, not code.
3. **Card effects as programs** — an attack is
   `{ cost, baseDamage, ops: EffectOp[] }`; an ability is
   `{ trigger, timing, oncePerTurn?, ops }`; a trainer / special energy is
   `{ provides?, ops }`. The whole effect is a small **data tree**.
4. **Archetype templates** — named builders for the common shapes, so a new card
   in a known family is one line of params:
   - `ballSearch({ cost, filter, dest })` → Nest / Great / Ultra / Quick / Level Ball
   - `handRefresh({ mode })` → Iono / Judge / Marnie / N
   - `gust()` → Boss's Orders-likes · `coinFlipDamage({ base, perHeads, flips })`
   - `energyAccelFromDiscard({ filter, target })`, …

### Grounded in real tcgdex data (fetched live)

| Card | tcgdex `effect` | Op program |
|---|---|---|
| Nest Ball | "Search your deck for a Basic Pokémon, put it on your Bench, shuffle." | `SearchDeck(filter=BasicPokémon, dest=Bench)` → `Shuffle` — the shared **ball** archetype |
| Gardevoir ex · *Psychic Embrace* | "…attach a Basic {P} Energy from discard to 1 of your {P} Pokémon… put 2 damage counters on it…" | ability: `AttachEnergy(from=Discard, filter=BasicP, target=chooseYourP)` → `PlaceDamageCounters(sameTarget, 2)`, guarded `notIfWouldKO` |
| Pikachu ex · *Thunderbolt* | "Discard all Energy from this Pokémon." | attack `baseDamage:150` → `DiscardEnergy(self, all)` |
| Iono's Voltorb · *Voltaic Chain* | damage `"20+"`: "+20 for each {L} Energy on all your Iono's Pokémon." | attack `baseDamage:20` → `ModifyDamage(+20 × count(energy=L, on=allYour(nameTag="Iono's")))` |
| Jet Energy | "provides {C}… when attached to a Benched Pokémon, switch it to Active." | special energy `provides:[C]`, onAttach: `Switch(attached → Active)` |

Notes:
- The **`damage` field encodes an op**: numeric = `baseDamage`; the `+` / `×` /
  `?` markers (`"20+"`) mean the attack also carries a `ModifyDamage` or
  `CoinFlip` op.
- The raw `effect` / `ability.effect` text is stored at ingest and is the
  **source a human or an LLM reads to author the op program** — tcgdex does not
  provide the program itself. (Ingest must persist `abilities` text too — add an
  `abilities_json` column to the `cards` table in `backend-data.md`.)

### Coverage strategy
Op programs are keyed by card id. A **structured fallback** derives what's purely
mechanical from the data alone (cost, base damage, weakness / resistance,
retreat, plain energy provision), so an un-authored card stays **playable** with
its text-effect flagged "not simulated" rather than guessed. Authoring programs
across the pool is a natural **Workflow** fan-out (batch by set; an LLM drafts
the op program from the effect text, each verified against
`reference/ptcg-rules.md`).

### Events → animation (built in, not bolted on)
The reducer returns `(GameState, GameEvent[])`. Every primitive emits
**semantic, serializable events** — `DAMAGE`, `ENERGY_ATTACHED`, `CARDS_DRAWN`,
`SEARCH`, `COIN_FLIP`, `SWITCH`, `STATUS_APPLIED`, `DAMAGE_COUNTERS_PLACED`,
`KNOCKOUT`, `PRIZE_TAKEN`, … The engine stays pure and knows nothing about
rendering.

- **Web:** an `animation[eventType]` registry maps each event to a playmat
  animation (the existing Pixi / GSAP layer). Adding or changing an animation is
  a registry entry — **no engine change**.
- **Online (P4):** the DO broadcasts the same event stream (hidden-info-filtered
  per player); clients animate identically. Local and online share one pipeline.

This is why the composable model pays off twice: it makes **authoring** cards
cheap (params over templates) and makes **animation** a pure consumer of the
event stream.

---

## Testing
- Unit tests per rule (KO → take prize, weakness ×2, status timing, deck-out
  loss…) and **scripted end-to-end games** with a fixed seed.
- The action/event log doubles as test fixtures and as the online wire format.

## Milestones
1. ✅ **Core state machine** — setup, turn phases, draw, energy attach, retreat,
   pass. Built + reviewed 2026-07-14 (commit `d34146c`); as-built notes below.
2. ✅ **Attacks** — costs, damage, weakness/resistance, KO + prize-taking, win
   check. Built + xhigh-reviewed + fixed 2026-07-16; as-built notes below. The
   **engine → playmat projection** (D17, `src/features/game/projection.ts`)
   landed alongside it. **Wire-up done 2026-07-17:** the projection drives a
   playable local hot-seat game at `/play` ("Wire-up as built" below).
3. ✅ **Status conditions + Pokémon Checkup** — built + reviewed (8 finders /
   7 verifiers, 10 reported findings all fixed) 2026-07-17; as-built notes
   below. Includes the first sliver of the effect system: the **text-derived
   status deriver** (D20).
4. 🚧 **Evolution + Trainers + Abilities + persistent zones + KO generalized
   off the Active done** (2026-07-17/18; as-built below). The effect-op
   interpreter/registry drives real Item/Supporter Trainers and activated +
   passive Abilities; slice 3 added the shared **Stadium** zone + Pokémon
   **Tool** attachment with a **continuous-modifier pipeline** (continuous.ts);
   slice 4 generalized the Knock Out off the Active — **bench spread/snipe
   damage** and a **mid-turn KO that resumes the actor's turn** (closing the
   evolve-below-HP gap); slice 5 added **Special Energy** — provision as data
   (multi-unit + wildcard), a wildcard-aware cost matcher, and on-attach effects
   (Jet Energy's switch); slice 6 added **triggered Abilities** (§9) at three
   scan points (on-play-to-Bench, on-evolve, between-turns/Checkup) — board
   triggers park on effect:choose, a between-turns counter KOs through the
   Checkup sweep; slice 7 added **Rare Candy** (§7.1) — the Basic→Stage 2
   evolve-skip Item, a dedicated action reusing the extracted `placeEvolution`
   (so it inherits carry-over, the on-evolve trigger and the mid-turn KO), with
   the Basic→Stage 2 link resolved by bridging through the Stage 1 name in the
   pool; slice 8 added the **mid-turn-damage snipe** (§9) — a `damageChosen` op
   that puts counters on chosen opponent Benched Pokémon (a multi-Pokémon prompt)
   and KOs mid-turn through a unified `settleProgram` KO sweep, plus the engine's
   first ability activation cost (Meowscarada's {G}-discard); slice 9 **CLOSED
   M4** with **on-KO triggered Abilities** (§8.1) — a "when Knocked Out" Ability
   fires mid-KO-sweep during the opponent's turn: a coin-flip prize guard
   (Glimmora) resolved inline in the sweep, and a parking on-KO program run as a
   `koTrigger` stage that folds through `settleProgram` with `resumeTail` (park
   for a decision, then resume draining the KO's prize/promotion tail).
5. 🚧 **Coverage-expansion pass(es) across the SV-era pool** — pass #1 done
   (2026-07-19): a classify→verify Workflow fan-out over the 140 un-authored
   sv01–03 Trainers/Energy/Abilities found only **5 expressible with the current
   ops** (landed) and **113 needing new ops** — coverage is op-bound, so the
   ranked **new-op backlog** (`docs/reference/coverage-backlog.md`) is the roadmap
   for the next slices (`attachEnergyFrom` unlocks 11, `discardPileRetrieval` 6,
   `lookAtTopN`/`moveEnergy`/`conditionalPlay` 5 each, …). First backlog op built:
   **`attachEnergyFrom`** (2026-07-19) — the single-attach core (Quaquaval,
   Baxcalibur; engine 0.12.0), the **targetType/bonusCounters/notIfKO riders**
   authoring **Gardevoir ex** (engine 0.13.0), and **multi-attach (= N ops) +
   `basicOnly` + the `endsTurn` fold** authoring **Koraidon ex "Dino Cry"** (engine
   0.14.0). 4 of its 11 cards done; the other 7 need a deck-search source /
   `lookAtTopN` / self-KO / onEvolve / …. Then **`discardPileRetrieval`** (2026-07-20,
   engine 0.15.0 — the searchDeck mirror: Energy Retrieval / Pal Pad / Super Rod,
   3 of 6) and **`lookAtTopN`** (2026-07-20, engine 0.16.0 — the deck-top twin:
   Great Ball / Pokégear 3.0, 2 of 5; the from-the-top **attach** variant still
   layers on for Electric Generator / Hydreigon).
6. Harden for authoritative server use (P4): validation, hidden info, server-owned
   RNG seed.

---
