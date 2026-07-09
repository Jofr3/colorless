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
1. Core state machine: setup, turn phases, draw, energy attach, retreat, pass.
2. Attacks: costs, damage, weakness/resistance, KO + prize-taking, win check.
3. Status conditions + Pokémon Checkup between turns.
4. Evolution, Abilities, and the trainer/energy effect registry (staples first).
5. Coverage-expansion pass(es) across the SV-era pool; track % simulated.
6. Harden for authoritative server use (P4): validation, hidden info, server-owned
   RNG seed.

## Notes for effect authoring at scale
Authoring handlers for many cards is a natural **Workflow** fan-out (one agent per
set/card batch, each verified against the rules doc). Ask the user before
launching one.
