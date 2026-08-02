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

## M1 as built (`packages/engine`, 2026-07-14)

**Shape.** `createGame({seed, decks, cardPool})` → `{ok, state, events}`;
`applyAction(state, action)` → `{ok:true, state, events} | {ok:false, error}`.
Pure, JSON-safe `GameState` (mulberry32 `rngState` lives *in* it), no classes,
no wall clock. Illegal actions never throw and never mutate — the P4
authoritative server rests on that. Modules: `rng · types · events · actions ·
cards · setup · turn · index` (+ `testFixtures`). 60 tests.

**Locked design (D14).** Seats `p1|p2` are labels, not turn order (the coin
winner *chooses* via an action; `firstPlayer` records it). Every physical card
gets a uid (`"p1#0"`); zones hold uids; `cardIdByUid` + `cardPool` resolve them.
Choices are actions; anything with no choice (mulligan redraws, prize setting,
the turn-start draw) auto-resolves inside the reducer. `Phase` is the
discriminant every action validates against.

**Wire-safety rule (learned the hard way).** TypeScript types are *not* input
validation: P4 decodes actions from a client, so anything the engine reads off
an action must be checked at runtime. The review found three live bugs of
exactly this shape — a string `"1"` bench index passed `bench[index]` (string
key!) but failed `i === index`, destroying the energy card; retreat's
`slice(index + 1)` string-concatenated to `slice("11")` and deleted benched
Pokémon; and an unvalidated `first` seat crashed several actions later inside
`startTurn`. **Every new M2+ action must runtime-check its indices, seats and
counts** (`isBenchIndex`, the `isSeat` guard in `applyAction`).

**Event contract.** Events are values handed to consumers (animator, P4
broadcast, persisted log): payload arrays are always **copies**, never the
state's own arrays or the caller's action arrays. Every state change emits an
event — including a phase advance with no other effect (`COMPENSATION_DECIDED`
fires even when the player declines, or an event-only client hangs on the
prompt).

### Known gaps / traps for M2+
- **The turn tail is fused.** `endTurn` does TURN_ENDED → `runCheckup` (an M3
  no-op stub) → `startTurn(other)` in one reduction, and `runCheckup` is
  `GameState → GameState` so it **cannot pause**. M2's KO resolution needs to
  stop mid-sequence for decisions (which prize, which Pokémon to promote), and
  M2's attack ends the turn through the same tail. Expect to restructure this
  into a resumable/staged transition rather than fill in the stub.
- **Per-turn allowances live on the `turn:action` phase object** ("replacing the
  phase IS the reset"). Any mid-turn *interrupt* phase (targeting, prize pick,
  search) destroys them. When M2 adds interrupts, lift the allowances to a
  per-turn struct on `GameState` — where the supporter/stadium flags and the
  per-Pokémon once-per-turn ability flags (§15.J) belong anyway.
- **`gameOver.winner` is `Seat`** — §14 wants a `TIE`/`SUDDEN_DEATH` outcome
  surfaced, not silently picked. Widen when M2 lands simultaneous KOs. Nothing
  consumes the union yet, so it is still free to change.
- **Retreat's energy-discard is hand-rolled.** M2's KO (whole stack + energy +
  tools → discard) and the `DiscardEnergy` effect op need the same move — lift a
  shared "attached cards → discard" primitive rather than a third copy.
- **`retreatCostOf` maps `null` → 0 (free retreat).** In the real catalog `null`
  is a *data gap*, not a printed 0 (ingest writes null when tcgdex omits it), so
  a bad row silently becomes a free-retreat Pokémon. Fix belongs at ingest.
- **`drawToHand` short-draws silently** when the deck is shallower than `count`.
  M1's callers are safe (compensation is clamped so a player can never draw below
  their 6 prizes), but M2 draw effects (Professor's Research…) must not assume.
- **`resolveMulligans` has no iteration cap** — a legal 1-Basic deck loops until
  it draws the Basic (expected ~9 rounds, exponential tail). Accepted: capping it
  has no legal resolution.
- **No `SETUP_REVEALED` payload, and no stadium / Lost Zone zones yet.** The
  first matters for P4's hidden-info filter (the face-down placements are exactly
  what gets redacted, and the reveal must say what became public); the second
  lands with M4's trainers.
- **No engine → playmat projection exists.** `GameState` (uids + pool
  indirection) is deliberately not the playmat's `BoardState` (`CardModel[]`).
  The web app cannot render a game until that adapter is written — it is the
  natural next slice alongside M2.
- **`isBasicPokemon` now exists twice** in the repo: the engine's (over the
  canonical `Card.stage`) and the builder's (over `BuilderCard.subtype`, a
  relabelled view). They read different vocabularies of the same data and can
  drift. Lift one predicate into `@luminous/schema` when convenient.

## M2 as built (2026-07-16) — attacks, KO/prizes, win check + the projection

**Shape (D16).** The fused turn tail is gone: `GameState.pending` is a
`PendingStage[]` queue drained by `advance()` in the new `flow.ts`. Decision
stages **park** (phase becomes `ko:takePrizes`/`ko:promote`, prompt event
fires) or **auto-resolve** when forced; `attack` seeds its KO stages ahead of
the shared `turnTail(seat)` triple; `resolvePrizesAndResume`/
`resolvePromotionAndResume` own the resolve → pop → **win-check** → resume
sequence for BOTH the action handlers and advance's auto-resolves (the §14
check runs in exactly one place). Per-turn allowances live on
`GameState.allowances` (M4's supporter/stadium flags go there). `gameOver`
carries `GameOutcome` (win/tie). New actions `attack`/`takePrizes`/`promote`;
new events ATTACK_DECLARED, ATTACK_EFFECT_SKIPPED (the "not simulated" flag),
DAMAGE_DEALT (with `DamageModifier` breakdown), KNOCKED_OUT, PRIZES_OWED/
PRIZES_TAKEN, PROMOTION_REQUIRED/POKEMON_PROMOTED. The **projection** (D17)
maps `GameState` → playmat `BoardState` per viewer: `activePlayer` (turn
owner) vs `waitingOn` (who must act) are separate fields — during
`ko:promote` they differ, and a HUD gating on turn ownership alone soft-locks.

**M1 traps closed by M2:** the fused tail (staged queue), phase-object
allowances (lifted to state), `gameOver.winner` (widened to `GameOutcome`),
the hand-rolled retreat discard (shared `discardFromStack`, which returns the
moved uids in **pile order** — events must report that order, it's the §2
contract KNOCKED_OUT/RETREATED both follow now).

**The xhigh review paid again** (10 finder angles + 9 verifiers + sweep; 15
findings, all confirmed ones fixed in-session). The headline classes:
- **Never-throw violations in M1 code the M1 review missed:** `attachEnergy`
  read `action.target.spot` unguarded (a `null` target THREW out of
  `applyAction` — probe-proven) and retreat's `discardEnergy` lacked
  `Array.isArray` (`{length:1}` passed the length check then `new Set` threw).
  Both now runtime-checked (`BAD_TARGET`; the takePrizes-style array guard).
  Lesson repeated: **every object an action carries needs a shape check, not
  just its leaves.**
- **Name/format parsing vs real catalog data:** `energyProvidesOf` misparsed
  the catalog's own "Basic Darkness/Metal Energy" prints (sv06.5-098/099) to
  Colorless — typed attacks permanently unpayable on legal boards; and the
  schema-documented additive weakness `"+20"` was silently applied as ×2
  (dp5-4 fixture proves it). Fixes: optional "Basic " prefix + the canonical
  `BASIC_ENERGY_TYPES` now lives in **`@luminous/schema`** (builder derives
  its palette from it; Fairy added, Dragon correctly provides nothing), and
  weakness/resistance parse to `DamageModifier` (×N/+N/−N).
- **Data gaps must not guess:** `hp ≤ 0` now reads as the null data gap (a
  literal 0 was instant-KOing undamaged Pokémon on 0-damage attacks).

### Known gaps / traps for M3+
- ~~**`runCheckup` is still a stub.**~~ **Closed by M3** (2026-07-17): the
  shared `knockOut` + `isLethallyDamaged` + `activeTop` now live in
  flow.ts/cards.ts and both attack exits + the checkup use them. ~~Still
  Active-only — M4 bench damage must generalize `knockOut`'s target.~~
  **Generalized in M4 slice 4** (2026-07-18): `knockOut` KOs any in-play
  Pokémon by uid and the shared `collectKnockOuts` sweep serves attack /
  checkup / mid-turn alike.
- **`prizeValueOf` returns 1 for everything** — the canonical `Card` has no
  ex/rule-box field because ingest deliberately drops tcgdex's `suffix`
  (wrongly lumped with dp-era extras in `apps/api/src/db/catalog.ts`). The
  multi-prize flow (validation, count clamp, taking N) is already built and
  tested; persisting the suffix at ingest is the single point of change.
- **Energy provision is still name-derived** (special energies conservatively
  provide 1 Colorless). Real fix at ingest: provision as data on the Card.
  Same for weakness/resistance value normalization (`DamageModifier` could be
  computed at ingest) — engine parsing is documented debt.
- **phase ↔ `pending[0]` dual encoding kept** (the parked phase mirrors the
  queue head). Handlers cross-check and reject `PHASE_DESYNC` on mismatch;
  unreachable via the public API today. M3 may collapse to a single encoding
  (park by popping the stage into the phase) if it adds interrupt writers.
- **Sudden death is surfaced, not played out** — simultaneous §14 wins return
  `GameOutcome tie`; an actual sudden-death sub-game is future work.
- **Projection deferrals:** opponent-hand backs use positional ids
  (`opponent-hand-N`) that re-key when the hand shrinks — correct redaction,
  wrong animation identity for opponent plays; fixing needs stable **opaque**
  aliases designed together with P4's server-side filter. `image: null`
  projects `imageUrl: undefined` → the playmat's grey placeholder; nothing
  maps backs/undefined to a card-back texture yet (belongs to the wire-up
  slice). Status conditions + lower stack cards have no CardModel slot.
- ~~The playmat still renders `mockPlaymat.ts`~~ — **closed by the /play
  wire-up (2026-07-17, below).** (Historical note: D17/progress once cited a
  "consumption sketch in the projection module" — no such code block ever
  existed; the consumption guidance is the projection's inline comments.)

## Wire-up as built (2026-07-17) — the playable local game page

**Shape.** `/play` (`src/features/game/GamePage.tsx`) is a hot-seat local
match: pregame (demo decks + saved decks when signed in) → `createGame` →
`LocalMatch` renders **`PlaymatView`** (the presentational shell extracted
from `Playmat.tsx`; the mock at `/simulator` — retitled "Sandbox" — is now a
thin wrapper driver) purely from `projectGameState`. `useLocalGame` owns
`GameState` via a pure reducer over `applyAction` (ok → replace state, append
log via `logFromEvents`, clear `lastError`; err → nonce'd `lastError`); the
hot-seat **viewer follows `waitingOn`** (device flip; `waitingSeatOf` ≡
`phaseViewOf(state, seat).waitingSeat ?? seat` — ONE source, D17). Drags
translate via `moveToAction` (gesture-class routing; the ENGINE is the
authority) and drop affordances obey a **driver-supplied
`PlacementPredicate`** (D19) built by `gamePlacementPredicate` in lockstep
with the translator (property-tested: every afforded drop translates to a
real action). `GameHud` is ONE exhaustive phase switch (coin toss, mulligan
draw, placement, turn panel w/ engine-helper payability, prize/promote
dialogs, game-over overlay), everything gated on `waitingOn === "you"`.
`cardPool` (`src/features/game/cardPool.ts`) builds the engine pool via
`GET /cards/:id` fan-out (D18 — CardBrief deliberately lacks combat blobs);
module-level promise cache, 404s = stable `missing`. Demo decks: 60-card
sv01+sve-era Fire vs Water lists, ids verified live. The **projection now
redacts the opponent's in-play Pokémon during `setup:*`** (positional
`-hidden` ids, no `pokemon` rows — the same filter P4's server applies;
reveal re-keys, same trade as hand backs).

**Browser-verified e2e** (recipe + agent-browser traps in
`.claude/skills/verify/SKILL.md`): full game — setup drags, hot-seat flips
with setup redaction, energy attach, payability gating, weakness ×2 math,
KO → prize dialog → forced auto-promote, win-by-no-Pokémon overlay; damage
chips confirmed painting above the Pixi canvas (stacking-context walk).

**The React lesson of the session:** two fragment siblings shared
`key={seatKey}` in GameHud — on key change React's `mapRemainingChildren`
dedupes by key, the shadowed old fiber is NEVER deleted, and it stays
mounted-but-orphaned: stale content, **live buttons dispatching real
actions**, zero console errors. Keys among siblings must be unique across
the WHOLE fragment child list, not per slot; the phase-switch composition now
makes the collision structurally impossible. Regression-pinned in
`LocalMatch.dom.test.tsx`.

### /play follow-ups (from the 8-finder/6-verifier review — all verified)
- **P4 blocker (do with P4, not before):** the HUD reads raw `GameState`
  (allowances, `phase.owed`, energy uids — verbatim copies of
  `attack.ts`/`turn.ts` internals for payability/retreat). Online clients
  can never receive GameState; the fix is engine-exported preview predicates
  or a projection "available actions" surface. Acknowledged in-code.
- **Piles are a second render path:** discard-top is a DOM `<img>`; deck-empty
  hides the Pixi back by dropping its anchor. Cards **teleport** to discard
  (KO/retreat/M4 trainers) — needs pile zones in the animation layer's model.
- ~~`CardModel` carries no battle state~~ — **closed by M3** (D21): the
  projection attaches `battle {damage, hp, conditions}`; the side-table and
  its 5-hop prop chain are deleted.
- Perf (minor, verified): `viewLogEntries` re-maps the whole log per action
  (O(n²)); overlay banner/pill timers re-render the board subtree (Pixi sync
  is skipped via board identity — cost is reconciliation + payability
  recompute); per-slot deck→pool fetch pipelining.
- Pregame could reuse `useDeckLibrary` (hand-rolled listDecks effect swallows
  failures silently; judgment call — the hook also fetches /folders).
- Hidden-back re-key on reveal (opponent hand AND setup redaction) pops
  instead of animating — needs the stable-opaque-alias design with P4's
  server filter (pre-existing deferral, now with two call sites).

## M3 as built (2026-07-17) — special conditions, checkup, text-derived effects

**Shape.** The M1-reserved `SpecialConditions` slot (`rotation` ∈
none/asleep/paralyzed/confused, `poisonDamage` counter amount with 0 = not
poisoned, `burned`) is now live on the Active only. The checkup runs entirely
inside `advance`'s `checkup` stage (which now carries the ended `seat`) — **no
new Phase members**: §13 order poison → burn(20 + cure flip) → asleep(wake
flip) → paralysis(ended seat only), each step [endedSeat, other], all flips
threading `rngState`, KOs resolved AFTER the whole batch via the shared
**`knockOut(state, koedSeat, prizeSeat, events)`** (lifted from attack.ts;
prize goes to the KO'd side's opponent) parking on the same ko:* interrupts as
attack KOs — prize stages grouped before promote stages. Double-KO
simultaneous wins resolve by **speculatively applying both KOs + owed prizes
and asking `evaluateWin`** (§14 stays single-sourced) → tie. Gates:
`isImmobilized` (engine-exported; asleep/paralyzed) blocks attack + retreat
(`STATUS_PREVENTS_ATTACK`/`_RETREAT`); Confused attacks flip
(CONFUSION_CHECK; tails → ATTACK_FAILED + 30 self-counters + possible
self-KO prized to the defender + turn ends) through the same shared
`finishAttack` epilogue as the normal exit. Retreat/benching cures (emits
STATUS_CLEARED reason "benched"); a rotation status REPLACES the previous one
with no clear event. Effects: **D20's `deriveAttackEffect`** (5 anchored
sentence patterns → `EffectStep[]`: applyStatus/heal/coinFlipGate) executes
after damage, before the KO check; underivable text keeps ATTACK_EFFECT_SKIPPED
(whose `effect` is null when the text DID derive and only a damage marker was
skipped — the log keys on that). New events: STATUS_APPLIED, STATUS_CLEARED,
COUNTERS_PLACED (poison/burn/confusion), CHECKUP_COIN_FLIP, CONFUSION_CHECK,
ATTACK_FAILED, HEALED, ATTACK_EFFECT_COIN_FLIP. Engine exports added:
`isImmobilized`, `DEFAULT_POISON_DAMAGE`, `StatusName`, `EffectStep`,
`deriveAttackEffect`; internal helpers `isLethallyDamaged` (owns the
hp-null-is-a-data-gap rule) and `activeTop` (the 8×-repeated active/uid/card
preamble).

**Surface (D21).** `CardModel.battle {damage, hp, conditions}` attached by the
projection; SLP/PAR/CNF/BRN/PSN chips (opposite corner from the damage chip;
PSN shows the amount when raised above `DEFAULT_POISON_DAMAGE`); HUD disables
attack+retreat via the engine's `isImmobilized` with a reason line, confusion
gets a note; log rows for all 8 events (shared `STATUS_LABELS`, UI-side);
checkup events ride INSIDE the attack/endTurn action's batch (TURN_ENDED →
ticks/flips → TURN_STARTED in one list — animations must key off post-batch
state, a recovery row can precede the same uid's KNOCKED_OUT). Projection
reports `activeSeat: null` during **between-turns** ko parks (discriminator:
the pending queue has drained the endTurn/checkup tail to bare startTurn);
GamePage's `?? waitingOn` fallback highlights the prize picker. Demo decks:
Numel sv03-031 ×3 (Fire, defender Burn), Luvdisc sv02-047 ×3 (Water, defender
Asleep); Slowpoke's Rest now actually simulates (self-Asleep + heal 30).

### Known gaps / traps for M4+
- **Paralysis has no applied-turn stamp**, so the blanket ended-seat clear is
  wrong for SELF-paralysis at your own turn's end (official wording: cleared
  only if "Paralyzed since the beginning of your last turn"). The deriver
  refuses self-`Paralyzed` (→ skip flag) to keep the wrong case unreachable;
  §12/§13.4 in the rules doc now carry the real conditional. M4 effects that
  self-paralyze need the stamp first.
- **The `EffectStep` interpreter is attack-private by design** (runs after
  damage, targets hardcoded to the two Actives). M4's registry goes ABOVE it
  (`programFor(cardId) ?? deriveAttackEffect(text)` at the one call site) and
  will need mid-effect decision parking, pre-damage `ModifyDamage`, and
  non-Active targets — expect to restructure the interpreter then, not
  extract it now (review adjudicated: premature today).
- **Classic prints are deliberately underivable** ("The Defending Pokémon is
  now …" — sv-era cards say "Your opponent's Active Pokémon"); they keep the
  loud skip flag. Adding the classic pattern is a one-line M4 candidate once
  someone checks the era's timing semantics match.
- ~~`knockOut`/checkup are **Active-only**; M4 bench damage (spread/snipes)
  must generalize the target and revisit the double-KO guard's two-KO framing.~~
  **Closed by M4 slice 4** (2026-07-18): `knockOut` takes a uid (Active or
  bench), the `collectKnockOuts` sweep scans full boards, and its §14 tie guard
  generalizes to "both seats lost a Pokémon" (the speculative-apply shape, as
  predicted).
- `BattleConditions` structurally restates `SpecialConditions` (playmat stays
  engine-free), pinned by a two-way assignability assert in `battleStateOf`.
  When M4 markers widen conditions, **lift the vocabulary to
  `@luminous/schema`** (the BASIC_ENERGY_TYPES precedent).
- Still open from M2: `prizeValueOf` = 1 (ingest suffix column), name-derived
  energy provision, phase↔`pending[0]` dual encoding (checkup added no
  parked-phase writers, so it stands unchanged), opponent-hand/setup reveal
  re-key (P4 opaque-alias design).

## M4 slice 1 as built (2026-07-17) — evolution

**Shape.** New `evolve` action (turn.ts, alongside playBasicToBench/retreat;
`EvolveAction {seat, uid, target: PokemonTarget}`). Places an Evolution card
from hand on the **stack top** of one of the actor's own in-play Pokémon
(Active or Bench). An Evolution card is `evolveFromOf(card) !== null`
(cards.ts — `card.category === "Pokemon" ? card.evolveFrom : null`; `stage`
is not consulted, `evolveFrom` is the ingested datum). Legality, in order:
turnGate → **first-turn ban** → hand/uid → NOT_AN_EVOLUTION → wire target →
resolve target → **EVOLVE_MISMATCH** (the evolution's `evolveFrom` must equal
the target top card's NAME, §10) → **EVOLVE_TOO_SOON**. Carry-over (§10):
damage, Energy, Tools STAY (they ride on the stack, untouched by the spread);
Special Conditions + markers are cleared; `turnPlayed` resets to `state.turn`.
Events: `POKEMON_EVOLVED {from, to, target}` + (iff the Active had conditions)
`STATUS_CLEARED reason:"evolved"` whose `uid` is the NEW top. No KO check —
evolving never KOs (HP only rises; §10 devolution, the one shrink, is
effect-only and out of scope). New error codes NOT_AN_EVOLUTION /
EVOLVE_MISMATCH / EVOLVE_TOO_SOON / FIRST_TURN_EVOLVE; new export
`evolveFromOf`; engineVersion 0.4.0.

**Timing is two checks, deliberately (§4/§10).** `turnPlayed >= state.turn`
covers "not the turn it came into play, nor twice in one turn" (a setup
Pokémon carries turnPlayed **0**, a benched/evolved one the turn it arrived).
That alone can't express "no evolve on your own FIRST turn" — a setup
Pokémon's 0 is < turn 1/2 — so a separate `state.turn === (seat ===
firstPlayer ? 1 : 2)` ban fires first (firstPlayer plays odd turns, so their
first turn is 1 and the other seat's is 2). This is the turn/firstPlayer check
`InPlayPokemon.turnPlayed`'s M1 comment always reserved.

**Surface (web).** No projection change — the projection already reads the
stack **top**, so an evolved Pokémon renders its new card with carried damage
(battle state) and cleared conditions automatically. Drag routing:
`moveToAction`/`gamePlacementPredicate` treat a Pokémon dropped ONTO an own
occupant as an evolve gesture — pokemon→Active and pokemon→**occupied** bench
index → `evolve`; pokemon→a **free** bench slot (the index-less frame
container) stays `playBasicToBench`. This is the SAME indexed-vs-container
disambiguation energy-attach uses (confirmed against the drop layer's
`parsePlacement`: occupied slots carry `data-card-index`, the bench frame
carries none). Fine legality stays the engine's → the error pill (D19,
lockstep property extended in placement.test.ts over a real turn-3 evolvable
board). `logFromEvents` rows for POKEMON_EVOLVED ("evolved X → Y") and the
"evolved" clear. Demo decks carry real lines
(Ember Fuecoco→Crocalor→Skeledirge, Tidal Buizel→Floatzel). Suite 892 → 914.

### Known gaps / traps for the rest of M4
- **Projection identity pops on evolve.** The CardModel id keys off the
  stack-top uid, so evolving swaps basic-uid → evolution-uid and the Pixi
  layer remounts (pop, not a morph) — same class as the hidden-back re-key.
  Animation-layer follow-up; damage/conditions are correct (battle state).
- **The interpreter/registry are still untouched** (evolution is a board
  action, no effect ops) — the D20 traps below stand for the next slices.
- **Rare Candy** (Basic → Stage 2 skip) is an Item, so it waits for the
  trainer registry; the `evolve` action only does adjacent-stage placement.
- `presentStatuses`/first-turn logic are evolve-local; if Abilities add their
  own "is it this seat's first turn" gate, lift a shared helper then.

## M4 slice 2 as built (2026-07-17) — Trainers + Abilities + the effect interpreter

**Shape (D23).** The M3 attack-private `runEffectSteps` is replaced by ONE
shared, resumable interpreter (`interpreter.ts`): `runProgram(state, ops, ctx,
events) → {kind:"done"|"parked"}`. `EffectStep` grew into `EffectOp` (effects.ts
— applyStatus/heal/coinFlipGate PLUS drawCards/discardHand/shuffleDeck/
searchDeck/switchActive/gust/healChosen); the deriver still emits the same ops.
The **id-keyed registry** (`registry.ts`, `programFor(cardId)`) sits above the
deriver at the one attack call site (`programFor(id)?.attack ?? derive(text)`)
and IS the only source for Trainer/Ability programs (no text deriver for those
— an unauthored card can't be played/used, loud not guessed).

**Mid-effect parking.** A decision op (search a deck, gust/switch/heal a chosen
Pokémon) PARKS: the interpreter returns `parked` with a prompt + a JSON
continuation (`{pendingOp, rest, ctx}`), and the new **`effect:choose` Phase**
stores it. `resolveEffect` validates the choice against the prompt (wire-safe —
every uid/ref checked), applies the awaited op, and resumes the rest.
Forced/empty decisions auto-resolve (searchDeck is "up to", so it parks whenever
≥1 candidate; a mandatory target auto-resolves at exactly one). NO effect in
scope KOs or ends the game, so the interpreter never touches the flow.ts tail —
a future damaging op wires its KO check through the shared `knockOut` there.

**New actions (cardplay.ts).** `playTrainer` (Item any number §7.1 / Supporter
one/turn §7.2 + the §4 first-turn Supporter ban; the card leaves hand →
discard up front, then the program runs — none references itself mid-effect;
`trainerPlayable` rejects gust/switch with no legal target BEFORE committing).
`useAbility` (activated only; §9 Active-only + the once-per-turn per-Pokémon
flag `${uid}:${ability}` in `TurnAllowances.abilitiesUsed`, reset each turn).
`resolveEffect` (the parked-decision resolver). New error codes
NOT_A_TRAINER / TRAINER_TYPE_UNSUPPORTED / TRAINER_NOT_SIMULATED /
SUPPORTER_ALREADY_PLAYED / FIRST_TURN_SUPPORTER / NO_LEGAL_TARGET /
NO_SUCH_ABILITY / ABILITY_ACTIVE_ONLY / ABILITY_ALREADY_USED /
BAD_EFFECT_CHOICE. New events TRAINER_PLAYED / ABILITY_USED / HAND_DISCARDED /
DECK_SEARCHED / POKEMON_SWITCHED / EFFECT_PENDING (+ DrawReason "effect",
DAMAGE_DEALT gained optional `reduction`).

**Passive abilities are a pipeline HOOK, not the interpreter.** Bouffalant
"Bouffer" (−20 damage AFTER Weakness/Resistance) is read in attack.ts's damage
step from `programFor(defenderCard.id)?.passive?.damageReductionAfterWR`, floored
at 0, surfaced as `DAMAGE_DEALT.reduction`. (Active-defender only for now —
bench damage generalizes with the KO-target work.)

**Surface (web).** Trainers/Abilities are HUD **buttons** in the TurnPanel
(GameHud) — NOT board drags (the drag layer's `moveToAction`/
`gamePlacementPredicate` already no-op on unknown phases, so `effect:choose`
affords nothing); button gating mirrors §4/§7.2/§9 but the ENGINE owns fine
legality (afford-then-reject pill for gust/switch preconditions, D19).
`effect:choose` renders a chooseCards (multi-select up to max, "Take none") or
choosePokemon dialog → `resolveEffect`. Projection maps the phase (activeSeat =
waitingSeat = controller; `pendingDecision.effectChoose` carries the prompt) and
its exhaustive switch caught the new phase at compile time. `logFromEvents` rows
for all six new events. `presentStatuses` lifted to types.ts (shared by
retreat/evolve/switch). Demo decks: both share the 6 Trainers, Tidal runs
Chien-Pao ex, Ember runs Bouffalant. Suite 914 → **948**.

**Representative set (real sv ids, verified live 2026-07-17):** Professor's
Research (sv01-189, draw 7), Nest Ball (sv01-181, search→bench), Boss's Orders
(sv02-172, gust), Switch (sv01-194), Potion (sv01-188, heal 30), Energy Search
(sv01-172, search→hand); Chien-Pao ex (sv02-061, *Shivery Chill* — search 2
Basic {W} Energy, activated once/turn Active-only), Bouffalant (sv03-174,
*Bouffer* — passive). Broad SV-pool coverage is a later Workflow fan-out that
just adds registry rows.

**Review (high effort, 8 angles) + fixes:** no correctness bugs shipped; two
findings fixed in-session — (a) `searchMove` removed all picked uids from the
deck but benched only `slice(0, room)` (guarded today by the prompt's max
clamp, but the removal/placement sets were computed independently — now
clamped to bench space BEFORE anything leaves the deck, the M1 card-safety
lesson), and (b) `presentStatuses` duplicated (turn.ts + interpreter.ts) →
lifted to types.ts. Deferred (noted): the `effect:choose` prompt carries the
search candidates (deck uids) unredacted in the projection — a P4-scoped
hidden-info gap, unobservable in hot-seat (the HUD gates on `acting`), same
class as the opponent-hand backs.

**Verification.** `bun run check` green (tsc + biome + **948 tests**), incl. 28
engine cardplay tests (every archetype + parking + forced auto-resolve +
wire-safety + purity) and 5 DOM integration tests driving the REAL GameHud →
engine → effect dialogs → resolveEffect. **Live browser (/play):** the game
boots clean with the new decks (full 60-card cardPool incl. all Trainers +
Chien-Pao + Bouffalant fetched from the live api, canvas renders, ZERO console
errors); setup drags work; the **TurnPanel renders the new Trainer buttons live
with correct §4/§7.2 gating** (Boss's Orders disabled on turn 1, enabled on p1's
turn 2; Switch enabled as an unbounded Item). All 8 new card ids resolve through
`GET /cards/:id` with the exact fields the engine reads. NOT driven to a fully
RESOLVED effect in-browser — the demo hands dealt lacked the preconditions
(opponent bench for gust, the right Item in hand) and the Pixi bench-drag
coordinate hit-test is the documented session-eater; the effect-resolution path
is exhaustively covered by the engine + DOM tests instead.

### Known gaps / traps for the rest of M4
- **Stadium + Tool** (persistent zones) are deferred: `playTrainer` rejects them
  (TRAINER_TYPE_UNSUPPORTED). Stadium needs a shared board zone + the continuous
  pipeline; Tool needs the attach + a continuous hook + KO-discard-with-tool
  (the `InPlayPokemon.tools` slot exists but nothing attaches yet).
- **Triggered abilities** (on-play / on-KO / between-turns) are deferred — they
  need trigger scan points at many call sites (bench-play, evolve, checkup, KO),
  a bigger surface best isolated. Only activated + passive shipped.
- **Rare Candy** (Basic → Stage 2 skip) waits for the item registry's
  hand-inspection + evolve reuse (its id sv01-191 is in the catalog).
- **The passive hook reads unconditionally** (no §9 ability-lock in scope). The
  defender-Active reduction (attack.ts §8.5) still is; M4 slice 4's `spreadDamage`
  now ALSO applies a *benched* Pokémon's own reduction passive/Tool (Bouffer −20
  reduces spread on the bench), via the same `passivesOf`. The attacker's
  Active-only bonus (Vitality Band) correctly does not reach the bench. Ability-lock
  still unscoped.
- **EffectContext is only `{seat}`** — an ability using a "self" op from the
  BENCH would wrongly target the Active. No in-scope ability does (Chien-Pao is
  Active-only); a bench-usable self-targeting ability needs the source uid in
  ctx. **(Closed in D50, engine 0.30.0: `EffectContext.sourceUid` — set at every
  run site that knows it; first reader `attachFromDeck.toSelf`, Pawmot. The
  "self" STATUS/heal ops still read the Active — only the attach reads the
  source so far.)**
- **P4 hidden info:** the `effect:choose` prompt (search candidates) and the
  existing opponent-hand/setup backs all need the P4 opaque-alias/redaction
  design — the projection is the same filter P4 will apply.
- Still open from earlier: `prizeValueOf` = 1 (ingest suffix — Chien-Pao ex
  currently gives 1 prize, not 2), name-derived energy provision, the
  projection-identity pop on evolve/switch (Pixi remount, animation follow-up).

## M4 slice 3 as built (2026-07-18) — persistent zones (Stadium + Tool)

**Shape (D24).** The persistent-zone Trainers are NOT interpreter programs —
their effects are **continuous**, so a new module
(`packages/engine/src/continuous.ts`) is the ONE place a rule read consults
them. It aggregates a Pokémon's printed passive (Bouffalant "Bouffer") WITH its
attached Tools, and the shared Stadium's effects, and exposes:
`effectiveRetreatCost` (turn.ts retreat — Beach Court's Basic −1),
`effectiveAttackCost` (attack.ts §8.2 — League HQ's Basic +{C}),
`effectiveMaxHp` (flow.ts `isLethallyDamaged` — the KO test — plus the web
`battle.hp`; Bravery Charm's Basic +50), and `passivesOf` (attack.ts §8.5: the
attacker's pre-W/R **bonus** (Vitality Band +10) and the defender's post-W/R
**reduction** — now Bouffer AND a defending Tool, summed). Pure and total: a
missing card/program/stadium contributes nothing.

**The Ability-LOCK aura (D100, engine 0.51.0) — the one continuous read that is
NOT an aggregation.** `PassiveEffects.disableAbilities` is the first passive field
that does not modify its HOLDER: it reaches other Pokémon ("Basic Pokémon in play
… have no Abilities"). So continuous.ts exposes a SECOND entry point beside
`passivesOf` — **`disabledAbilityUids(state)`**, one pass over BOTH boards
returning the top uids whose Abilities are currently off. Only a TOP CARD grants an
aura (it is a printed Pokémon Ability, never a Tool), and the aura's own read is
**UNGATED** — a lock never turns itself, or another lock, off. Seven independent
narrowing predicates (`stage` / `suffix` / `side` / `requiresDamage` /
`requiresActive` / `exemptSuffix` / `exemptAbilityNamed`) express all three printed
cards: Klefki sv01-096, Spiritomb sv02-089, Ting-Lu ex sv02-127 (+ -243/-263/-275).
**FOUR read sites consult the Set by uid — this is the checklist any new Ability
surface must join:** `cardplay.ts useAbility` (→ `ABILITY_DISABLED`, checked BEFORE
activeOnly/oncePerTurn/cost so the lock is what the player is told),
`continuous.ts passivesOf` (drops the TOP CARD's printed passive only — attached
Tools are §7.4 card effects, not Abilities, and keep contributing),
`triggers.ts triggersOf` (the single choke for onPlayToBench / onEvolve /
betweenTurns / onDamagedByAttack — **`onKnockOutTrigger` is deliberately NOT gated**,
it fires as the Pokémon leaves play) and `redact.ts redactedAbilitiesOf` (the HUD row
greys with `reason: null`). The Set is empty on any board with no lock in play, so
every other game is untouched. **KNOWN LIMITATION (open follow-up):** because auras
are collected ungated, a lock does not disable ANOTHER lock's source — an Active
Ting-Lu ex opposite a damaged Klefki should switch Mischievous Lock off and does not.
Fixing it means a fixpoint pass rather than one read; `abilityLock.test.ts` holds a
tripwire test that pins the current behaviour and flips when the fixpoint lands.

**The second non-holder-modifying passive: `removeWeakness` (D104, engine 0.55.0).**
Florges sv01-093 "Blooming Garden" ("Your Pokémon in play have no Weakness") is
the own-board twin of the lock aura, and it establishes the general shape for any
future passive that reaches OTHER Pokémon. Modelled as a **bare
`PassiveEffects.removeWeakness?: true` flag** (one card, own board, unconditional,
no "in the Active Spot" clause — a flag, not the `disableAbilities` predicate
object; a future opponent/conditional print adds fields then). continuous.ts reads
it through a **second dedicated scan beside `disabledAbilityUids`** —
**`seatRemovesWeakness(state, seat)`** (exported like its sibling) — which walks
that seat's OWN Active + Bench for a top card granting the aura. Unlike the raw
`disableAbilities` collector (which stays UNGATED so a lock never disables another
lock), a non-lock aura **consults `disabledAbilityUids` for its own source**, so a
§9-locked Florges (a damaged, non-ex Stage 2 opposite an Active Ting-Lu ex "Cursed
Land") loses the aura — this is the D100 "every non-lock Ability surface joins the
disabled-Set checklist" rule applied. It is FREE on boards without the card (the
lock pass runs only once a `removeWeakness` source is found). **The consumers are
the two Weakness read sites** — attack.ts §8.5 main hit and interpreter.ts
`snipeActive` (Chien-Pao ex "Hail Blade", Fezandipiti "Cruel Arrow") — each gating
`weaknessOf` on `seatRemovesWeakness(defenderSeat)` and nulling Weakness before the
pipeline (Resistance untouched). Bench snipes already carry `weakness: null` (§8.5
applies only to the Active/Defending Pokémon), so the aura's Bench Pokémon need no
extra handling — the only observable effect is the seat's Active while it defends.
**The pattern for the next such passive:** a new `PassiveEffects` flag/predicate + a
dedicated `continuous.ts` scan (gated through `disabledAbilityUids` unless it is
itself a lock) + a gate at each rule-read site it touches. `bloomingGarden.test.ts`
(8) covers it.

**The third such passive, and the first CONDITIONAL one: `noRetreatCostAura`
(D108, engine 0.59.0).** Clefable ex sv03-082 "Lunar Zone" — "All of your Pokémon
that have {P} Energy attached have no Retreat Cost" — is the only "no Retreat
Cost" print in the whole local pool, and the first aura whose printed clause
narrows **per TARGET** rather than per seat. Two shape lessons for the next one:

- **The field carries the clause, optionally.**
  `PassiveEffects.noRetreatCostAura?: { requiresEnergyType?: BasicEnergyType }` —
  not a bare flag (D104's shape) and not the seven-predicate object (D100's).
  An OPTIONAL refinement is the middle idiom the `CardFilter`s already use
  (`basicEnergy.energyType`, `basicPokemon.noRuleBox`): a future unconditional
  print just omits it, and no existing row changes.
- **The scan takes the Pokémon and DERIVES the seat.**
  `hasFreeRetreatAura(state, pokemon)` finds the side whose own `active`/`bench`
  holds this top uid (the aura is own-board, so no other side can matter), then
  looks for a live, non-§9-locked source there and evaluates the clause against
  the target. That is what let `effectiveRetreatCost(state, pokemon)` keep its
  signature — and it has **three** readers (`turn.ts` retreat, `redact.ts
  redactedRetreatOf` → the wire `{cost, can}`, and the web `GameHud.tsx`), so
  threading a seat parameter would have cost a web + wire diff for nothing.
  **When a new aura's read site already has the Pokémon, derive; don't thread.**

Two rule details worth reusing. **The energy clause is a PROVISION read**
(`providesEnergyType`, the `providesEnergy` CardFilter's own predicate), so a
wildcard Luminous Energy satisfies "{P} Energy attached" — the same §6.3 rule that
lets it pay a {P} cost; the card-identity reading (`energyProvidesOf(card) ===
type`, what the `basicEnergy` filter uses) was rejected as the narrower one.
And **a set-to-zero is read BEFORE the ± modifiers**: `effectiveRetreatCost`
checks the aura first, ahead of Beach Court's `basicRetreatDiscount` *and* ahead
of that function's `!isBasicPokemon → return printed` early-out, since the aura is
stage-agnostic where the Stadium deltas are Basic-only.

**The §9 gate here is structurally unreachable and the test says so.** No lock in
sv01–03 can touch Clefable ex — Klefki and Spiritomb narrow to Basics (it is a
Stage 1), Ting-Lu ex exempts ex — so `lunarZone.test.ts` (12) asserts the negative
(an Active Klefki does NOT lock it) and records why the positive is unassertable.

**[SUPERSEDED — the whole seam is CLOSED at 10/10 as of D114; see "The retreat-cost seam,
end to end" below. Kept for the reasoning trail.]**
**The retreat-cost seam is now open and has three unbuilt siblings**, all of which
exercise the ± composition order this slice only half-tested: Spidops ex
sv01-019/-223/-243 "Trap Territory" (opponent's Active Retreat Cost {C} MORE — the
opponent-side additive twin), ~~Calamitous Wasteland sv02-175~~ (**DONE**, D109 —
see below), and four attacks that READ the computed cost as a damage multiplier
(Heracross sv01-002, Spidops ex "Wire Hang", Sharpedo sv03-047, Stoutland
sv03-172 — "30/50 more damage for each {C} in your opponent's Active Pokémon's
Retreat Cost").

**The seam's Stadium half is now closed: `basicRetreatSurcharge` (D109, engine
0.60.0).** Calamitous Wasteland sv02-175 — "The Retreat Cost of each Basic non-{F}
Pokémon in play (both yours and your opponent's) is {C} more" — is Beach Court's
sign-flipped twin plus a type exemption, and it is the smallest slice built in the
long tail so far: **one `StadiumEffects` field, one registry row, one clause, one
fixture, one deck.** Three things it settled:

- **A bare number vs. an object is decided by whether the print narrows.**
  `basicRetreatDiscount?: number` (Beach Court, ungated) stayed a bare number;
  the surcharge is `{ amount: number; excludesType?: BasicEnergyType }` because
  its print carries "non-{F}". The asymmetry is deliberate and is the same
  D104-vs-D108 rule one level down: flag when unconditional, object with an
  OPTIONAL refinement when the clause narrows. `excludesType` is typed
  `BasicEnergyType` (the `requiresEnergyType` neighbour) even though it matches a
  Pokémon's `Card.types` — the vocabulary is the same word list, and the only two
  real prints exempt {F} / {W}.
- **Prose uses `{F}`; structural fields use `"Fighting"`.** `types_json` holds
  full words and attack costs hold `["Fighting","Colorless"]`, so any `non-{X}`
  gate must map the brace token to the word. sv02-174 Calamitous Snowy Mountain
  (`Basic non-{W}`) proves this is a two-card family, not a one-off — but it does
  **not** touch retreat cost, so it is a different seam.
- **The ± deltas can never actually stack**, so the "composition order" the D108
  resume point wanted tested is only observable against the aura. The shared zone
  holds exactly one Stadium *and* §7.3 allows one Stadium play per turn
  (`STADIUM_ALREADY_PLAYED`), so a discount and a surcharge cannot coexist —
  `effectiveRetreatCost` sums them anyway to keep the fold honest, and the test
  asserts the impossibility rather than pretending to exercise it. The only real
  composition is **set-to-zero beats surcharge** (Lunar Zone → 0 over a
  Wasteland-surcharged 3), which `calamitousWasteland.test.ts` (10) pins.

**Watch out for League HQ when pattern-matching:** sv03-192 has the *identical*
sentence skeleton ("each Basic Pokémon in play (both yours and your opponent's) …
{C} more") but bites on the ATTACK-cost seam. Two adjacent fields on the same
interface, one word apart in the print.

**The leanest coverage slice: a new `CardFilter` kind — `evolutionPokemon` (D105,
engine 0.56.0).** Jacq sv01-175/-236/-250 ("Search your deck for up to 2 Evolution
Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.") is the
FIRST long-tail card whose whole novelty is ONE new `CardFilter` variant — the D102
`noRuleBox`/`toolCard` pattern with **zero new op, action, event or interpreter
op-case**. The **6-step recipe** for any future filter kind: (1) add
`| { kind: "…" }` to the `effects.ts CardFilter` union (with a doc-comment); (2) add
a `case` to `interpreter.ts matchesFilter` — the switch is exhaustive with **no
`default`**, so tsc forces this; (3) add a `case` to `interpreter.ts retrieveNoun`
(same forcing) — for a plural that starts with an article you MUST spell the
article-free plural (`searchNote` does "up to N {plural}", the Chien-Pao bug the
comment records); (4) the predicate — reuse a `cards.ts` helper if one exists
(`evolutionPokemon` reused the EXISTING exported `evolveFromOf(card) !== null`, so no
new helper, unlike D102's `hasRuleBox`); (5) author the card in `registry.ts` (Jacq
is the Flamigo search-to-hand shape `[searchDeck {…} dest:hand max:2, shuffleDeck]`,
`max:2` = "up to 2"); (6) a behavioural test through `playTrainer` → the `chooseCards`
park (see `jacq.test.ts`, 8). No schema/wire change — `CardFilter` is engine-internal.
**`evolutionPokemon` = the exact complement of `basicPokemon` inside `anyPokemon`**
(`evolveFromOf` is non-null for Stage 1 / Stage 2 / VMAX/VSTAR, null for Basics and
non-Pokémon). This slice **drains the "one new filter kind" avenue for sv01–03**: a
`Search your deck` D1 sweep showed Jacq was the only such searcher; the next filter
candidate, `itemCard`, is mechanism-blocked (its only user Arven searches an Item AND
a Tool at once — a dual-target search).

**Stadium (§7.3).** A single shared `GameState.stadium` `{uid, owner}`.
`playTrainer` routes a Stadium to **`playStadium`**: one play per turn (a new
`TurnAllowances.stadiumPlayed`), replace-on-play discards the predecessor to
**its OWNER's** pile (`STADIUM_DISCARDED`, read off the post-hand-update state
so self-replace still works), and the same-**NAME** ban compares `card.name`
(the sv02-171/sv03-229 "Artazon" reprints can't self-replace). Allowed on turn
1 (§4 bans only Supporters + attacking). Stays in play; its effects are
continuous.

**Tool (§7.4).** A new action **`attachTool` {seat, uid, target}** (Tools carry
a target, so they do NOT go through playTrainer — routing a Tool there rejects
`TRAINER_TYPE_UNSUPPORTED`). One Tool per Pokémon (`TOOL_ALREADY_ATTACHED`),
uncapped per turn, consumes NO allowance, no detach — the `InPlayPokemon.tools`
slot M1 reserved is finally populated. It rides the stack through evolution
(the §10 spread preserves `tools`) and switch/gust (`switchInto` moves the whole
object) and discards with a KO'd stack (`discardFromStack "all"` already
included `tools`). New event `TOOL_ATTACHED`.

**Coverage.** A Stadium with no `stadium` row / a Tool with no `passive` row
reject **`TRAINER_NOT_SIMULATED`** (never a silent no-op). Representative set
(verified vs local D1 2026-07-18): Beach Court (sv01-167), Pokémon League
Headquarters (sv03-192), Vitality Band (sv01-197), Bravery Charm (sv02-173).
`DAMAGE_DEALT` gained an optional `bonus`; 4 new error codes (NOT_A_TOOL /
STADIUM_ALREADY_PLAYED / STADIUM_SAME_NAME / TOOL_ALREADY_ATTACHED). engine
0.5.0 → 0.6.0.

**Web.** Stadiums are BOTH a HUD button (TurnPanel, greyed by the §7.3
once-per-turn + same-name gates) AND a drag onto the shared stadium slot —
`moveToAction`/`gamePlacementPredicate` gained the one non-own drop target
(`owner:"global" zone:"stadium"`); Tools attach by drag onto an own Pokémon
(the energy-attach gesture, routed to `attachTool`). The projection renders the
shared Stadium public (it can't exist during setup), `battle.hp` reads the
continuous max HP (Bravery Charm shows live), and the HUD retreat cost / attack
payability read the effective ones. `logFromEvents` rows for TOOL_ATTACHED /
STADIUM_DISCARDED and a pre-W/R `· boosted +N` breadcrumb (ordered before
weakness so the §8.5 math reads correctly). Both demo decks stay 60 cards
(Ember: Beach Court + Vitality Band; Tidal: League HQ + Bravery Charm — DIFFERENT
per deck so the replace path is reachable live). Suite 948 → **974**.

**Review (2 Opus agents, rules+integration / wire-safety+web-lockstep) + fixes:**
wire-safety proven clean (33 hostile `attachTool`/`playStadium` inputs — zero
throws, zero mutation; every event payload a copy; continuous.ts total on real
states). Two findings: (a) the `· boosted` log breadcrumb printed AFTER weakness
though it applies before — reordered to pipeline order; (b) **the deferred
evolve-below-HP KO gap** — Bravery Charm is the one effect that can LOWER
effective max HP on evolution, so a damaged charmed Basic evolving below the new
stage's HP should KO the instant it evolves (§8.1), but `evolve` runs no KO
check and the engine's KO flow is Active-only + turn-ending. An Active in that
state is cleaned up at the next Checkup; a benched one is NOT (the same
Active-only KO limit bench spread damage carries). Deferred WITH the bench-KO
generalization (a mid-turn KO that resumes the actor's turn is new flow
machinery), documented at turn.ts/registry.ts and PINNED by a characterization
test so a future fix flips it deliberately. **→ Closed by slice 4 (below):
`evolve` runs the KO check through the new mid-turn KO flow, and the
characterization test now asserts the KO.**

**Verification.** `bun run check` green (tsc + biome + **974 tests** — 18 new
engine cardplay covering Stadium replace/same-name/one-per-turn, the four
continuous effects, Tool attach + carry-over + KO discard, wire-safety, purity;
plus new projection/log/placement-lockstep/HUD-DOM tests). **Live /play smoke
(agent-browser, seed frozen to 6, ZERO console errors):** DROVE the two new
gestures to resolution — **Beach Court dragged onto the shared stadium slot**
(board summary "Stadium: Beach Court", persisted through two turns + hot-seat
flips) which **dropped Growlithe's retreat button from "Retreat (2)" to
"Retreat (1)" live** (the continuous discount in the HUD), then **Vitality Band
dragged onto Growlithe** ("Growlithe (1 tool)", log row "attached Vitality Band
→ Growlithe"). The Stadium's shared zone, Tool attachment, projection, and the
continuous retreat read all confirmed end-to-end on the real Pixi board.

## M4 slice 4 as built (2026-07-18) — the Knock Out generalized off the Active

**Shape (D25).** The KO flow was **Active-only + turn-ending**; slice 4
generalizes it so bench spread/snipe damage and a mid-turn KO both work.

- **`knockOut(state, koedSeat, koedUid, prizeSeat, events)`** (flow.ts) now KOs
  ANY in-play Pokémon, found by its stack-top **uid**: a benched KO discards the
  whole stack, compacts the bench, seeds ONLY a `takePrizes` stage (no
  promotion — no empty Active spot); an Active KO is unchanged (takePrizes +
  promote). Addressing by uid (not index) makes a batch of KOs shift-safe.
- **`collectKnockOuts(state, seats, events)`** is the ONE post-damage sweep —
  every lethally-damaged in-play Pokémon (Active + Bench), prizes to each KO'd
  side's opponent (`otherSeat`, universal per §8.1), stages grouped
  **prizes-first**, and the §14 **tie guard runs only when both seats lost a
  Pokémon** (proven necessary + sufficient in review) via the same speculative
  `evaluateWin`. It replaced the inline KO blocks in `attack.ts finishAttack`
  (now sweeps the defender's WHOLE board) and `runCheckup`, so §14 precedence
  stays single-sourced.
- **A new `PendingStage {kind:"resumeTurn"; seat}` + `resolveMidTurnKnockOuts`**:
  a KO mid-turn (not from an attack) resolves its prize/promote stages then
  **RESUMES** the actor's turn (`advance` restores `turn:action`) instead of
  ending it — the new §8.1 flow shape. Allowances live on `GameState`, untouched.
  `seats` MUST be the boards the effect actually damaged (evolve passes
  `[actorSeat]`; a future opponent-damaging snipe passes that board).
- **evolve** now runs the KO check on the just-evolved Pokémon — closing D24's
  deferred **evolve-below-HP gap**: a benched charmed Basic that evolves below
  the new stage's HP (a Bravery Charm's Basic-only +50 dropping off — the one
  effect that LOWERS effective max HP) is Knocked Out the instant it evolves,
  mid-turn, the opponent taking the prize on the actor's turn. The
  characterization test now asserts the KO.
- **`spreadDamage` op** (`{op:"spreadDamage", target:"opponentBench", amount}`,
  effects.ts) placed by the interpreter — flat damage to EACH opponent Benched
  Pokémon; no Weakness/Resistance on the Bench (§8.5), but a benched Pokémon's
  own reduction passive/Tool (Bouffalant "Bouffer" −20) STILL applies (via
  `passivesOf`), while the attacker's Active-only bonus (Vitality Band) does
  not. The interpreter only PLACES the damage (one `DAMAGE_DEALT` per benched
  Pokémon) — the KO check stays in `finishAttack`, so the interpreter still
  never KOs or touches the flow tail. A sixth deriver sentence recognizes "This
  attack does N damage to each of your opponent's Benched Pokémon." (optional
  W/R clarifier).

**Web.** The ONLY source change is `projection.ts koParkActiveSeat` treating
`resumeTurn` as in-turn (a mid-turn KO park still reports the actor as
`activePlayer`, unlike a between-turns checkup park). The exhaustive
`phaseViewOf` Phase switch is untouched (`resumeTurn` is a PendingStage, not a
Phase); the log/HUD need nothing — `DAMAGE_DEALT`/`KNOCKED_OUT` resolve a benched
uid the same way, and the opponent's mid-turn prize pick rides the existing
`waitingOn` viewer-follow (the HUD gates on `waitingOn`, never turn ownership).
Representative demonstrator is a fixture spread attacker (`fix-sniper`, Spread
Shot [C] 30 + 20 to each opponent Benched); a live sv card lands with the
coverage fan-out. engineVersion 0.6.0 → 0.7.0.

**Review (2 Opus agents — rules+flow / wire-safety+web-lockstep): both clean, no
correctness defects.** The rules agent PROVED the §14 tie guard's `bothSeatsHit`
condition necessary AND sufficient (a one-sided KO batch can only ever win for
the one player who gains prizes / faces the emptied board), verified prize
attribution for every KO source, the uid-addressed multi-KO shift-safety,
game-over-beats-resume precedence, evolve's no-spurious-firing, and the spread
math. The wire agent proved koParkActiveSeat correct in all three park origins,
`phaseViewOf` correctly unchanged, the opponent's mid-turn prize pick flips the
device correctly (nothing gates on turn ownership), and spreadDamage's event
contract + purity. Two INFORMATIONAL notes (not defects): `spreadDamage` treats
reduction passives as position-agnostic (correct for the pool — a future
Active-only reduction passive would want an `activeOnly` gate), and
`finishAttack`'s `batch.done` branch is a deliberate defensive dead branch until
a both-sides-damaging attack lands.

**Verification.** `bun run check` green (tsc + biome + **983 tests** — 974 → 983:
8 new engine cardplay in `knockout.test.ts` (spread derive, flat spread + no
bench weakness, benched reduction still applies, single bench KO no-promotion,
double Active+Bench KO prizes-first drive-out, §14.1 win off a bench KO, empty
bench no-op, purity) + a projection test for the mid-turn KO park; the flipped
evolve-below-HP characterization test in `stadiumTool.test.ts`). **Live /play
smoke (agent-browser, seed 6, ZERO console errors):** the game boots with the
re-ingested demo decks — Pixi canvas renders, all cardPool fetches succeed
(no 4xx/5xx), and the coin-toss action drives engine → projection → HUD with an
empty error collector. The new mechanics themselves are NOT demo-reachable (no
spread card in the decks; the evolve-below-HP window needs a contrived board),
so they are covered exhaustively by the engine + web tests + the two clean
reviews — the slice-2 precedent for a mechanic whose live preconditions the demo
hands don't deal.

## M4 slice 5 as built (2026-07-18) — Special Energy (§6.1)

**Shape (D26).** Special Energies provisioned a conservative 1 Colorless
(name-derived); slice 5 models their rules text as data.

- **`EnergyProgram`** on `CardProgram.energy` (registry.ts): `{ provides:
  string[]; demoteWithOtherSpecial?: string[]; onAttach?: {kind:
  "switchIfBenched"} }`. `provides` units may be a concrete type, the
  **`ANY_ENERGY` wildcard** (cards.ts — "any 1 type"), or several (multi-unit).
- **`providedEnergy(state, pokemon)`** (continuous.ts) is the ONE provision read
  site: a basic energy gives its type; an authored special energy its
  EnergyProgram units, evaluating Luminous's "demote to {C} if the holder has
  any OTHER Special Energy attached" (two Luminous each see the other → BOTH
  demote); an unauthored special energy falls back to one Colorless (graceful —
  an energy always provides something, unlike an unsimulated Trainer's loud
  reject). Pure, total, order-stable.
- **`costMet`** (attack.ts) upgraded for the wildcard: `ANY_ENERGY` fills a typed
  shortfall OR a Colorless slot — wildcards allocated to the (pickier) typed
  needs first, then every remaining unit pays Colorless. Provably optimal
  (Hall's theorem) and backward-compatible with all-concrete provision;
  brute-forced in review against a bipartite matcher (13,640 cases, 0
  mismatches).
- **On-attach**: `attachEnergy` (turn.ts) runs `energy.onAttach` — Jet Energy's
  `switchIfBenched` switches a benched holder to the Active Spot (reusing
  `switchInto`, now exported from interpreter.ts), firing ENERGY_ATTACHED then
  POKEMON_SWITCHED; nothing fires on an Active attach.

**Web.** The engine's §8.2 cost check AND the HUD's payability preview both call
`providedEnergy` — **the D18 duplicated payability is gone** (proven byte-for-byte
in review). The log's ENERGY_ATTACHED row resolves its host by the energy's
**uid**, not the target slot, so Jet's mid-batch bench compaction can't misname
it. Demo decks run the two energies **different per deck** (Ember: Jet ×3,
Tidal: Luminous ×3 — type-neutral, so the disjoint-energy rule keeps them
split); both reachable in one Ember-vs-Tidal game. engineVersion 0.7.0 → 0.8.0.

**Representative set:** Jet Energy (sv02-190) + Luminous Energy (sv02-191),
verified vs local D1. The SV-era catalog has **no Double Turbo** (swsh-era), so
the multi-provide case here is the wildcard kind; `provides` being an array still
supports a future multi-unit-same-type energy as a one-row registry add (proven
by the `costMet(["Colorless","Colorless"], ["Colorless","Colorless"])` test).

**Review (2 Opus agents — rules+matcher / wire+web).** Rules agent: **no
defects**, brute-force-verified the matcher, confirmed provision / the Luminous
demote (incl. two-Luminous) / the Jet switch / the League HQ-surcharge
interaction; suggested coverage pins (added). Wire agent: **one MEDIUM** — Jet's
on-attach switch compacts the bench, so the ENERGY_ATTACHED **log row** (which
resolved the host by index against the settled state) named the wrong Pokémon;
**fixed** (resolve by uid) + regression-pinned in logFromEvents.test.ts. Plus a
LOW stale-JSDoc (per-deck basic-energy counts) and a stale comment — both fixed.
Everything else proven clean (attachEnergy never-throw, switchInto pure,
providedEnergy pure, HUD lockstep).

**Verification.** `bun run check` green (tsc + biome + **1002 tests** — 983 →
1002: 16 engine cardplay in specialEnergy.test.ts (wildcard costMet incl.
multi-wildcard + multi-unit + backward-compat, provision as data, the Luminous
demote incl. two-Luminous + unauthored-special, Jet's bench switch vs Active
no-switch, a real typed attack paid by a wildcard, purity) + 2 HUD-DOM payability
tests (a Luminous wildcard enables a typed attack, a demoted Luminous disables
it) + a log host regression test). **Live /play smoke (agent-browser, seed 6,
ZERO console errors):** boots with the re-ingested demo decks — Pixi canvas
renders and BOTH special energies (sv02-190 Jet, sv02-191 Luminous) fetch 200
from the api (the cardPool resolves them). Driving the attach gestures to
resolution live is the documented Pixi hit-test session-eater, so the mechanics
are covered by the engine + HUD-DOM + log tests + the two reviews.

## M4 slice 6 as built (2026-07-18) — triggered Abilities (§9)

**Shape (D27).** Triggered Abilities — the ones that FIRE on a game event rather
than being player-activated (§9) — get a **`TriggeredAbility`** entry on
`CardProgram.triggered` (`{ name; trigger; program; optional?; activeOnly? }`,
registry.ts) run through the shared interpreter by a small new module
**`triggers.ts`**, wired at THREE scan points:

- **`onPlayToBench`** — turn.ts `playBasicToBench`, on the freshly-benched
  Pokémon (the last dense slot). A *turn* play only — a setup placement
  (setupPlaceBench) is a different handler and not "during your turn", so it
  never triggers.
- **`onEvolve`** — turn.ts `evolve`, on the just-evolved Pokémon (at
  `action.target`), AFTER the evolve-below-HP KO check (a Pokémon KO'd on
  evolution left play, so its own "when you evolve" Ability does not fire).
- **`betweenTurns`** — flow.ts `runCheckup`, over every in-play Pokémon in
  `[endedSeat, other]` order (Active then Bench), AFTER the §13 condition ticks
  and BEFORE the KO sweep.

**Parking vs synchronous.** Board triggers (onPlayToBench/onEvolve) run during
the controller's own turn, so a program needing a decision **PARKS on the
existing `effect:choose` phase** (triggers.ts `settleTrigger` ≡ cardplay.ts
`settleRun`) and resumes to turn:action via the same **`resolveEffect`** action
— a parked trigger is byte-identical to a parked Trainer. `betweenTurns` triggers
are **NON-PARKING by construction** (a heal-each / a fixed counter placement) and
thread synchronously through the one Checkup reduction; a placed counter
(Trevenant) that goes lethal is Knocked Out by the Checkup's own shared
`collectKnockOuts` sweep (and a lethal-poison-vs-lethal-counter double KO rides
its existing §14 tie guard). Representative cards carry ONE triggered Ability per
timing, so `runBoardTrigger` runs at most one program (chaining several parking
triggers on one card is a follow-up).

**Optional ("you may") triggers AUTO-FIRE** — every representative is pure upside
(search / heal / counter), and where the underlying op is "up to" (Insta-Flock's
search) the player can still take none. A yes/no confirm for a *downside* trigger
is the follow-up.

**New ops (effects.ts/interpreter.ts).** `healEach` (heal N from EACH of the
controller's own in-play Pokémon, one HEALED each, clamped); `damageActive` (PUT
N damage counters on the opponent's Active). `damageActive` is a **counter
placement, not attack damage** → no Weakness/Resistance AND **no
damage-reduction passive**: Bouffalant's "Bouffer" reduces *"damage from
attacks"*, which an Ability's counter is not (the same rule the poison/burn
Checkup ticks follow) — distinct from `spreadDamage`, which IS an attack's damage
and does take Bouffer. `healChosen.amount` widened to `number | "all"` (Arboliva
heals all, Potion still 30); a `byName` search filter (Insta-Flock searches its
own copies). New event `ABILITY_TRIGGERED`; `COUNTERS_PLACED` gained source
`"ability"`. engineVersion 0.8.0 → 0.9.0.

**Web.** The parked trigger reuses everything: the projection maps effect:choose
(controller = waitingSeat, so the hot-seat viewer stays put), `EffectChooseDialog`
mounts off the projected pending decision **origin-agnostically** (a bench-play/
evolve *drag* park renders the same chooseCards/choosePokemon dialog a Trainer
button does), and `resolveEffect` resolves it — **no new dialog, no projection
change**. Only `logFromEvents` grew: an `ABILITY_TRIGGERED` row and a
COUNTERS_PLACED `"ability"` (system) row.

**Representative set (real sv01–03 ids, verified vs local D1 2026-07-18):**
Flamigo "Insta-Flock" (sv02-170/227 — onPlayToBench, search up to 3 Flamigo →
hand), Arboliva "Enriching Oil" (sv01-023 — onEvolve, heal all from 1 of yours),
Garganacl "Blessed Salt" (sv02-123 — betweenTurns, heal 20 from each of yours),
Trevenant "Forest Miasma" (sv03-012 — betweenTurns, Active-only, 1 counter on the
opp's Active). NOT added to the seed-tuned demo decks (an auto-firing trigger
would perturb the demo hands) — covered by engine + web tests, the slice-4/5
precedent.

**Review (2 Opus agents — rules+flow / wire+web).** Both agents were terminated
early by the shared usage limit (reset pending), so the review is PARTIAL. Before
dying the rules agent CONFIRMED one bug: `damageActive` was applying the
defender's `damageReductionAfterWR`, so Trevenant's counter on a Bouffalant
(Bouffer −20) reduced 10 → 0 and placed nothing — **fixed** (counters are not
attack damage; placed flat) + regression-pinned (`sv03-174` in TRIGGER_DECK). The
remaining risk areas were self-verified: the turn-gate makes `settleTrigger`'s
done→turn:action always correct; the §14 double-KO path is the shared
`collectKnockOuts` (unchanged, already tested for the checkup double-KO); the web
lockstep holds (viewer-follow + origin-agnostic dialog, confirmed by reading
useLocalGame/GameHud). A `/code-review` re-run after the limit resets is the
logged follow-up.

**Deferred (documented, not silent):** `onKnockOut` triggers (fire during the
OPPONENT's turn mid-KO-sweep — need a resume-the-tail continuation, the hairiest
timing); parking mid-Checkup (a betweenTurns Ability needing a decision); the
multi-target **snipe** (Hawlucha "Flying Entry" choose-2 / Meowscarada "Bouquet
Magic" choose-1) + the `settleRun`→`resolveMidTurnKnockOuts` reuse — an
on-play/on-evolve *damaging* trigger that KOs mid-turn (needs a multi-Pokémon
prompt + settleRun sweeping the board after a damaging program). These land with
Rare Candy and the coverage fan-out.

**Timing #5 — `onDamagedByAttack` (D99, engine 0.50.0).** The FIFTH `TriggerTiming`
(after `onKnockOut`, D30). Fires when an Active Pokémon is DAMAGED by the main hit
of an opponent's attack — scanned in attack.ts at the SAME spot D98's `damageAttacker`
recoil folds (right after `DAMAGE_DEALT`, gated `dealt>0`, main-hit Active only,
BEFORE finishAttack's §8.1 sweep, so "even if this Pokémon is Knocked Out" is free).
The scan is a new **`runDamagedByAttackTriggers`** in triggers.ts (mirrors
`runCheckupTriggers` — **NON-PARKING by construction**, threads state through `.state`;
`triggersOf` stays module-private). The program runs under the DAMAGED Pokémon's seat,
so an `applyStatus target:"defender"` op lands on the ATTACKER's Active (`otherSeat`) —
the Trevenant/Mawile "run on the holder, target the opponent" shape. Representative:
**Armarouge sv03-044 "Scorching Armor"** (Burn the attacker). `activeOnly:true` carries
"in the Active Spot" (redundant with the read site, which only ever passes the main-hit
Active). Deferred on this timing: **Klawf ex sv03-120** ("discard an Energy from the
Attacking Pokémon") — a §9.4 opponent-side decision that PARKS mid-attacker's-turn, the
one `onDamagedByAttack` card the non-parking Burn framework does not yet cover. Tests:
`scorchingArmor.test.ts` (4).

**Verification.** `bun run check` green (tsc + biome + **1019 tests** — 1002 →
1019: 16 engine `triggered.test.ts` covering each scan point + parking + forced
auto-resolve + the setup-doesn't-trigger scoping + the Bouffer-counter regression
+ purity, plus 1 `logFromEvents` row test). No live /play smoke driven this
session (the representatives aren't in the demo decks and the review's browser
pass was cut by the usage limit); the mechanic is covered by the engine + web
tests and the confirmed fix. Files: effects.ts, events.ts, registry.ts,
interpreter.ts, triggers.ts (new), turn.ts, flow.ts, index.ts, testFixtures.ts,
triggered.test.ts (new) + logFromEvents.ts/.test.ts, GameHud.tsx (comment).

## M4 slice 7 as built (2026-07-18) — Rare Candy (§7.1)

**Shape (D28).** Rare Candy evolves a Basic straight to a **Stage 2** from hand,
skipping the Stage 1 ("counts as evolving"). Because it evolves — and flow.ts
owns every Knock Out (the interpreter never KOs) — it is NOT an interpreter op
program but a dedicated **`rareCandy` action** (cardplay.ts)
`{seat, uid (the Rare Candy Item), target (the Basic), evolutionUid (the Stage
2)}`. The `evolve` tail was extracted into a shared **`placeEvolution`**
(turn.ts) that BOTH `evolve` and `rareCandy` call, so Rare Candy inherits §10
carry-over (damage/energy/tools stay, conditions/markers clear, turnPlayed
resets), the **on-evolve triggered Ability**, and the **evolve-below-HP mid-turn
KO** (a Bravery Charm's Basic-only +50 falling off) with zero new flow code. The
refactor is behavior-equivalent to the old `evolve` (proven in review + the
unchanged evolution suite). Timing mirrors `evolve` exactly (§4 first-turn ban +
`turnPlayed >= state.turn` "played this turn" ban → `FIRST_TURN_EVOLVE` /
`EVOLVE_TOO_SOON`); the target must be a Basic in play (`NOT_A_BASIC_POKEMON`).

**The Basic→Stage 2 bridge.** The catalog stores only each card's IMMEDIATE
`evolveFrom` (a Stage 2 names its Stage 1, never the Basic), so
`stage2EvolvesFromBasic` (cardplay.ts) resolves the link by BRIDGING: it checks
that some card in `state.cardPool` is a **Stage 1** named `stage2.evolveFrom`
whose own `evolveFrom` is the target Basic's name. **Documented gap:** a deck
running Rare Candy + a Stage 2 but ZERO copies of the intervening Stage 1 can't
resolve the link (the Stage 1 is absent from the pool) — the same ingest-debt
class as `prizeValueOf` = 1 and name-derived energy; the fix is a persisted
evolution family at ingest. The demo Ember deck runs Crocalor, so it resolves —
**verified vs the live api**: sv01-038 Skeledirge (Stage2, evolveFrom Crocalor) →
sv01-037 Crocalor (Stage1, evolveFrom Fuecoco) → sv01-036 Fuecoco (Basic).

**Registry + routing.** A **marker** `CardProgram.rareCandy?: true` (not a
program) identifies Rare Candy (sv01-191/256); `playTrainer` on a Rare Candy uid
rejects `TRAINER_TYPE_UNSUPPORTED` (the Tool-routing precedent). New error code
`RARE_CANDY_NO_STAGE2`. No new event — Rare Candy emits `TRAINER_PLAYED` (Item)
then `POKEMON_EVOLVED`, both already logged.

**Web.** An engine helper **`rareCandyOptions(state, seat)`** (the authority)
lists the legal `{target Basic, matching Stage 2 uids}` pairings (mirroring the
handler's Basic / turnPlayed / chain / first-turn checks). Rare Candy shows in
the Trainers list but its button opens a bespoke **`RareCandyDialog`** (pick a
Basic → pick a Stage 2 → dispatch `rareCandy`) rather than `playTrainer` — the
one Trainer that carries a target isn't expressible through the generic button;
it has a Cancel affordance (Rare Candy is optional) and a Back step when >1
Basic. `playableTrainers` greys the button out when `rareCandyOptions` is empty
(computed lazily — its cardPool scan only runs when a Rare Candy is in hand). The
**projection needs NO change**: `placeEvolution` resolves to `turn:action`
(done), a mid-turn KO park (`resumeTurn`, already in-turn per koParkActiveSeat),
or an on-evolve trigger park (`effect:choose`, origin-agnostic) — all already
handled. Demo: Rare Candy ×2 added to Ember (Fire energy 14→12; non-Basic for
non-Basic keeps the Basic count / mulligan rate). engineVersion 0.9.0 (unchanged
— additive). Suite 1019 → **1045**.

**Review (2 Opus agents — rules+engine / web+integration): both clean, no
correctness bugs.** The rules agent PROVED the `placeEvolution` refactor
byte-for-byte equivalent to the old `evolve` (state shape, event order,
hand-removal timing, the from/target split), the bridge sound (no realistic
false positive — the intermediate is forced to be a Stage 1), wire-safety
airtight (every index/uid/target checked; no throw or card-destruction), and
purity. The web agent confirmed the projection "no change" claim across all three
`placeEvolution` outcomes, the dialog/`rareCandyOptions` lockstep (an enabled
button can only ever produce a legal dispatch or a clean reject), the demo deck
(exactly 60, disjoint-except-shared-trainers intact, bridge present), and the log
rows. Fixes applied from the LOW findings: a **Cancel** button on the dialog
(optional play), `rareCandyOptions` made **lazy** in playableTrainers (perf), and
three coverage tests added (benched mid-turn KO, Tool carry-over, an Energy as
the evolution card). The documented bridge gap and the un-exercised sv01-256
reprint id are noted, not defects.

**Verification.** `bun run check` green (tsc + biome + **1045 tests** — 1019 →
1045: 24 engine `rareCandy.test.ts` covering the skip (Active + bench),
carry-over incl. Tools, both mid-turn KO paths, timing, the Basic/chain/Stage-2
rejections, the playTrainer reject, `rareCandyOptions`, wire-safety, purity + 2
DOM tests driving the real GameHud → RareCandyDialog → `rareCandy`). Production
`vite build` green. **Live /play boot smoke (agent-browser, seed 6, ZERO console
errors):** the game boots with the re-balanced Ember deck — Pixi canvas renders,
**all 75 cardPool fetches succeed (incl. sv01-191 Rare Candy → 200)**, the coin
toss advances into a clean 7-card deal (no mulligan storm from the energy swap),
and the live api confirms the real-catalog bridge resolves. Driving Rare Candy to
a live resolution needs a contrived seed + the Pixi hit-test session-eater, so it
is covered by the engine + DOM tests + the two clean reviews (the slice-4/5/6
precedent). Files: actions.ts, registry.ts, turn.ts (placeEvolution), cardplay.ts
(rareCandy + bridge + rareCandyOptions), index.ts, testFixtures.ts,
rareCandy.test.ts (new) + GameHud.tsx, demoDecks.ts/.test.ts,
GameHud.cardplay.dom.test.tsx.

## M4 slice 8 as built (2026-07-19) — the mid-turn-damage snipe (§9)

**Shape (D29).** A damaging Ability that puts damage counters on CHOSEN
opponent Benched Pokémon and can Knock one Out **mid-turn** (the actor keeps
their turn). It closes the deferred "multi-target snipe + settleRun →
resolveMidTurnKnockOuts" tail from slices 4/6.

- **`damageChosen` op** (`{op:"damageChosen", target:"opponentBench", amount,
  count}`, effects.ts) placed by the interpreter (`placeSnipeCounters`): put
  `amount` HP of damage counters on `count` chosen Benched Pokémon of the
  opponent. **A counter placement, not attack damage** — flat, no
  Weakness/Resistance AND **no reduction passive** (Bouffalant's "Bouffer"
  reduces *"damage from attacks"*, which an Ability's counter is not — the
  damageActive / poison-burn-tick rule; **distinct from `spreadDamage`**, which
  IS an attack's damage and does take Bouffer). One `COUNTERS_PLACED` source
  `"ability"` per Pokémon. **Parks on a new multi-Pokémon prompt** when the
  opponent has MORE than `count` Benched, is forced (hits all) at `count` or
  fewer, and is a no-op with an empty opponent Bench. Only raises damage — the
  KO check runs in the caller's sweep (below), so the interpreter still never
  KOs or touches the flow tail.
- **`choosePokemonMulti` prompt** (`{kind:"choosePokemonMulti", candidates,
  max, note}`) + choice `{kind:"pokemonMulti", refs}` (interpreter.ts) — the
  first MULTI-select Pokémon decision (choosePokemon was exactly-one). The snipe
  is "you may" + "up to", so 0..max distinct refs is legal (the chooseCards
  semantics, lifted to Pokémon refs); `validateChoice` (cardplay.ts) became a
  switch with the new branch (max clamp, candidate membership, no duplicates).
- **The KO reaches flow.ts through a unified `settleProgram`** (flow.ts). The
  two IDENTICAL local settle helpers — triggers.ts `settleTrigger` and
  cardplay.ts `settleRun` — collapse into one. On a PARKED program it sets
  effect:choose + EFFECT_PENDING (unchanged); on a DONE program it returns the
  controller to turn:action **then runs `resolveMidTurnKnockOuts(state,
  controller, SEATS, events)`** (the slice-4 mid-turn machinery). So a snipe
  that drops an opponent's Benched Pokémon resolves as a mid-turn KO: the
  opponent's Pokémon prizes to the actor, the actor's turn resumes
  (`resumeTurn`), and taking the actor's last prize ends the game at the shared
  §14 check. It sweeps BOTH boards (a harmless superset — only the opponent's
  board can be freshly lethal from an in-scope effect, the same total scan
  runCheckup does), and is **behaviour-preserving for every non-damaging program**
  (draw/search/switch/heal leave nothing lethal, so the sweep is a no-op back to
  turn:action — proven by the unchanged 276-test engine suite). This is the
  intentional flow↔triggers import cycle (both used only in function bodies): the
  interpreter/triggers never KO, so completion is handed BACK to flow (the
  KO/tail owner).
- **The engine's first ability activation COST.** Meowscarada ex "Bouquet
  Magic" — "You must discard a Basic {G} Energy card from your hand in order to
  use this Ability." — adds `AbilityProgram.cost` (`{kind:"discardBasicEnergy",
  energyType}`, registry.ts). `useAbility` (cardplay.ts) now gates on the shared
  **`programPlayable`** (renamed from `trainerPlayable`, extended so the snipe
  needs an opponent Bench — a play that does nothing can't be made, so the cost
  is never spent for no effect) and then pays the cost (find + discard one Basic
  {G} Energy from hand, `ABILITY_COST_PAID`) BEFORE running the program — an
  unpayable cost rejects `ABILITY_COST_UNMET` with nothing spent. The cost is
  paid once, before parking, so a parked snipe resolving via `resolveEffect`
  never re-charges. New error `ABILITY_COST_UNMET`; new event `ABILITY_COST_PAID`.

**Representative set (real ids, verified vs the live api 2026-07-19):**
Hawlucha (sv01-118, "Flying Entry" — a TRIGGERED Ability, onPlayToBench, choose
2 of the opponent's Benched Pokémon and 1 counter each = amount 10 count 2) and
Meowscarada ex (sv02-015/256, "Bouquet Magic" — an ACTIVATED Ability with the
{G}-discard cost, once/turn, not Active-only, 3 counters on 1 = amount 30 count
1). NOT added to the seed-tuned demo decks (Hawlucha auto-fires on the bench
play and both need an opponent Bench + Meowscarada a {G} in hand — a contrived
board; covered by the engine + web tests, the slice-4/5/6/7 precedent).
engineVersion 0.9.0 → 0.10.0 (additive).

**Web.** The snipe reuses everything: the projection is **unchanged** (the
effect:choose case passes `phase.prompt` through, so choosePokemonMulti rides
the existing `pendingDecision.effectChoose`; the mid-turn KO park is `resumeTurn`
= in-turn, already handled by koParkActiveSeat since slice 4). GameHud adds one
**`ChoosePokemonMultiDialog`** (multi-select up to `max`, a Confirm/Take-none
button dispatching `resolveEffect` with `{kind:"pokemonMulti", refs}` — the
ChooseCardsDialog shape lifted to Pokémon rows). Meowscarada's button is NOT
specially gated (the D19 afford-then-reject precedent — clicking with no {G} or
no opponent Bench dispatches `useAbility` and the engine rejects with a pill).
`logFromEvents` grows one row (`ABILITY_COST_PAID`); the snipe's damage
(`COUNTERS_PLACED` "ability"), `ABILITY_TRIGGERED`/`ABILITY_USED` and the KO/prize
rows already existed.

**Verification.** `bun run check` green (tsc + biome + **1066 tests** — 1045 →
1066: 17 engine `snipe.test.ts` covering park/forced/no-op/mid-turn-KO/§14-win/
up-to/decline/wire-safety for Hawlucha and cost-pay/unmet/no-target/once-per-turn/
bench-use/mid-turn-KO for Meowscarada + purity, plus 2 DOM multi-select tests, 1
projection pass-through test and 1 log-row test). Production `vite build` green.
No live /play smoke this session (the representatives aren't demo-reachable and
NO demo deck / projection path changed — the demo boot is byte-identical to
slice 7's, which was live-smoked; the slice-6 precedent). Files: effects.ts,
interpreter.ts, flow.ts (settleProgram), triggers.ts, cardplay.ts (useAbility
cost + programPlayable + validateChoice), registry.ts, actions.ts, events.ts,
index.ts, testFixtures.ts, snipe.test.ts (new) + GameHud.tsx, logFromEvents.ts,
GameHud.cardplay.dom.test.tsx, projection.test.ts, logFromEvents.test.ts.

## M4 slice 9 as built (2026-07-19) — on-KO triggered Abilities (§8.1)

**Shape (D30).** Triggered Abilities that fire **"when this Pokémon is Knocked
Out"** — the last M4 timing, and the inverse of the slice-8 snipe (the KO fires
the trigger). It fires DURING the OPPONENT's turn, mid-KO-sweep, so a decision
must PAUSE the sweep and then RESUME it (the resume-the-tail continuation the
slice-6/8 deferral named). `TriggerTiming` gains **`"onKnockOut"`**; detection
lives in triggers.ts **`onKnockOutTrigger(state, uid)`** (via `cardIdByUid →
programFor`, valid AFTER the KO discarded the card — the id map is permanent),
but the KO sweep in flow.ts DRIVES it. Two forms on `TriggeredAbility`, split by
layer:

- **Coin-flip Prize GUARD** (`onKoPrizeGuard: "coinFlipPrevent"` — Glimmora
  "Shattering Crystal": flip; heads → the opponent takes NO Prize for it).
  Resolved **inline in the KO sweep**, NOT the interpreter (it modifies the KO's
  Prize, and "flow.ts owns every Knock Out; the interpreter never touches the
  tail" is the D23 invariant). New **`planPrizes`** (flow.ts) resolves every
  guard UP FRONT — before the §14 tie-guard speculation — threading rng once, so
  the speculation AND the real KO share the post-flip count (the tie guard stays
  EXACT) and the guard's own events (`ABILITY_TRIGGERED` → `ABILITY_COIN_FLIP` →
  `PRIZE_PREVENTED`) fire in the real KO loop AFTER that KO's `KNOCKED_OUT`. A
  heads guard queues no `takePrizes` stage — and, resolved before the §14 check,
  it can DENY a game-winning prize (the game continues).
- **Parking PROGRAM** — a general on-KO effect run as a new **`koTrigger`
  PendingStage** `{seat, uid}` (JSON-safe). `advance`'s `koTrigger` case pops it
  and calls **`runKoTrigger`**, which runs the program through the shared
  interpreter and folds through **`settleProgram` with a new `resumeTail` flag**:
  a decision PARKS on `effect:choose` (with `phase.seat` = the KO'd, NON-turn
  player) and, on `resolveEffect`, the DONE branch just keeps DRAINING the KO's
  queued prize/promotion tail (`advance`) instead of folding back to a turn.
  `resolveEffect` passes `resumeTail` back so a re-park mid-sweep stays a
  mid-sweep park.

**Ordering.** `collectKnockOuts` groups the batch **PRIZES-first, then
koTriggers, then promotions** (§8.1/§13 — all prizes taken before the board
refills; a "when Knocked Out" Ability resolves between). A §14 game-ending prize
(finishGame clears `pending`) skips the koTrigger program entirely. Fires from
all three KO callers (attack epilogue, Checkup, mid-turn `resolveMidTurnKnockOuts`)
since they all share `collectKnockOuts`. Behaviour-neutral for every Pokémon with
no on-KO Ability (planPrizes plans its face-value Prize, no flip, no koTrigger —
the whole prior suite passes unchanged).

**Representatives.** **Glimmora** (sv02-126, real — verified vs the local
catalog) for the guard, and **fix-onko** (a FIXTURE — "Last Wish" searches a
Basic → hand, which parks) for the resume-the-tail path, because no real SV-era
on-KO Ability requires a decision (Glimmora/Munkidori are a coin flip / a fixed
condition) — the fix-sniper demonstrator precedent. Neither is in the demo decks.

**Web.** The projection's `effect:choose` case reads the turn owner via
**`koParkActiveSeat`** when `resumeTail` (so `activeSeat` ≠ `waitingSeat` — the
KO'd non-turn player owes the decision mid-opponent-turn, exactly like the ko:*
parks; the device flips to them and back). The parked decision reuses the
existing `chooseCards` dialog (no new dialog). `logFromEvents` gains two rows
(`ABILITY_COIN_FLIP`, `PRIZE_PREVENTED`). engineVersion 0.10.0 → **0.11.0**.

**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no
HIGH/MED/LOW correctness bugs.** The engine agent enumerated the highest-risk
claim — the §14 tie guard × prize denial — over ALL FOUR coin-flip combinations
× 60 seeds and proved every win/tie/continue outcome exact (post-flip counts,
one rng advance, no speculation/reality disagreement), and probed the
resume-the-tail across all three KO callers (attack / checkup / mid-turn). The
web agent drove the non-attack park origins through the real engine to confirm
`koParkActiveSeat` names the right owner in each, the viewer-follow flips to the
KO'd player, the dialog dispatches `resolveEffect` for the KO'd player's seat,
and NO demo/`/play` regression (a non-`resumeTail` park is byte-identical). The
one engine LOW (a seed-fragile / misframed §14 test of mine) was fixed: it now
pins both guard branches (heads denies the win) and adds a deterministic fix-onko
test for §14 skipping the koTrigger PROGRAM. The one web INFO is the pre-existing
P4 hidden-info gap (the effect:choose prompt carries the actor's search
candidates), not a slice-9 defect.

**Verification.** `bun run check` green (tsc + biome + **1080 tests** — 1066 →
1080: 11 engine `onKnockOut.test.ts` covering the guard heads/tails + the
guard-denies-a-win branch, the checkup-KO scan point, the resume-the-tail park
(owned by the KO'd non-turn player) + its promotion drain, §14 skipping the
program, non-regression + purity; plus 1 projection pass-through, 1 log-row pair,
1 GameHud DOM test driving the KO'd player's on-KO dialog). Production `vite
build` green. No live /play smoke this session (the representatives aren't
demo-reachable and NO demo deck / projection path for existing cards changed —
the demo boot is byte-identical to slice 8's; the slice-6/8 precedent). Files:
flow.ts (planPrizes / settleProgram+resumeTail / runKoTrigger / advance),
registry.ts, triggers.ts, types.ts, events.ts, cardplay.ts, index.ts,
testFixtures.ts, onKnockOut.test.ts (new) + projection.ts, logFromEvents.ts and
their tests + GameHud.cardplay.dom.test.tsx.

## M5 coverage pass #1 as built (2026-07-19) — the existing-op harvest + the backlog

**Method.** A classify→verify **Workflow fan-out** (10 agents: 5 batches ×
classify + adversarial verify) over the **140 un-authored sv01–03**
Trainers (61) / Special Energies (4) / Pokémon Abilities (75), each judged
against the current op vocabulary with the deriver doctrine (exact map or flag).
Every authorable program was then hand-verified vs the local catalog.

**Result.** **5 authorable now**, 113 needs-op, 22 already-authored. Coverage is
**op-bound, not authoring-bound** (~4% of the un-authored pool is expressible
today), so the deliverable is BOTH the 5 landed cards AND the ranked
**new-op backlog** — `docs/reference/coverage-backlog.md` — which sequences the
next slices (`attachEnergyFrom` unlocks 11 cards, `discardPileRetrieval` 6,
`lookAtTopN`/`moveEnergy`/`conditionalPlay` 5 each, then a long tail that
collapses into a few parameterized ops).

**Landed (registry rows over the existing ops, id-verified, tested):** Poké Ball
(sv01-185 — `coinFlipGate → [searchDeck anyPokemon→hand, shuffleDeck]`), Pokémon
Catcher (sv01-187 — `coinFlipGate → [gust]`), Nemona (sv01-180 — `drawCards 3`),
Copperajah ex (sv02-150 — passive `damageReductionAfterWR: 30`), Stonjourner
(sv01-121 — passive `damageReductionAfterWR: 20`). The fan-out mis-placed Poké
Ball's `shuffleDeck` OUTSIDE the coin gate (a tails play would reorder the deck);
hand-fixed to inside the gate and pinned by a "tails → NO shuffle" test — the
reason authorable programs are hand-verified, not merged raw. Poké Ball / Catcher
are the FIRST Trainers to use `coinFlipGate`, so the `ATTACK_EFFECT_COIN_FLIP` log
copy was neutralized ("flipped X for the effect", not "…for the attack effect");
the event id keeps "ATTACK_" for back-compat (a rename is a later cleanup).

**No engine mechanism changed** — this pass only adds registry rows + fixtures +
one `coverage.test.ts` + the backlog doc, so no 2-agent slice review (the fan-out's
classify+verify already double-checked each program, and each landed card is
hand-verified + test-pinned). engineVersion unchanged (0.11.0 — additive data).
Suite 1080 → **1087** (7 coverage tests). `bun run check` + `vite build` green.

## M5 op-slice: attachEnergyFrom as built (2026-07-19) — the top backlog unlock

**Shape (D32).** The first new op built off the coverage backlog. **`attachEnergyFrom`**
(`{op, source:"hand"|"discard", energyType?}`, effects.ts) attaches ONE Basic
Energy from the controller's hand or discard pile onto a CHOSEN own in-play
Pokémon (§6 acceleration). The design simplification: same-type Basic Energy is
FUNGIBLE, so there is no "which energy" choice — the op picks the first match and
the ONLY decision is the TARGET, which reuses the existing `parkOrForce` →
`choosePokemon` prompt (interpreter.ts). It re-finds the first matching energy at
APPLY time (deterministic — while parked on effect:choose, only the controller's
`resolveEffect` is legal, so the source zone is frozen). A source with no matching
Basic Energy is a no-op, and **`programPlayable`** (cardplay.ts) blocks activating
an Ability whose attach could only whiff (the gust/snipe "no legal target"
precedent — the shared `firstAttachableEnergy` predicate, exported from
interpreter.ts). It is NOT the §6.3 one-per-turn manual attach — no allowance is
touched (it is the Ability's own effect); it reuses `ENERGY_ATTACHED` (host
resolved by the energy uid).

**Representatives** (verified vs the local catalog): **Quaquaval "Energy Carnival"**
(sv01-054 — any Basic from hand, `oncePerTurn:true`) and **Baxcalibur "Super Cold"**
(sv02-060/210 — a Basic {W} from hand, **REPEATABLE** `oncePerTurn:false`), plus a
FIXTURE **fix-attacher "Recharge"** (discard-source + type-filter — the clean real
discard cards Gardevoir/Koraidon carry riders that need later ops, the fix-onko
demonstrator precedent). New test surgery `discardFromDeck`.

**Web: UNCHANGED.** The op introduces no new EffectPrompt (reuses `choosePokemon`),
no new event (reuses `ENERGY_ATTACHED`), no new phase — so the slice-2 Ability
button + choosePokemon dialog + log row serve it as-is. A `oncePerTurn:false`
ability correctly stays an ENABLED button (the HUD only greys `oncePerTurn:true`
once used), and a no-energy activation is the D19 afford-then-reject.
engineVersion 0.11.0 → **0.12.0**.

**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no
HIGH/MED/LOW correctness bugs.** The engine agent proved (6 probes) no energy
duplication/loss (found-in / removed-from zones provably identical), the
fungibility re-pick safe (source frozen while parked), wire-safety (a hostile
opponent/out-of-range ref rejected, the string-index trap caught, no throw),
the ENERGY_ATTACHED contract (copied target, no allowance touched, emit-only),
discard order preserved, and purity. The web agent verified the "no web change"
reuse claim through the REAL GameHud/projection/log (7 probes): the repeatable
button never greys, the choosePokemon dialog dispatches a legal controller-seat
choice, the log row is source-agnostic, the projection keeps the viewer on the
controller, and no demo/`/play` regression. **One INFO (unreachable today):**
`programPlayable` runs BEFORE an ability cost is paid, so a future ability pairing
a `cost` with a hand-source attach whose only match is the cost card could pass
the gate then no-op (a wasted activation, never a corrupt state) — revisit when
the discard-with-rider variants land.

**Scope.** Single-attach only — authors **2 of the 11** `attachEnergyFrom`
backlog cards; the other 9 layer riders (multi / +counters / ends-turn / self-KO
/ deck-search / `lookAtTopN` / attach-to-self / special-energy-by-name) on this
primitive. **Verification:** `bun run check` green (tsc + biome + **1095 tests** —
1087 → 1095: 8 engine `attachEnergyFrom.test.ts`), production `vite build` green.
No live /play smoke (representatives not demo-reachable; NO web/projection path
changed — the demo boot is byte-identical). Files: effects.ts, interpreter.ts
(op + `firstAttachableEnergy`), cardplay.ts (programPlayable), registry.ts,
index.ts, testFixtures.ts (fixtures + ATTACH_DECK + discardFromDeck),
attachEnergyFrom.test.ts (new).

## M5 op-slice: attachEnergyFrom riders as built (2026-07-19) — Gardevoir ex

**Shape (D33).** The D32 attach op grows three composable RIDERS to author the
marquee **Gardevoir ex "Psychic Embrace"** (sv01-086/228/245): **`targetType`**
(eligible targets = the controller's own Pokémon whose TOP card is that type —
{P}); **`bonusCounters`** (put N HP of damage counters on the Pokémon just
attached to — 2 = 20, as `COUNTERS_PLACED` source "ability"); **`notIfKO`**
(exclude any target the bonusCounters would Knock Out — `damage + bonusCounters ≥
effectiveMaxHp`, the exact complement of the KO test, so the counters are ALWAYS
non-lethal and the op never KOs). The candidate filter is a new exported
**`attachEnergyTargets`** (interpreter.ts) shared by the park AND `programPlayable`
(which now also rejects when NO eligible target remains). Gardevoir's program:
`{attachEnergyFrom, source:"discard", energyType:"Psychic", targetType:"Psychic",
bonusCounters:20, notIfKO:true}`, `oncePerTurn:false` (repeatable).

**Web: UNCHANGED** — reuses choosePokemon + ENERGY_ATTACHED + the COUNTERS_PLACED
"ability" log row + the damage chip (the 2 self-counters render as damage).
engineVersion 0.12.0 → **0.13.0**.

**Review (2 Opus agents — engine+rules / web): BOTH CLEAN, no HIGH/MED bugs.**
The engine agent proved the notIfKO non-lethal guarantee AIRTIGHT — a basic-energy
attach cannot shift `damage`/`effectiveMaxHp` between park and apply (those read
only the top card + tools, never energy), the exclusion `≥` boundary matches the
KO test's, and `settleProgram`'s DONE sweep is a safety net regardless
(empirically: Gardevoir stops at exactly 15 uses / 300 damage, never KO'd) — plus
targetType/bonusCounters correctness, no base-op regression, wire-safety, purity.
The web agent verified the reuse claim through the real HUD (133 tests + probe):
the repeatable button never greys, the choosePokemon dialog dispatches a legal
controller-seat choice, the self-counters render (`battle.damage` 20 → chip), the
log reads sensibly, no soft-lock (a no-eligible-target Gardevoir rejects
`NO_LEGAL_TARGET` before parking an empty dialog), no demo regression. One LOW (a
stale COUNTERS_PLACED "ability" log comment — the render was correct) fixed.

**Scope.** Authors Gardevoir ex — **3 of the 11** attachEnergyFrom cards. The
other 8 still need multi-attach ("up to N in any way"), a deck-search source,
`lookAtTopN`, "your turn ends", self-KO, `onEvolve`, or special-energy-by-name.
**Verification:** `bun run check` green (tsc + biome + **1101 tests** — 1095 →
1101: 6 engine `psychicEmbrace.test.ts`), production `vite build` green. Files:
effects.ts, interpreter.ts (`attachEnergyTargets` + bonusCounters), cardplay.ts
(programPlayable), registry.ts, index.ts, testFixtures.ts, psychicEmbrace.test.ts
(new) + logFromEvents.ts (the one-line comment fix).

## M5 op-slice: attachEnergyFrom multi + endsTurn as built (2026-07-19) — Koraidon ex

**Shape (D34).** Authoring **Koraidon ex "Dino Cry"** (sv01-125/231/247/254 —
attach up to 2 Basic {F} from discard to your Basic {F} Pokémon in any way, then
your turn ends). Three ideas:
- **MULTI-attach needs NO new op** — "attach up to N in any way you like" is just
  **N `attachEnergyFrom` ops** in one program: the interpreter parks on each op's
  target in turn (independent target per energy), and a later op that finds no
  matching Energy no-ops, so the program attaches min(N, available). Koraidon's
  program is TWO attach ops. The "may attach fewer when more are available" is
  auto-maxed (the pure-upside auto-take doctrine).
- **`basicOnly`** — a target-filter rider (the target must be `isBasicPokemon`,
  combined with `targetType:"Fighting"` → "your Basic {F} Pokémon"), added to
  `attachEnergyTargets`.
- **`AbilityProgram.endsTurn`** — the Ability ENDS the controller's turn once its
  program completes. Folded by **`settleProgram`** (flow.ts): on DONE it seeds
  `turnTail(controller)` + advance (byte-for-byte the normal `endTurn` action),
  instead of returning to turn:action; threaded across re-parks by a new
  `endsTurn?: true` on the `effect:choose` Phase (parallel to `resumeTail`,
  mutually exclusive). The DONE+endsTurn branch skips the mid-turn KO sweep
  (Koraidon does not damage; the folded Checkup catches any KO regardless).

**Web: UNCHANGED** — the two sequential parks + the turn-end transition ride the
existing effect:choose/choosePokemon path + the viewer-follow (the device flips to
the opponent when the turn ends), exactly like the on-KO `resumeTail` re-park.
engineVersion 0.13.0 → **0.14.0**.

**Review (2 Opus agents — engine+rules / web): BOTH CLEAN, no HIGH/MED/LOW bugs.**
The engine agent proved the endsTurn fold consistent with the normal turn end
(same `advance(turnTail)` shape → no stale-phase leak; the flag survives both
re-parks and fires only on the final DONE), multi-attach via N ops has no
double-attach / no over-reject (op #2 re-finds energy on the post-op-#1 state),
`basicOnly` total (no throw on `types:null`/degenerate stack), and — as a bonus —
probed poison-KOs during the folded Checkup, which resolve correctly. The web
agent verified the reuse claim through the real web layer (133 tests + probe): the
`endsTurn` Phase field doesn't break the exhaustive switch, both parks report the
controller active/waiting, the turn-end flips the viewer to the opponent, the two
sequential parks re-render cleanly (stable dialog key, no stale state), no demo
regression. INFO only: a *damaging* endsTurn ability (none in scope) would resolve
its KOs via the Checkup sweep with a timing difference; no visual cue on the button
that Dino Cry ends the turn (by design — the HUD never previews side-effects).

**Scope.** Authors Koraidon ex — **4 of the 11** attachEnergyFrom cards. The other
7 still need a deck-search source (Forretress/Charizard/Geeta/Pawmot), `lookAtTopN`
(Electric Generator/Hydreigon), or per-card riders (self-KO, onEvolve, can't-attack,
attach-to-self, special-energy-by-name). **Verification:** `bun run check` green
(tsc + biome + **1106 tests** — 1101 → 1106: 5 engine `dinoCry.test.ts`),
production `vite build` green. Files: effects.ts (basicOnly), interpreter.ts
(`attachEnergyTargets` basicOnly), registry.ts (`AbilityProgram.endsTurn` +
Koraidon), types.ts (Phase endsTurn), flow.ts (settleProgram endsTurn fold),
cardplay.ts (thread endsTurn), index.ts, testFixtures.ts, dinoCry.test.ts (new).

## M5 op-slice: discardPileRetrieval as built (2026-07-20) — the recovery Items

**Shape (D35).** The next-biggest backlog unlock after `attachEnergyFrom` — and a
near-exact **mirror of the vetted `searchDeck` op**, but source = the DISCARD pile
and dest = hand or deck. **`discardPileRetrieval`** (`{op, filter:CardFilter,
dest:"hand"|"deck", max}`, effects.ts/interpreter.ts) retrieves up to `max` cards
matching `filter` from the controller's discard pile:
- Like searchDeck it is **"up to"** (declinable) and PARKS on the **same
  `chooseCards` prompt** — no new prompt/dialog. An empty match is a no-op; no
  bench-space clamp (hand/deck are uncapped), so `max` is used as printed.
- **`dest:"deck"`** appends to the deck end, so the printed "Shuffle … into your
  deck" is authored as **`[discardPileRetrieval(dest:deck), shuffleDeck]`** (the
  Nest Ball search-then-shuffle pattern). A whiffed Pal Pad/Super Rod therefore
  still shuffles — self-affecting only, never illegal, consistent with a whiffed
  search. **`dest:"hand"`** (Energy Retrieval) has no trailing shuffle.
- `retrieveMove` mirrors `searchMove` (dedup Set, only in-discard uids move,
  wire-checked by the existing `validateChoice`).

Two new **`CardFilter`** kinds — **`supporter`** (Trainer + trainerType
"Supporter") and **`pokemonOrBasicEnergy`** (category "Pokemon" OR a basic Energy
`energyType:"Normal"` — Special Energy excluded) — and one new event
**`DISCARD_RETRIEVED {seat, dest, uids}`** (count-only in the log; the discard pile
is public). Representatives (verified vs the local D1 catalog, all Items):
**Energy Retrieval** (sv01-171 — 2 Basic Energy → hand), **Pal Pad** (sv01-182 — 2
Supporters → deck), **Super Rod** (sv02-188/276 — 3 Pokémon/Basic Energy → deck).

**Web: a small honest touch (not "unchanged").** The shared `ChooseCardsDialog`'s
accessible label went **"Search your deck" → "Choose cards"** (it now serves both a
deck search and a discard retrieval; the accurate description rides `prompt.note`,
which reproduces the printed card text). The `chooseCards` prompt `dest` union
widened to include `"deck"` (inert at every consumer — the dialog never reads
`dest`), and `logFromEvents` gained one `DISCARD_RETRIEVED` row. engineVersion
0.14.0 → **0.15.0**.

**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no HIGH/MED
correctness bugs.** The engine agent proved card conservation (symmetric
remove/append, no clamp needed for the uncapped zones), filter semantics (Special
Energy + Trainers correctly excluded), the park/resume flow with **no deck-order
leak** (the park is BEFORE the move, and the trailing `shuffleDeck` runs
synchronously in the resume batch — no window, never dropped), self-reference
safety, and flow-tail safety (never damages/KOs). The web agent proved no
hidden-info leak (count-only log, both discard piles public in the projection) and
that the `dest` widening is inert at every consumer. **Fixes applied:** one MED —
the purity test was freezing the PRE-park state and never reaching `retrieveMove`
(the actual mutation runs during the later `resolveEffect`), so it was strengthened
to freeze the parked state and drive the resolve; LOWs — pinned the `retrieveNote`
strings and added the Super Rod degenerate-ends (only-Pokémon / only-Energy) and a
take-none-with-trailing-shuffle case. **Forward-looking hazard documented (not
triggered):** `playTrainer` discards the played card up front, so a FUTURE
self-matching card (a Supporter authored on this op with `filter:supporter`) would
offer itself as a candidate — flagged in the op's authoring note; the 3 Items here
are all safe (no filter matches an Item).

**Scope.** Authors 3 of the 6 `discardPileRetrieval` backlog cards. The other 3
need `discardFromHandCost` (Superior Energy Retrieval), a conditional draw (Miriam —
"if you shuffled any, draw 3"), or an Ability (Pelipper). **Verification:** `bun run
check` green (tsc + biome + **1117 tests** — 1106 → 1117: 11 engine
`discardRetrieval.test.ts`), production `vite build` green. Files: effects.ts (op +
2 filter kinds), interpreter.ts (stepOp/applyChoice cases, `retrieveMove`,
`matchesFilter` + `searchNote` guard, `retrieveNote`/`retrieveNoun`, widened
`chooseCards` dest), events.ts (`DISCARD_RETRIEVED`), registry.ts (3 programs +
rows), index.ts, testFixtures.ts (3 Item fixtures + `DISCARD_RETRIEVAL_DECK`),
discardRetrieval.test.ts (new); web: GameHud.tsx (label), logFromEvents.ts (row),
GameHud.cardplay.dom.test.tsx (2 assertions).

## M5 op-slice: lookAtTopN as built (2026-07-20) — Great Ball / Pokégear 3.0

**Shape (D36).** The top-of-deck twin of `searchDeck`: **`lookAtTopN`** (`{op, n,
filter:CardFilter, max}`, effects.ts/interpreter.ts) looks at the top `n` cards of
the controller's deck (index 0 = the top, per `drawToHand`) and puts up to `max`
matching `filter` into their HAND:
- Like searchDeck it is **"up to"** (declinable) and PARKS on the **same
  `chooseCards` prompt** — no new prompt/dialog. But the candidates are ONLY the
  `filter` matches among the **top `n`**, in deck order — never a deeper card. An
  empty top-`n` match is a no-op.
- **Wire-safety is free:** the candidate set is the top-`n` matches, and
  `resolveEffect`/`validateChoice` already rejects any pick not in the candidate
  set (`BAD_EFFECT_CHOICE`), so a client cannot reach past the window. `revealFromTop`
  (the deck→hand mover, mirroring `searchMove`/`retrieveMove`) keeps the
  `deck.includes` secondary guard.
- "Shuffle the other cards back into your deck" is **NOT part of the op** — it is
  the trailing **`shuffleDeck`** op in the authored program (the Nest Ball
  search-then-shuffle pattern), so a whiff OR a decline (take none) still shuffles.
- **No new `CardFilter`** (Great Ball reuses `anyPokemon`, Pokégear reuses the
  `supporter` filter added with Pal Pad in D35); **no `programPlayable` gate** (a
  look-at-top is always playable — you look and shuffle even on a guaranteed whiff).

One new event **`DECK_TOP_REVEALED {seat, uids}`** (count-only in the log — honest
"looked at the top of their deck" rather than DECK_SEARCHED's "searched"; the taken
cards are revealed/public per the printed "reveal", and the non-taken looked-at
cards never enter any event). Representatives (verified vs the local D1 catalog,
both Items): **Great Ball** (sv02-183 — top 7, reveal a Pokémon → hand),
**Pokégear 3.0** (sv01-186 — top 7, reveal a Supporter → hand).

**Web: one log row, nothing else.** The shared origin-agnostic `ChooseCardsDialog`
(relabeled "Choose cards" in D35) renders the accurate `prompt.note` ("Look at the
top 7 cards of your deck and put a Pokémon into your hand." / "…a Supporter card
into your hand."); the projection forwards the `chooseCards`/`dest:"hand"` prompt
with no change (nothing switches on `dest`). engineVersion 0.15.0 → **0.16.0**.

**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no HIGH/MED
correctness bugs.** The engine agent (8-test suite + a 22-assertion probe) proved
card conservation (symmetric deck→hand move + the shuffle permutation), candidate
correctness = **exactly the top-`n` matches** (the window boundary pinned: a match
at index 6 IS a candidate, one at index 7 is NOT; a shallow deck with `n` > length
and `n ≤ 0` both handled by `slice`/`Math.max(0,n)` with no over-read), wire-safety
(a deeper / duplicate / over-max / non-string pick all rejected), shuffle-always-
fires (the trailing op lives in the continuation `rest`), no flow-tail/KO
interaction, and purity (the freeze reaches `revealFromTop`). The web agent proved
log honesty + count-only + correct hot-seat seat attribution, the projection
"unchanged" claim (no `dest` switch, the event handled in the one web event
switch), the dialog serves the note, and no demo regression. **No code fixes
required.** **INFO (both agents, PRE-EXISTING P4 deferral — not this slice):** the
parked `chooseCards` prompt carries the top-`n` candidate uids unredacted
per-viewer — identical to `searchDeck`/`discardPileRetrieval`, unobservable in the
local hot-seat (the dialog renders only for the acting viewer), and exactly what
P4's server filter must redact for the non-acting viewer. A second INFO: `revealFromTop`
does not dedup its input before the hand-append — unreachable via the public API
(validateChoice rejects duplicates first) and the identical contract as the vetted
`searchMove`/`retrieveMove`, kept consistent rather than singled out.

**Scope.** Authors 2 of the op's 5 backlog cards. The other 3 need MORE: **Electric
Generator** (sv01-170) and **Hydreigon** (sv02-140) attach the found Energy — a
from-the-top **attach** variant (lookAtTopN + a bench-attach-from-revealed) that
ALSO unblocks 2 of the remaining `attachEnergyFrom` cards; **Malamar** (sv03-138)
peeks at the OPPONENT's deck top (a distinct info-only op). **Verification:** `bun
run check` green (tsc + biome + **1126 tests** — 1117 → 1126: 8 engine
`lookAtTopN.test.ts` + 1 `logFromEvents.test.ts`), production `vite build` green.
Files: effects.ts (op), interpreter.ts (stepOp/applyChoice cases, `revealFromTop`,
`lookNote`), events.ts (`DECK_TOP_REVEALED`), registry.ts (2 programs + rows),
index.ts, testFixtures.ts (2 Item fixtures + `LOOK_AT_TOP_DECK` + the `toDeckTop`
surgery), lookAtTopN.test.ts (new); web: logFromEvents.ts (row), logFromEvents.test.ts (row).

## M5 op-slice: moveEnergy as built (2026-07-20) — Energy Switch / Poppy

**Shape (D37).** Move Energy between your own Pokémon: **`moveEnergy`** (`{op,
filter:CardFilter, max}`, effects.ts/interpreter.ts) moves up to `max` Energy from
ONE of the controller's own in-play Pokémon to ANOTHER of their own in-play Pokémon.
This is the interpreter's **first op with two COUPLED decisions** — which Energy AND
where — so it parks differently from every op before it:
- A **new compound prompt** `moveEnergy` carries `movable` (each takeable Energy uid
  tagged with its source `PokemonRef`) + `destinations` (all own in-play refs) +
  `max` + `note`; the **new choice** `{kind:"moveEnergy", uids, dest}` answers both
  at once. It applies **ATOMICALLY** on resolve (`moveEnergyApply`: strip the picked
  uids off their source, append to the destination in one `withSide`) — a half-moved
  Energy (detached but not re-attached) is never a resting state, so the move never
  splits across two parks. This is why it is one compound park, not two sequential
  ones (the two-park shape has no place to thread the first pick, and would leak a
  floating-Energy intermediate).
- **"Up to"/declinable** like searchDeck (the player may move none → a legal empty
  pick). It ALWAYS parks when playable (never auto-resolves even when the source is
  forced), matching the searchDeck/lookAtTopN "you may" family rather than the
  parkOrForce targeting family.
- **`validateChoice` (cardplay.ts)** enforces every coupling the compound decision
  needs: each uid is an offered `movable` (distinct, non-string rejected), all picks
  share ONE source Pokémon (the printed "from 1 of your Pokémon"), the dest is an
  offered ref, and **dest ≠ source** (no moving a Pokémon's Energy onto itself). So a
  crafted P4 wire payload cannot apply an illegal move.
- **`moveEnergyApply` conserves cards:** each picked uid is removed from exactly one
  non-destination Pokémon and appended once to the destination (the dest is never
  stripped → no self-move / duplication; a stale or dest-resident uid is skipped, not
  duplicated). The re-attach reads off the STRIPPED board. Pure like
  `searchMove`/`retrieveMove` (copy, never splice; the freeze test reaches the move).
- **`programPlayable` gate** (`moveEnergyPlayable`): playable iff ≥1 Energy the filter
  admits AND **≥2 of your Pokémon in play** (a source with a distinct destination) —
  the EXACT complement of `stepOp`'s no-op condition, so a gated card is never wasted
  and a playable card always parks (no silent no-op, no soft-lock — ≥2 Pokémon
  guarantees a legal source≠dest pair).

One new `CardFilter` kind **`anyEnergy`** (Basic OR Special — Poppy moves "up to 2
Energy", either kind; Energy Switch stays `basicEnergy`). One new event
**`ENERGY_MOVED {seat, uids, from, to}`** (`from`/`to` are `PokemonTarget` copies;
the Pokémon stay put — no bench compaction — so both resolve against the post-state).
Representatives (verified vs the local D1 catalog): **Energy Switch** (sv01-173, Item
— a Basic Energy, max 1), **Poppy** (sv03-193/220/227, Supporter — up to 2 any
Energy, max 2).

**Web: a new dialog + a log row.** `MoveEnergyDialog` (GameHud.tsx) is a staged pick
like Rare Candy: choose the source Pokémon (auto-selected when only one holds movable
Energy), then its Energy (up to `max`) and a distinct destination, then Confirm — or
**Move none** to decline (dispatches an empty pick with any offered dest, which the
engine accepts). The dialog can only ever dispatch a choice `validateChoice` accepts
(dest drawn from destinations-minus-source; picks capped at `max` and all from the
one selected source). New `ENERGY_MOVED` log row ("moved N energy from X to Y").
engineVersion 0.16.0 → **0.17.0**.

**Hidden information: this prompt leaks NOTHING.** Unlike `searchDeck`/`lookAtTopN`
(whose parked prompt carries deck-order candidate uids — the standing P4 redaction
INFO), `moveEnergy`'s `movable`/`destinations` are entirely the controller's OWN
in-play Energy and Pokémon, which are already **public, face-up table facts**. So
there is no new leak class here, and — uniquely among the parking ops so far — no P4
redaction is even needed for this prompt.

**Review (adversarial — engine+rules + web+integration passes, plus an independent
Opus pass): CLEAN, no HIGH/MED bugs.** Verified: card conservation under
dest==source / dest-resident pick / stale uid / two-source pick / bench-index shift
(strip-then-reattach, dest never stripped); `validateChoice` rejects every illegal
wire payload (opponent energy, dest==source, non-string/duplicate uid, >max,
two-source); the gate ⇔ no-op equivalence (no wasted card, no soft-lock); purity;
rules accuracy (Poppy moves Special too, Energy Switch basic-only, same-source
enforced, no §6.3 attach-allowance touched); and that the dialog can never dispatch a
rejected choice. The one action taken was closing a **DOM coverage gap** — the
auto-selected single-source path was tested, but the **multi-source source-picker
stage** (and its Back/reset) was not, so a two-source Poppy DOM test was added. **INFO
(not a bug):** Energy Switch's text is not "you may", so allowing a decline is a
minor, documented deviation (harmless — the player simply wouldn't play the card),
consistent with the codebase's "up to"/declinable doctrine for the search family.

**Scope.** Authors 2 of the op's 5 backlog cards (own→own). The other 3 need MORE ops
layered on this primitive: **Armarouge** "Fire Off" (a {R} Energy from a BENCHED
Pokémon to the ACTIVE — fixed-endpoint + provided-type-filter riders, an Ability),
**Mismagius** "Magical Flick" (moves the OPPONENT's Energy on evolve — opponent-side
targeting + an onEvolve trigger), **Exp. Share** (an on-KO Tool trigger that moves a
Basic Energy off the KO'd Pokémon — needs Tool triggered-abilities). **Verification:**
`bun run check` green (tsc + biome + **1146 tests** — 1126 → 1146: 16 engine
`moveEnergy.test.ts` + 1 `logFromEvents.test.ts` + 3 `GameHud.cardplay.dom.test.tsx`),
production `vite build` green. Files: effects.ts (op + `anyEnergy` filter),
interpreter.ts (prompt/choice kinds, stepOp/applyChoice cases, `moveEnergyApply`,
`movableEnergies`, `moveEnergyPlayable`, `moveNote`, `matchesFilter`/`retrieveNoun`
for `anyEnergy`), events.ts (`ENERGY_MOVED`), cardplay.ts (`validateChoice` case +
`programPlayable` gate), registry.ts (2 programs + 4 rows), index.ts, testFixtures.ts
(2 Trainer fixtures + `MOVE_ENERGY_DECK` + the `attachBenchFromDeck` surgery),
moveEnergy.test.ts (new); web: GameHud.tsx (`MoveEnergyDialog` + branch),
logFromEvents.ts (row) + its test, GameHud.cardplay.dom.test.tsx (3 dialog tests).

## M5 op-slice: handRefresh as built (2026-07-20) — Youngster / Judge / Brassius / Katy

**Shape (D38).** The Iono/Judge/Marnie hand-refresh Supporter family: **shuffle
your hand into your deck, then draw**. New op **`handRefresh`** (`{op, who:"you"|
"both", draw:HandRefreshDraw}`, effects.ts/interpreter.ts). It is the FIRST op in a
new class — a **fully-automatic op** (no decision → it NEVER parks, like drawCards /
discardHand / shuffleDeck) that can affect the **opponent** (Judge). Per affected
seat, in a fixed order (the controller first, then — for `who:"both"` — the
opponent), it: captures the PRE-shuffle hand size, moves the whole hand into the
deck, shuffles the combined pile (`shuffle([...deck, ...hand])` — one rng advance;
append-then-shuffle equals "shuffle into"), then draws (a constant, or the captured
hand size + delta):
- **`draw: {kind:"fixed", count}`** — Youngster 5, Judge 4, Katy 8.
- **`draw: {kind:"handPlus", delta}`** — Brassius "draw that many cards plus 1"
  (delta 1): draws `handCount + 1` off the PRE-shuffle hand, so the hand returns to
  its pre-play size (net +1 vs after the Supporter left the hand).
- **`who: "both"`** (Judge) is the **first op to reach the OPPONENT's hand/deck** —
  each player shuffles-and-draws independently.

**Card conservation + rng.** Per seat the op is a pure multiset move: `combined =
[...deck, ...hand]`, `hand:[]`, then `drawToHand` slices `combined` into (top
`drawCount` → hand, rest → deck) — total per side invariant under empty hand / empty
deck / hand==whole-deck / both-empty (all guarded, no over-read, no crash). The
Supporter itself is discarded UP FRONT by `playTrainer` (before the program runs),
so it is never shuffled back. `rngState` is read fresh each iteration and written
back inside `next`, so `who:"both"` threads controller-shuffle then opponent-shuffle
with no stale reuse and no dropped advance (reuses rng.ts's single vetted
Fisher–Yates). Always playable (no `programPlayable` gate — you may always
shuffle-and-draw, even from an empty hand); never parks; never damages/KOs.

**Katy "your turn ends" — the endsTurn fold reaches the Trainer path.** New
CardProgram flag **`trainerEndsTurn?: true`** (parallel to the Rare Candy `rareCandy`
flag); `playTrainer` reads it and passes `{ endsTurn }` to `settleProgram`, which
folds it **byte-for-byte like `AbilityProgram.endsTurn`** (the D34 Koraidon
precedent): on DONE it seeds `turnTail(controller)` and advances instead of returning
to `turn:action`. handRefresh never parks, so Katy hits the DONE+endsTurn branch
directly. Every non-Katy trainer passes `endsTurn:false`, and `settleProgram(...,
{endsTurn:false})` is byte-identical to the old no-opts call (both branches gate on
`=== true`) — no regression. This also **closes the `endTurn` backlog row** (Katy
joins Koraidon).

One new event **`HAND_SHUFFLED_INTO_DECK {seat, count}`** — **count-only** (a
shuffled hand card is hidden). The deck reorder is intrinsic (no separate `SHUFFLE`
event: no engine-state consumer depends on `SHUFFLE`, and there is no persistent
known-deck-top in GameState for the reshuffle to invalidate). Representatives
(verified vs the local D1 catalog, all Supporters): **Youngster** (sv01-198, draw 5),
**Judge** (sv01-176, both draw 4), **Brassius** (sv03-187, draw hand+1), **Katy**
(sv01-177/237, draw 8 + turn ends).

**Web: one log row, nothing else.** handRefresh never parks, so there is NO new
`EffectPrompt`/dialog — GameHud is untouched. `logFromEvents` gains one count-only
`HAND_SHUFFLED_INTO_DECK` row ("shuffled their hand (N cards) into their deck"); the
draw rides the existing count-only `CARDS_DRAWN` row. engineVersion 0.17.0 →
**0.18.0**.

**Hidden information (Judge — the first op to touch the opponent's hand): leaks
NOTHING new.** The opponent's `CARDS_DRAWN {seat, uids}` carries their drawn uids —
but this is the **standard `drawToHand` contract used by every draw** (turn-start,
search), not a new leak. Both consumer boundaries are safe: the log's `CARDS_DRAWN`
arm and `HAND_SHUFFLED_INTO_DECK` are both count-only, and the per-viewer projection
already redacts the opponent's hand to uid-less `hiddenHand` backs (`opponent-hand-N`,
`cardId:"hidden"`). Katy's turn-end needs no web change either — it rides the
existing phase→seat viewer-follow (the device flips to the opponent on `turn:action`),
exactly like a normal `endTurn`.

**Review (adversarial — engine+rules + web+integration passes): BOTH CLEAN, no
HIGH/MED, NO code fixes.** The engine agent proved card conservation over all four
degenerate zone states, correct rng threading for the two-shuffle Judge, the handPlus
timing (no off-by-one), the Katy endsTurn fold consistent with the Koraidon precedent
(full 374-test engine suite incl. Koraidon passes — no regression), purity against a
recursive freeze, and all four texts byte-matching the catalog (no missed reprint —
Katy's sv01-237 IS mapped; Iono/Marnie correctly deferred). The web agent proved the
Judge hidden-info safe on BOTH the log and projection paths, that no exhaustive web
switch breaks on the new event (the one `satisfies never` is over the Phase union,
and Katy adds no phase), and that Katy's turn-end needs no web handling. **INFO (both,
not bugs):** an empty hand emits `count:0` ("shuffled their hand (0 cards)…") — honest
and non-leaky, the `HAND_DISCARDED "(0 cards)"` precedent; and the no-separate-SHUFFLE
choice is cosmetic with no downstream consumer.

**Scope.** Authors 4 complete Supporters — the whole `shuffleHandIntoDeck` backlog row
(Youngster / Brassius / Katy) **plus Judge** (the both-player refresh), and closes the
`endTurn` row (Katy). The related disruptors layer MORE on this primitive:
**Iono/Marnie** put the hand on the BOTTOM of the deck (not shuffle) and draw by Prize
count / an asymmetric split — a `drawSpec:"prizeCount"` + a bottom-of-deck move.
**Verification:** `bun run check` green (tsc + biome + **1156 tests** — 1146 → 1156:
9 engine `handRefresh.test.ts` + 1 `logFromEvents.test.ts`), production `vite build`
green. Files: effects.ts (op + `HandRefreshDraw`), interpreter.ts (stepOp case +
`handRefresh`), events.ts (`HAND_SHUFFLED_INTO_DECK`), registry.ts (`trainerEndsTurn`
field + 4 programs + 5 rows), cardplay.ts (`playTrainer` passes `endsTurn`), index.ts
(0.18.0), testFixtures.ts (4 Supporter fixtures + `HAND_REFRESH_DECK`),
handRefresh.test.ts (new); web: logFromEvents.ts (row) + its test.

## M5 op-slice: handRefresh riders as built (2026-07-21) — Iono (family closed)

**Shape (D39).** **Iono** (sv02-185 + reprints sv02-254/269) — "Each player shuffles
their hand and puts it on the bottom of their deck. If either player put any cards on
the bottom of their deck in this way, each player draws a card for each of their
remaining Prize cards." — is three composable riders on the D38 `handRefresh` op, no
new op:
- **`toBottom?: true`** — the **placement**. Default (D38) shuffles the hand INTO the
  deck (`shuffle([...deck, ...hand])`, the deck's order destroyed). With `toBottom` the
  **HAND ALONE** is shuffled and appended UNDER the deck (`[...deck, ...shuffle(hand)]`),
  so the deck's existing order — and therefore the very next draws — **survive**. That
  is the whole strategic difference between Iono and Judge, and it is pinned by a test
  asserting the drawn cards are EXACTLY the pre-play deck top, in order.
- **`draw: {kind:"prizeCount"}`** — each affected player draws their OWN remaining
  Prize count (so the player behind on Prizes draws more). A Prize count is public, so
  the draw size leaks nothing.
- **`onlyIfAnyMoved?: true`** — the draw clause happens only if ≥1 affected player
  actually moved ≥1 card; with every affected hand empty, NOBODY draws. It is an
  **all-or-nothing gate across the seats** ("if EITHER player…"), not a per-seat one.

**The two-pass restructure.** That cross-seat gate is why `handRefresh` now runs **two
passes** over the affected seats (all placements, then all draws) instead of D38's
interleaved move-then-draw per seat. Behaviour-preserving for Youngster / Judge /
Brassius / Katy: the zones are per-seat disjoint and `drawToHand` consumes NO rng, so
final states and rng threading are byte-identical; the only change is Judge's event
INTERLEAVING (SHUFFLED p1, SHUFFLED p2, DRAWN p1, DRAWN p2 — which also reads truer to
"each player shuffles … and draws"). Per-type order (controller first) is unchanged.

**Rng.** `shuffle` consumes no randomness for a length ≤ 1 input, so an Iono played
into two empty hands advances the rng ZERO times and reorders nothing — the correct
"nothing happened" state. The played Supporter is discarded UP FRONT by `playTrainer`,
so it is never one of the cards put on the bottom (and cannot open the gate by itself).

One new event **`HAND_TO_BOTTOM_OF_DECK {seat, count}`** — count-only like its sibling,
but a **distinct** event because the public fact is different: the deck's order is
untouched, which both players can see and must be able to read off the log. `count: 0`
is emitted honestly (the `HAND_DISCARDED "(0 cards)"` precedent).

**Web: one log row, nothing else.** The op still never parks → no dialog, no prompt, no
projection change. `logFromEvents` gains "put their hand (N cards) on the bottom of
their deck". engineVersion 0.18.0 → **0.19.0**.

**Deliberate deviation: the empty-hands no-op stays legal.** Iono played when EVERY
affected hand is empty moves nothing, draws nothing and consumes no rng — a total
no-op — and is still a **legal play** (no `programPlayable` gate), unlike every other
could-only-whiff op (gust / switchActive / attachEnergyFrom / moveEnergy). Kept on
purpose: the digital clients allow it; it is self-inflicted, cannot soft-lock, and
only burns the player's own Supporter-per-turn allowance; and gating it would have to
reach into "playTrainer discards the played card up front" (the controller's hand
still holds Iono when the gate runs) — the leaky coupling D35 flagged. See D39.

**Review (adversarial — engine+rules + web+integration): no HIGH; 2 MED, both fixed.**
The engine agent found its MED by **mutation testing**: deleting the hand shuffle left
all 379 engine tests green, because every bottom-of-deck assertion was order-insensitive
and nothing in the repo asserted `rngState`. Fixed with two assertions — the bottomed
cards are NOT in hand order (measured stable across 12 seeds), and the both-empty play
leaves `rngState` untouched — and the mutant re-run now fails, as does the "hand to the
top instead of the bottom" one. (Mutants for the gate's `every`-vs-`some`, a per-seat
gate, and a `prizeCount` reading the opponent's prizes were each already caught by one
test.) The web agent's MED — raised independently by BOTH agents — was the log copy:
the row said only "put their hand … on the bottom", which against its sibling row reads
as "Iono does not shuffle", so a player who had seen that hand would think the deck's
tail was known; it now says both verbs. LOWs applied: an Iono degenerate-deck test
(deck shallower than the Prize count short-draws and does NOT deck out — §14.3 is a
turn-START rule), the describe-title rename, and a real end-to-end log test pinning the
5-row grouped batch (the two-pass restructure was otherwise unpinned on the web side).
Verified clean: card conservation over every degenerate zone combination on both sides,
exact rng advance counts (`(h1−1)+(h2−1)`), "Iono itself is never bottomed", the
projection serializing zero opponent uids, no exhaustive-switch fall-through, HUD
playability (enabled turn 2, §4-blocked turn 1, no prompt path reachable), and no demo
regression.

**Scope.** Iono **closes the hand-refresh family** — the SV-era catalog (sv01–sv03)
holds no Marnie, so the `shuffleHandIntoDeck` backlog row is fully done. The remaining
bottom-of-deck cards need OTHER ops, not this one: **Dendra** (choose a card from hand
→ bottom + `drawUntilHandSize` + a can't-play gate), **Ortega** (reveal the opponent's
hand + choose from it). **Miriam**'s "if you shuffled any cards into your deck in this
way, draw 3" is the same *conditional* idea as `onlyIfAnyMoved` but BETWEEN ops (and
across a park), so it stays deferred — it needs an op-result thread through the
interpreter, not a flag.

**Verification.** `bun run check` green (tsc + biome + **1164 tests** — 1156 → 1164:
6 engine `handRefresh.test.ts` + 2 `logFromEvents.test.ts`), production `vite build`
green. Files: effects.ts (the two riders + `prizeCount` + the authoring note),
interpreter.ts (the two-pass `handRefresh` + `handRefreshDrawCount`), events.ts
(`HAND_TO_BOTTOM_OF_DECK`), registry.ts (`IONO` + 3 rows), index.ts (0.19.0),
testFixtures.ts (the Iono catalog row + `HAND_REFRESH_DECK`), handRefresh.test.ts;
web: logFromEvents.ts (row) + its test.

**Carried forward (pre-existing, surfaced by this review — NOT this slice).** Every
authored Supporter (Iono, Judge, Katy, Youngster, Professor's Research) carries
`legal_standard=0` in the local ingest, so none of them surface in the deck builder's
default standard-legal search — worth a look when the builder meets the simulator.
And `GameLog` announces only the LAST entry to screen readers, so Iono's 5-row batch
(like Judge's and any KO sweep) is mostly silent — a P5 polish item.

## M5 op-slice: board conditions as built (2026-07-21) — Fighting Au Lait / Falkner / Grusha

The `conditionalPlay` backlog family, built as **one primitive with two
consumers** instead of a per-card flag. engineVersion 0.19.0 → **0.20.0**.

### The vocabulary — `BoardCondition` (effects.ts)
A tiny predicate union evaluated for ONE seat, with a single evaluator
`conditionHolds(state, seat, cond)` and a printed-text describer
`conditionNote(cond)` (both interpreter.ts, both exported):

| kind | reads | printed as |
|---|---|---|
| `morePrizesThanOpponent` | strict `>` on the two prize counts | "you have more Prize cards remaining than your opponent" |
| `yourStadiumInPlay` | `state.stadium.owner === seat` | "you have a Stadium in play" |
| `noEnergyOnYourPokemon` | Active **and** Bench, Basic or Special | "none of your Pokémon have any Energy attached" |

**The invariant that makes the whole design work: every member reads only PUBLIC
state.** Prize COUNTS, the Stadium zone's owner and face-up Energy are all facts
both players can read off the table — which is why **a gate emits no event**.
Contrast `coinFlipGate`: a flip IS new information, so it must be announced. A
board condition is not, and the branch's own ops emit whatever actually happened.
Keep it that way — a condition over hidden state (a hand's CONTENTS, a deck)
would leak through the gate.

**`yourStadiumInPlay` is OWNERSHIP, not presence.** This was the slice's
highest-risk rules call and it was verified against the Japanese printing of
ハヤト (Falkner, Triplet Beat): 「場に**自分の**スタジアムが出ているなら」 — "if
**your** Stadium is out on the field". Bulbapedia's Stadium article corroborates
that the distinction is real ("Some cards even check if their owner has a Stadium
in play, ignoring the presence of a Stadium played by the opponent"). An
opponent's Beach Court must NOT grant Falkner's +2. `state.stadium` is written in
exactly two places (setup → `null`, `playStadium` → `{uid, owner}`) and never
re-owned, so `owner` cannot go stale.

### Consumer A — the printed PLAY GATE (`CardProgram.trainerPlayableIf`)
`playTrainer` checks it **before the card leaves hand**, rejecting with a new
`ErrorCode` `PLAY_CONDITION_NOT_MET`, so a failed gate costs the player nothing.

This is categorically distinct from `programPlayable`'s would-only-whiff
heuristics: `trainerPlayableIf` is a rule **printed on the card**;
`programPlayable` is the engine's judgement about ops that would do nothing.

**Named `trainer…` on purpose.** It is honoured on EXACTLY one path —
playTrainer's Item/Supporter branch. `playStadium`, the `rareCandy` action,
`attachTool` and `useAbility` all return before it and would ignore it
**silently**. So an Ability-level gate (Luxray's "if you have more Prize cards
remaining", which also needs an in-hand Ability surface this engine does not
have) must NOT be authored here — it needs its own check on `useAbility`, sharing
the same `conditionHolds`. Same scoping, same reason, as `trainerEndsTurn` (D38).

### Consumer B — the mid-program branch (the `conditionGate` op)
`{op: "conditionGate", cond, then, otherwise?}`, spliced into runProgram's work
queue **exactly like `coinFlipGate`** — so an op inside a branch can still park,
and a branch may hold further gates. Three properties, all now pinned by
`fix-gateorder`:

1. `cond` is evaluated against the board **as of the gate** (`next`, not the
   program's entry state);
2. an arm's ops are spliced to the **front** of the queue;
3. the ops **after** the gate survive the splice.

One-armed is the common shape; `otherwise` exists for the printed "…**instead**",
which is a genuine if/ELSE.

### The one new op — `drawUntilHandSize`
Fully automatic. It **draws to a floor and never trims a bigger hand** — "draw
until you have 5" with 8 in hand does nothing at all. At a count ≤ 0 it no-ops
with **no event**, so a topped-up hand leaves no misleading "drew 0 cards" row.

### Cards landed (verified vs the local D1 catalog)
| Card | ids | Program |
|---|---|---|
| Fighting Au Lait | sv02-181 | `trainerPlayableIf: morePrizesThanOpponent` + `[healChosen 60]` |
| Falkner | sv02-180, 251 | `[drawCards 2, conditionGate(yourStadiumInPlay) → [drawCards 2]]` |
| Grusha | sv02-184, 253, 268 | `[conditionGate(noEnergyOnYourPokemon) → [drawUntilHandSize 7] else [drawUntilHandSize 5]]` |

Falkner is **two draw ops, not one computed count**, so the log shows the card's
two printed draw instructions separately. Grusha's "instead" is authored as the
`otherwise` arm rather than two sequential draws, and its hand count is measured
**after** the Supporter is discarded up front — which is the paper ruling for the
hand-size Supporter family (Cynthia's Ambition / Bianca).

### Web — zero new events, prompts, dialogs or projection fields
The only change: the HUD greys out a gated Trainer using the engine's own
`conditionHolds`, and carries `conditionNote` as the row's `title` plus an
`sr-only` line. That copy is load-bearing — **disabling the button removes the
reject pill that used to explain the printed rule**, and that rule is text the
HUD never shows. The reason sits OUTSIDE the button so it does not join the
button's accessible name.

**Recorded deviation (deliberate):** the HUD greys out a printed
`trainerPlayableIf` gate while `programPlayable`'s whiff gates (Boss's Orders into
an empty Bench) stay live and explain themselves via the reject pill. The mixed
standard is intentional — a rule printed on the card is knowable before clicking,
an engine whiff-judgement is not — and the tooltip is what keeps it coherent
rather than a silent grey row.

### P4 items this slice surfaced (recorded, NOT fixed)
- **`conditionHolds` takes a `GameState`, so only a raw-state host can run it.**
  The projection does **not** carry `stadium.owner` (the Stadium projects as a
  bare `CardModel`) and redacts the prize arrays to `prizesRemaining` counts. So
  the online client cannot evaluate these as written.
- **The sharp edge:** a redacted prize array still has a `.length`. If the HUD's
  `morePrizesThanOpponent` read shipped online unchanged against a filter that
  empties the array, it would compute `6 > 0 === true`, ENABLE the card, and the
  server would reject — **failing silently rather than loudly**, with no type
  error to catch it. Closing this means either a projection-shaped evaluator plus
  a `stadium.owner`/`mine` field, or routing the HUD read through
  `projection.board.{you,opponent}.prizesRemaining`.

### Carried forward (pre-existing, not this slice)
- **Fighting Au Lait is playable with nothing damaged anywhere** — the Potion
  shape (`programPlayable` treats heal as "playable enough"). The card is spent
  for no effect. This slice makes the asymmetry conspicuous by enforcing the
  card's *printed* legality line while still allowing the do-nothing play.
- **`GameLog` announces only the batch's LAST row** to screen readers. A Falkner
  drawing 4 makes this sharper: it announces "drew 2 cards" (understating the
  play), and because a live region whose text does not CHANGE announces nothing,
  a second Falkner across two turns is silent. `TransientErrorPill` documents
  this exact trap and solves it with a remount nonce; `GameLog` has no equivalent.

### Review — no HIGH from either agent
**Engine+rules:** 24 mutants, 19 killed, 5 survived (1 equivalent). All four real
survivors were test-adequacy and are now fixed and re-verified dead:

| Survivor | Now killed by |
|---|---|
| gate read against the program's ENTRY state | `fix-gateorder` ordered draw counts |
| arm pushed to the BACK of the queue | same |
| the splice DROPS the queue tail | same |
| a hand ABOVE the target is trimmed | the never-trims test |
| `conditionNote` returns wrong text | the reject-message + note-wording test |

Two new fixtures carry that weight: **fix-gateorder** (an attach BEFORE the gate
that flips the condition, a two-op arm, and an op AFTER the gate — one ordered
`CARDS_DRAWN` assertion kills three mutants at once) and **fix-gatedsup** (the
only gated SUPPORTER, pinning that a rejected gate does not burn the §7.2
allowance, since every real gated card is an Item).

**Web+integration:** four MEDs, all addressed — the missing `engineVersion` bump;
unpinned log rows (three tests added, including Falkner's PAIR of draw rows and
Grusha's zero-row case); the export's "a P4 client may evaluate one locally"
claim, which was self-defeating and is now replaced by the P4 note above; and the
HUD's opponent-`prizes` read, recorded as the P4 item above. The reviewer also
confirmed the ternary restructure is behaviour-preserving for every pre-existing
card class, that no drag path bypasses the gate, that nothing outside the engine
switches over `EffectOp` (and `apps/api` does not depend on the engine at all),
and that the error code is never rendered raw.

**Not demo-reachable:** none of the three cards is in the demo decks, so the
greyed button, the reject pill, Falkner's double draw row and Grusha's silent
no-op cannot be seen at `/play` without a deck change.

Suite 1164 → **1196**; `bun run check` + `vite build` green.

## M5 op-slice: discardEnergy as built (2026-07-21) — Crushing Hammer / Giacomo / Mawile

The `discardOpponentEnergy` backlog row (§15 energy removal — the "hammer"
family). engineVersion 0.20.0 → **0.21.0**.

### The op
`{op: "discardEnergy", from, filter}` — that is the whole shape. `filter` narrows
which ATTACHED Energy may be taken (`anyEnergy` / the new `specialEnergy`), and
**`from` names both the eligible Pokémon and how many are hit**, spelled the way
the cards are:

| `from` | printed as | eligible |
|---|---|---|
| `opponentActive` | "…from your opponent's Active Pokémon" | their Active alone |
| `opponentChosen` | "…from **1 of** your opponent's Pokémon" | their whole board, ONE Energy total |
| `opponentEach` | "…from **each** of your opponent's Pokémon" | their whole board, one Energy off EVERY Pokémon that has a match |

**Exactly one Energy per affected Pokémon.** No `count` field: every printed card
in scope takes one, and the "discard 2 / discard all" variants are all ATTACKS,
which cannot be authored yet (see the blocker below). `from` is deliberately the
extension seam — the self-discard attacks join as another member, not a rename.

**`opponentChosen` is a ONE-step decision, not two.** "Discard an Energy from 1 of
your opponent's Pokémon" reads like "pick a Pokémon, then pick its Energy", but
since exactly one Energy comes off, picking the Energy IS picking the Pokémon.
So the prompt is a single flat candidate list and there is no source/destination
coupling to validate — the thing that made `moveEnergy` (D37) a compound park.

**MANDATORY — the first park with no decline.** Every previous parking op was
"up to" (searchDeck / discardPileRetrieval / lookAtTopN / moveEnergy) or
exactly-one (choosePokemon). Here the only question is WHICH Energy, never
whether, so `validateChoice` enforces an EXACT count and an empty pick is an
error, not a decline. Mawile's "you **may**" lives at the TRIGGER level
(`optional`), not in the op.

It parks only on a real choice: an affected Pokémon holding 2+ matching Energy,
or — for `opponentChosen` — 2+ candidates across the board. A single forced
candidate auto-resolves (the M1 "a choice with no choice in it is not a choice"
doctrine, via `forcedDiscards`), and an empty candidate set is a no-op. Never
damages, so it never KOs and never touches the flow tail.

**The discarded card goes to its OWNER's pile** — the opponent's, never the
controller's. Same rule the §8.1 KO cleanup follows, applied to a single Energy.

### The prompt / choice
`{kind: "discardEnergy", discardable: {uid, from: PokemonRef}[], scope: "one" |
"each", note}` and `{kind: "discardEnergy", uids: string[]}`. `scope` is the only
thing the two shapes differ by, and `validateChoice` gets both from **two rules
plus a count**: every uid was offered and distinct, no Pokémon gives up two, and
the total equals 1 (`"one"`) or the number of distinct sources (`"each"`) — from
which "one each, none skipped" follows by pigeonhole.

Every candidate is Energy sitting **face up on the table**, so the prompt leaks
nothing and the projection is unchanged (unlike the standing searchDeck /
lookAtTopN P4 item, where the parked prompt carries deck cards).

### The `programPlayable` whiff gate — and the coin-gate bug it exposed
`discardEnergyPlayable` rejects a play whose discard could only whiff, so Giacomo
into a board with **no** Special Energy is rejected rather than burning the turn's
one Supporter (§7.2).

Crushing Hammer's discard sits INSIDE a `coinFlipGate`, and `programPlayable`
used to scan **top-level ops only** — so the slice originally shipped it as
playable into an Energy-less board, on the reasoning that "the flip happens
either way". **The review falsified that**, and the fix is engine-wide:
`programPlayable` now **descends into `coinFlipGate.then`**.

The rule is §7 "you cannot play a card if it has no valid target" — Compendium
[ruling/906](https://compendium.pokegym.net/ruling/906/), reconfirmed by the TPCi
Rules Team **2025-06-26**. A coin gate has no `otherwise`, so its `then` is the
only thing the card can ever do; a branch that could only whiff means the card
could only whiff, and the **flip is procedure, not effect** (the rulebook's own
attack sequence separates "flip a coin" from applying effects), so it cannot be
what makes a target-less card playable. The apparent counter-precedent — Unown-E's
"Hidden Power" forcing every flip to tails, yet flip Trainers staying playable
(PUI Rules Team 2008-01-24) — is the OTHER branch of
[ruling/284](https://compendium.pokegym.net/ruling/284/): *"playing a card for no
effect happens when **the game state itself** prevents any effect from taking
place"*. Blocked by an effect in play → playable; blocked by the board → not.

This also fixes a **pre-existing** bug the slice inherited rather than caused:
**Pokémon Catcher** (`coinFlipGate → [gust]`, D-M5 pass #1) was likewise playable
into an empty opponent Bench. Both are now pinned. **Poké Ball is untouched** —
`searchDeck` stays "playable enough" because a deck is *not* public knowledge, so
"this search will find nothing" is never a fact the game state establishes, which
is exactly the ruling's own limit.

**Not extended to `conditionGate`.** No printed sv01–03 card puts a whiff-able op
inside one (Falkner and Grusha branch into draws), and deciding it properly means
EVALUATING the condition in `programPlayable` and scanning only the arm that will
actually run — a bigger claim than the coin gate's pure implication, and one no
card needs yet. Recorded here so the next author sees the asymmetry is deliberate.

### Cards landed (verified vs the local D1 catalog)
| Card | ids | Program |
|---|---|---|
| Crushing Hammer | sv01-168 | Item — `[coinFlipGate → [discardEnergy opponentChosen anyEnergy]]` |
| Giacomo | sv02-182, 252, 267 | Supporter — `[discardEnergy opponentEach specialEnergy]` |
| Mawile | sv03-143 | "Special Eater" — `triggered onPlayToBench, optional` → `[discardEnergy opponentActive specialEnergy]` |

All three `from` arms land with a real printed card — no speculative vocabulary.
`fix-hammer` is the one fixture: the `opponentChosen` arm WITHOUT Crushing
Hammer's coin gate, so the park / the forced pick / the whiff gate are pinned
without threading a seeded flip through every assertion.

### Web — one dialog, one log row, no projection change
`DiscardEnergyDialog` groups the candidates **by the Pokémon they sit on** (which
is what `scope: "each"` counts against) and has **no decline button**, because the
decision is mandatory; Confirm reads "Discard n/N" and stays disabled until every
group is answered. A second pick within one group REPLACES the first, so the HUD
cannot construct a choice the engine would reject.

Three things the review changed, each worth keeping:
- **Forced groups come PRE-ANSWERED.** In a `scope: "each"` park, a Pokémon
  holding one candidate is not a question — `forcedDiscards` would have
  auto-resolved the whole op if they all were, so only the one Pokémon carrying
  two Special Energy actually parks it. Without seeding, the player had to
  re-click every forced group before Confirm lit up. Same shape as
  `MoveEnergyDialog` pre-selecting a sole source.
- **The legend carries the SPOT** ("fix-basic-2 · Bench 1"), unlike the flat
  sibling dialogs which name the Pokémon alone. Two copies of one Basic on the
  opponent's board would otherwise give two identical legends over two identical
  "Basic Energy" rows — and for Crushing Hammer, *which* host loses the Energy is
  the entire decision.
- **`fieldset`/`legend`, not a heading above a list.** This is the only HUD dialog
  whose rows are GROUPED; without the host being part of the group's accessible
  name, a screen reader never says which Pokémon an Energy would come off. The log
  row also tints the Energy card differently from its host (the ENERGY_ATTACHED
  precedent), since "discarded **X** from **Y**" gave no cue which was which.

One new event `ENERGY_DISCARDED {seat, uids, from}` — **one per affected Pokémon**
(a Giacomo sweep emits several), `seat` naming the VICTIM as DAMAGE_DEALT's does,
so the log row flips to the other seat. Attached Energy and the discard pile are
both public, so the row names the cards.

### Recorded, not fixed — an optional trigger whose op is mandatory
Mawile's Ability is printed "you **may** discard…", and the trigger framework
AUTO-FIRES optional triggers (`TriggeredAbility.optional`). Every earlier
auto-fired trigger still left an escape hatch, because the op it ran was itself
declinable — the interpreter's own doctrine says so: *"the forced branch
AUTO-TAKES rather than offering the 'you may' decline (only the parked branch
does)"*. `discardEnergy` is the first **mandatory** parking op, so Mawile is the
first case where a "you may" cannot be declined at all: with two Special Energy on
the opponent's Active, the player is in a dialog they never asked for.

Left as-is deliberately, and pinned by a test. The auto-fire doctrine's stated
justification is that every optional trigger in scope is **pure upside**, and this
one is unambiguously so — no member of the decision space is worse for the
controller than another (there is no sv01–03 Special Energy whose loss helps its
owner), so being "trapped" costs nothing but a click. The real fix is the
trigger-level yes/no confirm the doctrine already contemplates, which is a
framework change, not a card one.

### The blocker this slice found — attack effect programs cannot PARK
> **RESOLVED by the next slice** (engine 0.22.0) — see "M5 op-slice: attack
> programs can PARK as built" below. Kept as written because it is the diagnosis
> that produced the slice.

Scoping the family turned up **~13 more sv01–03 cards on the same idea** that this
op cannot reach, and the reason is not the op: `attack.ts` runs an attack's effect
program as `runProgram(...).state`, so a **parked** result silently drops the
prompt and the remaining ops. Every "Discard an Energy from this Pokémon" attack
(Houndoom ×2, Charcadet, Staraptor, Paldean Tauros, Dedenne ex, Bombirdier,
Corviknight 2, Koraidon 3) and the opponent-side attack twins of Crushing Hammer
(Pincurchin, Gumshoos, and Dedenne / Maschiff / Tympole behind a flip) are blocked
on it — as is the `attack?: EffectOp[]` registry seam generally, which is still
unused and, being card-level rather than per-attack, would also need keying by
attack before a multi-attack Pokémon could use it.

The fix has a known shape: seed `pending` with a new `attackEpilogue` stage and
fold the park through `settleProgram`'s existing `resumeTail` path, so the KO
sweep + turn tail resume after the decision. It touches the §14 tie guard and the
turn tail, so it is its own slice — now the top row of the backlog. (Pawmot and
Raichu, "Discard ALL Energy", need only a `count: "all"` rider and would land
without the park work, since "all" has no decision.)

## M5 op-slice: attack programs can PARK as built (engine 0.22.0)
The structural unlock the `discardEnergy` slice diagnosed, plus the card family
that proves it. **What changed is one stage, not one op.**

### `attackEpilogue` — the attack's tail, as a queued stage
`attack.ts` used to end with two straight-line steps: run the effect program
(`runProgram(...).state`), then `finishAttack` (the §8.1 KO sweep on the
defender's board + the §5.3 turn tail). A **parked** program's prompt and every
op behind it were simply thrown away by that `.state`.

The fix inverts the order: **queue the tail first, then run the program.**
- New `PendingStage` **`{kind:"attackEpilogue", seat, koedSeat}`** (types.ts).
- **`finishAttack` MOVED from attack.ts into flow.ts** and is exported. It had to:
  `advance` must reach it, and attack.ts already imports flow, so the handler
  cannot sit on the far side of that edge. Its body is unchanged.
- `attack()` seeds `pending: [epilogue]` and folds through
  **`settleProgram(..., { resumeTail: true })`**. A DONE program drains straight
  into the stage — behaviourally identical to the old inline call, one hop later.
  A PARKED one leaves the stage in `pending` until `resolveEffect` finishes the
  program (across any number of re-parks) and drains it then.
- Seeding is safe because **`pending` is empty during `turn:action`** — the tail
  only exists while a turn is ending. `advance`'s case pops the stage before
  calling `finishAttack`, which writes its own queue.

**`resumeTail` now has two meanings, and that is deliberate.** It was "this
program is mid-KO-sweep (an on-KO Ability)"; it now reads "this program is
mid-TAIL — the stages that finish the job are already queued behind it, so DONE
means keep draining, not fold back to a turn". Both callers want exactly that,
and neither wants `settleProgram`'s mid-turn KO sweep (the on-KO program does not
damage; an attack's KOs are the epilogue's own job, and its sweep reads the
POST-effect board, so a spread that KOs is still caught).

The one place the two differ is the projection: an on-KO park has
`phase.seat` ≠ the turn owner (the KO'd player decides during the opponent's
turn), while an attack park has `phase.seat` **=** the turn owner. `koParkActiveSeat`
(projection.ts) resolves both by reading the pending queue, so `attackEpilogue`
joined `endTurn`/`checkup`/`resumeTurn` as an "in turn" marker — without it the
board would show NO turn owner while the attacker is mid-decision.

### The family that proves it — the §8 self-discard attack COST
`discardEnergy` (D41) gained two things, both **DERIVED from printed text**
(effects.ts rules 7/8) rather than authored per card — so the family lands with
**zero registry rows**:
- **`from: "yourActive"`** — the controller's own Active, which for an attack IS
  the printed "this Pokémon" (§8: only the Active attacks). The only arm that
  discards from the controller's board, and the reason `discardEnergyApply` reads
  the victim seat off the op instead of hardcoding `otherSeat`.
- **`count: "all"`** — take every match off every affected Pokémon. No decision,
  so it never parks.

Two anchored whole-sentence rules cover **11 catalog rows**:
`"Discard an Energy from this Pokémon."` → Houndoom (sv01-034, sv03-133),
Charcadet (sv01-039), Staraptor (sv01-150), Paldean Tauros (sv02-028), Dedenne ex
(sv02-093/239), Bombirdier (sv02-147); `"Discard all Energy from this Pokémon."`
→ Pawmot (sv01-076/209), Raichu (sv02-064/211).

**Deliberately NOT derived** (each needs op vocabulary, not more park): the
numeric counts ("Discard 2/3 Energy…" — Corviknight, Koraidon, Arcanine ex,
Sandaconda, Slither Wing) need an exact-N park; the typed ones ("Discard a {L}
Energy…" — Kilowattrel) need an energy-of-type filter, and `{L}` means an Energy
that PROVIDES {L}, so Special Energy counts — a real rules subtlety, not a filter
rename. Multi-sentence prints (Eiscue ex, Weavile, Kyurem) fail whole-sentence
anchoring, which is the deriver's own doctrine: **exact map or flag**.

### Interchangeable candidates collapse — the M1 doctrine, applied to cards
The headline board (a Houndoom attacking with three {R} attached) would otherwise
have asked "which of these three identical Fire Energy?". `interchangeableCandidates`
(interpreter.ts) keeps ONE representative per **(host, card id)** class before the
forced/park decision, so:
- three copies of one print on one Pokémon → **one candidate → forced, no prompt**;
- two different prints on one Pokémon → two candidates → **parks**;
- two identical prints on two DIFFERENT Pokémon → **two candidates, still parks** —
  WHICH Pokémon loses the Energy is never fungible, which is why the key includes
  the host.

The precedent is `attachEnergyFrom`'s "same-type Basic Energy is fungible, so the
only decision is the TARGET", narrowed here to card-id equality (a strict subset,
so it can never collapse a real choice). A uid with no catalog card collapses with
nothing — park and ask rather than guess. `count: "all"` uses the UNcollapsed set:
interchangeability is about which to pick, and there nothing is picked.

**This changed shipped behaviour for the opponent arms too** (Crushing Hammer /
Giacomo / Mawile): a Pokémon holding two copies of ONE Energy print now
auto-resolves instead of parking. That is the improvement, not a regression — but
it is why three D41 tests had to swap to two DISTINCT prints to keep testing a park.

### `ENERGY_DISCARDED` gained `actor`
`seat` names the victim (the DAMAGE_DEALT convention) and the log used to infer
the actor as `otherSeat(seat)`. For a self-discard the two are the SAME seat, so
that inference would credit Houndoom's own attack cost to its opponent. The event
now carries `actor` and the row files under it — an inference the log should never
have been making.

## M5 op-slice: the discardEnergy ATTACK arms as built (engine 0.23.0)
**2026-07-21.** No new op — two extensions of D41/D42's `discardEnergy`, both
**DERIVED from the printed sentence**, so **11 catalog rows land with ZERO registry
rows**. The slice is the cheapest half of the family and the one that finishes the
mechanism D42 built: an attack effect that can park is only worth having if attacks
actually print decisions, and these are the ones they print.

### Arm 1 — the hammer family's attack TWINS
Two anchored deriver sentences, both onto the **existing** `opponentActive` arm
with an `anyEnergy` filter (Mawile's Ability already ran that arm, one filter
narrower):
- `"Discard an Energy from your opponent's Active Pokémon."` — Pincurchin
  (sv02-072), Gumshoos (sv03-177), Dragonite V (swsh10.5-049 / -076);
- `"Flip a coin. If heads, discard an Energy from your opponent's Active
  Pokémon."` — Dedenne (sv01-094), Maschiff (sv01-136), Tympole (sv03-050),
  Yveltal (sv06.5-035).

These are the first ops to park a decision about the **OPPONENT's** board mid-attack.
Nothing in the interpreter or the flow changed to allow it — D42's `attackEpilogue`
already carries the tail, and the coin gate already splices its branch into the work
queue, so a park INSIDE a gate inside an attack works with no new machinery.

Two rules points worth keeping:
- **Anchoring is load-bearing here more than anywhere else so far.** Krookodile
  (sv01-117) prints *"Flip a coin until you get tails. For each heads, discard an
  Energy from your opponent's Active Pokémon."* — it ENDS in the twin's exact words.
  An unanchored regex would silently discard ONCE for a repeat-count attack.
- **A defender the same attack just Knocked Out is still stripped.** §8 resolves
  the whole attack before the §8.1 KO check, so the defender is on the board holding
  its Energy when the effect asks. The question is legal but academic (the rest of
  the stack follows into the pile a moment later); the interpreter deliberately does
  NOT predict the pending KO to skip it — that would mean reading the flow tail it
  is forbidden to touch.

### Arm 2 — the exact-N self-discard
`count` widens from `"all"` to **any number**: `"Discard 2 Energy from this
Pokémon."` (Corviknight sv02-148, Slither Wing sv06.5-026) and `"Discard 3…"`
(Koraidon sv01-124). Three consequences:

1. **The prompt's `scope` became a discriminated union** — `{kind:"total"; count}`
   (exactly `count` uids across the whole offer) `| {kind:"each"}` (one per distinct
   host, Giacomo). The old `"one"` was `{kind:"total",count:1}` all along; naming it
   honestly was cheaper than adding a parallel field.
2. **The interchangeable collapse is now CAPPED, not flattened.** D42 kept ONE
   representative per (host, energy identity); it now keeps **`count`** of them.
   Keeping one would make "discard both Fighting" unanswerable on a board of two
   {F} + one filler — a *distinguishable* answer erased. The cap is exactly the
   number a pick could ever want from one class, so it removes every copy that could
   only produce a duplicate answer and no more. Two identities it preserves:
   - four identical {F} with `count: 3` → capped to 3 → **forced, no prompt** (the
     Houndoom result, generalized);
   - three identical {F} + one filler with `count: 3` → 4 candidates → **parks**,
     because "all three {F}" and "two {F} + the filler" are different boards.
3. **`forcedDiscards` folds the SHORT board into the same rule.** "Auto-resolve when
   the collapsed offer is ≤ count" is simultaneously the no-choice rule and the
   "do as much as you can" rule: a board holding fewer than N gives up all of it and
   asks nothing. (Every printed exact-N card pays a cost at least as big as its own
   discard — Slither Wing 3/2, Koraidon 4/3 — so the shortfall is unreachable through
   a real attack and runs on the `fix-discard4` fixture.)

`validateChoice`'s **one-Energy-per-Pokémon** rule became **`"each"`-scope only**: an
exact-N discard takes all N off the SAME Pokémon, which is precisely what that rule
forbade. AUTHORING NOTE — nothing now pins a multi-count pick to a single host, so a
future *"discard 2 Energy from 1 of your opponent's Pokémon"* would need a same-host
rule of its own; the deriver is the only author of a numeric count and only ever
pairs it with the single-Pokémon `yourActive` arm.

### Web — one dialog rewritten, nothing else
`DiscardEnergyDialog` (GameHud.tsx) is the only source change: `"each"` keeps the
one-pick-per-group replace rule, and `"total"` became a flat multi-select of exactly
`count` uids from anywhere in the offer — click a picked row to clear it, and at the
cap the **OLDEST** pick is evicted, which degenerates at `count: 1` to the familiar
"click another row to move the pick". The heading spells the count out
("Pick 2 Energy to discard (0/2)") rather than leaving it to the Confirm fraction.
No projection change, no new event, no new log row: `ENERGY_DISCARDED` already
carries a uid ARRAY per affected Pokémon, so two cards off one host is one row.

### Cards landed (verified vs the local D1 catalog)
| Card | id | Sentence → program |
|---|---|---|
| Pincurchin | sv02-072 | `discardEnergy opponentActive anyEnergy` |
| Gumshoos | sv03-177 | same |
| Dragonite V | swsh10.5-049, -076 | same |
| Dedenne | sv01-094 | `coinFlipGate → [same]` |
| Maschiff | sv01-136 | same |
| Tympole | sv03-050 | same |
| Yveltal | sv06.5-035 | same |
| Corviknight | sv02-148 | `discardEnergy yourActive anyEnergy count 2` |
| Slither Wing | sv06.5-026 | same |
| Koraidon | sv01-124 | `… count 3` |

### Review — NO HIGH from either agent; the HIGH that did land was in the LOG
Two adversarial agents (engine+rules with mutation testing / web+integration).
**Neither found a HIGH in the slice's own logic.** The web agent found one HIGH
next to it, and it is the finding worth remembering:

**`ENERGY_DISCARDED` named its host by SPOT, and the attack twins made that
unresolvable.** The log did `targetName(state, seat, event.from)` — re-reading the
slot in the post-state. Safe for every prior arm (Trainers/Abilities never damage;
the self-discard names the attacker, who never dies). But an attack twin strips a
defender its own damage Knocked Out, the KO nulls that slot **in the same batch**,
and the row printed *"discarded fix-energy from Tide's the Active spot"*. The
event's own doc asserted the opposite invariant ("the Pokémon stay put, so `from`
resolves against the post-state"), which is exactly why nobody looked. The engine
test covered the board case; the log had no test at all.
Fixed the way `KNOCKED_OUT` already does it: **the event carries `host`**, the
Pokémon's top-card uid captured pre-strip, resolvable through `cardIdByUid`
forever. `from` stays (it is still the structural fact).

Everything else was test adequacy or robustness, all applied:
- **The `each`-scope collapse cap was completely unpinned** — a `cap = 2` mutant
  survived all 1266 tests while changing shipped Giacomo behaviour (two copies of
  one print on one Pokémon would have parked on a fake question). The existing
  Giacomo park test uses two DIFFERENT prints, so nothing held the cap at 1. Pinned.
- **The anchoring argument was stated wrong.** Krookodile is refused by the leading
  `^` *and* by its lowercase mid-sentence "discard" — either alone suffices, so it
  never pinned the anchors: four anchor mutants survived. The comment now says the
  guard is anchor **+ capitalisation** (and not to add `/i`), and six synthetic
  strings keeping each pattern's own capitalised first word pin every `^` and `$`.
- **Three of the four new fixtures had wrong HP/retreat** despite a header claiming
  catalog verification (Pincurchin 90→80, Tympole 60→70, Slither Wing 130/2→140/3).
  Corrected, and the header now DECLARES what the fixtures simplify (no printed
  weakness; the two-attack cards carry only the discarding one, so `index: 0` is
  their second printed attack).
- **`opponentEach` + a numeric `count` is now UNREPRESENTABLE** (`count?: never` on
  a split union arm), not merely undocumented — it used to type-check, discard one
  per Pokémon, and caption itself with the number it ignored.
- **The HUD's evict-the-oldest became refuse-at-the-cap** above `count: 1` (the
  ChooseCards / ChoosePokemonMulti rule): evicting silently un-pressed a row the
  user was not looking at, and interchangeable copies mean the evictable rows can
  be identical by name. The count line became an `<output>` (implicit polite live
  region) — `aria-pressed` is only spoken for the focused row and the Confirm
  button is `disabled` until ready, so the running total was unannounceable; and a
  refused row now carries `aria-disabled` (focusable still, since the rows ARE the
  offer) because an inert row is the one state a live region cannot report.
- **Two of the slice's own web tests were proven toothless** by mutation and
  rewritten: the deselect branch at `count > 1` had zero coverage, and the
  "drops the oldest" test clicked in board order so it could not tell FIFO from
  board-order eviction.
- Closed a **pre-existing** hole the run surfaced: `moveEnergy`'s duplicate-uid
  wire check had no test (deleting it left the suite green).

Recorded, not fixed: `validateChoice` does not pin a multi-count pick to one host
(the AUTHORING NOTE above — unreachable until a card prints it), and `GameLog`
still announces only a batch's last row.

### What was left of the family — one filter
Everything still unauthored after this slice was **TYPED** (Kilowattrel "a {L}
Energy", Arcanine ex ×2, Charmeleon, Charizard), and one `providesEnergy` filter
covered all of it. **Built next — see the section below.**

## M5 op-slice: the providesEnergy filter as built (engine 0.24.0)
**2026-07-21.** A new `CardFilter` kind — `{kind:"providesEnergy"; energyType}`,
"an Energy that **PROVIDES** {X}". It closes the energy-removal family's last gap
and is the **first filter a CARD alone cannot answer**.

### The two claims
1. **PROVISION, NOT PRINT.** "{L} Energy" is not "a Basic Lightning Energy card".
   A Special Energy providing {L} **is** one; a Special providing only {C} is not,
   whatever its name or art; and a **wildcard** provider (Luminous Energy,
   "provides every type of Energy but only 1 at a time") is an Energy of **every**
   type. So the predicate reads what a card GIVES on the board.
2. **HOST, NOT CARD.** Provision is a while-ATTACHED property ("As long as this
   card is attached to a Pokémon, it provides…"), and Luminous's own text makes it
   depend on the holder's OTHER attachments — it provides {C} instead "if the
   Pokémon this card is attached to has any other Special Energy attached". The
   identical physical card is therefore a {L} Energy on one board and not on
   another, which no card-only predicate can express. `attachedEnergies` answers
   the filter per Energy **on its host** (`matchesAttached`).

The pair is written into `reference/ptcg-rules.md` as **§6.5**.

### One provision rule, two readers
`continuous.ts` was split rather than copied: `providedEnergy` (the §8.2 cost
matcher's source, consumed by `costMet`) and the new `unitsProvidedBy` /
`providesEnergyType` share one `unitsOf` helper. The invariant that buys: **an
Energy that can PAY a {L} cost is exactly one a "{L} Energy" effect may take.**
Kilowattrel makes it concrete — it can pay Thunder Blast's {L} with a Luminous and
then discard that same Luminous, and a drift between the two readers would make
that board either unattackable or a silent no-op. Pinned by its own test.

**The pile scanner says NO.** `matchesFilter` — the deck / hand / discard scanner
behind searchDeck, lookAtTopN and discardPileRetrieval — returns **false** for this
filter kind, because a card in a pile is attached to nothing and provides nothing.
Authoring it into a pile-scanning op is therefore a **loud no-op**, never a wrong
card; guessing "a Basic Energy of that type" there would have taken the wrong
print. (Decidueye's "Discard a Basic {G} Energy **card** from your hand" is the one
row that really is about a print — and it says CARD for exactly this reason. That
row is why `basicEnergy` still exists alongside this filter.) Pinned by a
`fix-pilescan` fixture, since only a registry row can author the mistake.

### Consumer 1 — the TYPED self-discard, derived (5 rows, no registry rows)
One regex over **both printed notations**, built from one `ENERGY_TYPE_BY_CODE`
map so the two spellings cannot drift: the modern brace code (`{R}`) and the
swsh-era spelled-out name (`Fire`), at counts `a` / `N` / `all`.

| Card | id | printed |
|---|---|---|
| Kilowattrel | sv01-079 | "Discard a **{L}** Energy from this Pokémon." |
| Arcanine ex ×2 | sv01-032, sv01-224 | "Discard **2 {R}** Energy from this Pokémon." |
| Charmeleon | swsh10.5-009 | "Discard a **Fire** Energy from this Pokémon." |
| Charizard | swsh10.5-010 | "Discard **all Fire** Energy from this Pokémon." |

The map's values are pinned to be **exactly `BASIC_ENERGY_TYPES`** — the monorepo's
one basic-energy vocabulary. `{C}` and `{N}` are absent there on purpose (§6.1:
Colorless is a cost symbol, Dragon has no Basic Energy) and their absence is
load-bearing here rather than incidental: **Colorless is the conservative provision
FALLBACK for every unauthored Special Energy**, so a `{C}` filter would quietly
match cards nobody meant.

The typed `"all"` is the arm that proves the filter does work in the APPLY and not
only in the prompt — it never asks a question, so the filter is the only thing
between Charizard's "all Fire Energy" and a board stripped bare.

### Consumer 2 — `moveEnergy`'s `benchToActive` route (Armarouge)
The fixed-endpoint rider the moveEnergy slice deferred: sources are the **bench
alone**, the sole destination is the **Active**. Armarouge (sv01-041 / -203) "Fire
Off" — *"As often as you like during your turn, you may move a {R} Energy from 1 of
your Benched Pokémon to your Active Pokémon"* — reads as three flags off the
printed words: `oncePerTurn: false` ("as often as you like", so no allowance is
stamped), `activeOnly: false` (the card never says "this Pokémon", so a BENCHED
Armarouge may move its own {R}), and the `providesEnergy` filter for "{R}".

One decision survives (WHICH Energy), so it parks on the **same compound prompt**
with a single-entry `destinations` — the dialog and the wire validator both read
the prompt, so neither knows a route exists. Source and destination are disjoint by
construction, which is why the free route's "needs two Pokémon in play" test
relaxes here to "needs an Active and a benched source".

### Web
One behavioural change: `MoveEnergyDialog` now treats a **sole destination as
already chosen** (the rule its source list already followed — a list of one is not
a decision), because the route makes a single destination the NORMAL case rather
than an edge one; otherwise every use of an as-often-as-you-like Ability costs a
redundant click on the only legal target. The discard dialog needed nothing: the
prompt carries the note and the offer. Prompt wording renders the **full type
name** ("Discard a Lightning Energy from this Pokémon.") rather than the printed
brace code, because the rows the player then clicks are card NAMES — the note is
built from the OP, not from text, and Armarouge's has no printed attack sentence at
all.

### Verification
`bun run check` green — tsc + biome + **1301 tests** (1268 → 1301) + `vite build`.
The deriver was run over **all 1108 text surfaces of all 978 catalog rows**: it
matches **exactly the 5 intended rows**, zero false positives, zero misses — and
every typed row it does NOT match is refused for a stated reason (a rider clause —
Pawmot ex; "you may" — Bellibolt ex; "up to"/"any amount" with damage scaling —
Mewtwo VSTAR, Chien-Pao ex; a hand PRINT — Decidueye). All five new fixtures verify
**byte-for-byte** against the catalog (name/hp/stage/evolveFrom/types/retreat and
the whole attack row) — the defect class the previous slice's review caught.

### Review (2 adversarial agents: engine+rules with 49 mutants / web+integration)
**NO HIGH from either.** The engine agent threw **36 hostile `resolveEffect`
inputs** at both new prompts (zero throws, zero input mutation), confirmed purity
under `deepFreeze` across attack → park → resolve, verified the KO-tail
interaction, and killed 36 of 49 mutants. Fixes applied from the two reports:
- **`ENERGY_MOVED.to` no longer spreads the client's object.** `validateChoice`
  proves the dest `refEquals` an offered ref, but refEquals compares only
  seat/spot/index — so extra keys a client hung on it rode the spread into an event
  handed to the animator, the log and (P4) the opponent. The state was always safe;
  the EVENT is the §2 copy contract, and a copy of attacker-controlled data is not
  a copy of the engine's own value. It is rebuilt field by field now.
- **`energyType` tightened to `BasicEnergyType`** — see above.
- **The route's "an Active exists" precondition collapsed from THREE copies to
  one** shared `moveEndpoints`, which is the same "one rule, two readers" shape the
  provision split uses. All three were untested, and one mutation left an
  unrecoverable `effect:choose` (a park with no legal answer).
- **A `fix-blend` fixture** — a Special providing TWO distinct types. Both authored
  Special Energies are single-valued (Jet `["Colorless"]`, Luminous `[ANY_ENERGY]`),
  so the predicate's "is the type AMONG the units" was indistinguishable from "is it
  the FIRST unit" until a Blend/Reversal-style print arrived.
- Smaller: `moveNote`'s article ("Move a Energy"), an orphaned Armarouge JSDoc, the
  web `promptKey` (the move key ignored the `destinations` its `dest` now derives
  from), and a `<output>` live region in the move dialog.
- **Two DOM tests the web agent proved were missing**, both with mutations that
  passed all 1297 tests: the **multi-destination pick** (a dialog that always took
  `dests[0]` passed the suite while misrouting Energy on any 3-Pokémon board) and
  **`reset()` on source change** (dropping its pick-clear dispatches the previous
  source's Energy — and the engine ACCEPTS it, so a silent wrong move).

**Recorded, NOT fixed:**
- **The typed candidate set is SNAPSHOTTED**, so discarding one Special cannot
  un-demote a survivor. Unreachable today: a wildcard is only ever a candidate when
  it is the SOLE Special, so removing it un-demotes nothing. It activates with the
  first typed Special Energy authored.
- **Charizard's printed Ability "Burn Brightly"** ("Each basic Fire Energy attached
  to your Pokémon provides {R}{R} Energy") is itself a PROVISION modifier, and
  `unitsOf` has no hook for a Pokémon Ability that changes what attached Energy
  provides — provision is print + `EnergyProgram` only. Authoring it would widen the
  model BOTH this filter and §8.2's cost matcher read, not just add a row.
- **The Abilities row is the only HUD button family with no playability gate**
  (`usableAbilities` reads `activeOnly`/`oncePerTurn` but not `programPlayable`), so
  an as-often-as-you-like Ability's button never greys and the repeat click the card
  invites reliably yields an error pill once the bench runs dry. Pre-existing
  (Baxcalibur, Gardevoir ex), made routine here. The fix wants the engine-exported
  preview predicates P4 needs anyway.

### What is left of the family
**Filter-complete.** Every card still unauthored in the energy-removal family is
blocked by sentence **STRUCTURE**, not by any missing predicate: an optional
discard that BUYS an effect (Bellibolt ex), a variable count with damage scaling
off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda, Eiscue ex,
Weavile, Pawmot ex — whose rider wants "220 damage to 1 of your opponent's
Pokémon", which `damageChosen` cannot express since it targets the Bench), and
Krookodile's flip-until-tails repeat count.

## M5 op-slice: attachFromTop as built (engine 0.25.0)
**2026-07-21.** The from-the-top ATTACH the `lookAtTopN` slice explicitly
deferred: look at the top N of your own deck and attach the Energy you find
there **straight onto your Pokémon**, rather than putting a card in hand.

### The op
`{op:"attachFromTop"; n; filter; max: number|"any"; targetType?; benchOnly?;
discardRest?}`. It is not a rider on `lookAtTopN` and not a rider on
`attachEnergyFrom`, because the decision it parks on is a shape neither can
express — see below. Two consumers, and they differ in **every** rider the op
has, which is what made each one worth having:

| | Electric Generator (sv01-170, Item) | Hydreigon (sv02-140) "Tri Howl" (Ability) |
|---|---|---|
| look at | top **5** | top **3** |
| attach | **up to 2** Basic **{L}** Energy **cards** | **any number** of **Energy cards** |
| onto | your **Benched {L}** Pokémon | your Pokémon (**any**, Active included) |
| leftovers | **shuffle** back (a trailing op) | **discard** (`discardRest`) |
| gate | Item, playable any number of times | **once per turn**, not Active-only |

### "In any way you like" — the first prompt whose answer is a MAP
`attachEnergyFrom` attaches ONE fungible card and asks only *where*; `moveEnergy`
takes several Energy but they all land on ONE destination. Here the cards are
whatever the top N happened to hold and **each attached card names its own
destination**, so the answer is a set of (card → Pokémon) pairs. That is the new
`attachCards` prompt (`candidates` / `targets` / `max`) and the new
`{kind:"attachCards"; assignments}` choice. Consequences worth stating:

- Any split is legal, **including all of them on one Pokémon** — "in any way you
  like" is not "one each" (pinned by its own test, since a per-target-once rule
  would look plausible and pass every single-card test).
- The pairing is what `validateChoice` has to check: ≤ `max` assignments, every
  uid one the prompt offered (which is what keeps a client off a card DEEPER in
  the deck than the look reached), **no uid twice** — one physical card cannot
  land on two Pokémon — and every destination an offered target.
- Declinable, like every "up to": attaching none is a legal answer, so the op
  parks whenever there is anything to attach and anywhere to put it. It does not
  auto-resolve a one-candidate board (the searchDeck rule, not the gust rule).

### The leftovers clause — why one arm is a field and the other is an op
"Shuffle the other cards back into your deck" is the **trailing `shuffleDeck`
op**, the Nest Ball search-then-shuffle pattern every pile op here already uses:
those cards never left the deck, and a shuffle destroys order anyway, so a step
that knows nothing about the window gets it exactly right.

"**Discard** the other cards" cannot be expressed that way. It must name exactly
the looked-at cards that were NOT attached, and only the op knows which those
were — after k are attached the window holds n − k, so a "discard the top 3" step
would eat k cards deeper in the deck. Hence `discardRest` ON the op. The
asymmetry is forced by what each clause has to know, not chosen for style.

And it is **charged on every path** — the whiff (no Energy up there), the decline
(attach none), and the no-eligible-target board. Every non-parking branch of
`stepOp` therefore routes through the SAME `attachFromTopApply` with an empty
assignment list rather than returning `state`, which is what keeps a branch from
forgetting it. For Electric Generator this is invisible (a whiffed search
shuffles either way, as it always has); for Tri Howl it is the difference between
the Ability costing three cards and costing nothing. New count-only-ish event
**`DECK_TOP_DISCARDED {seat, uids}`**: the pile is public, so naming the cards
leaks nothing, and the attached ones are named by their own `ENERGY_ATTACHED`.

### The filter reads the PRINT — D44's rule, from the other side
Electric Generator's "Basic **{L}** Energy **cards**" is `basicEnergy` +
`energyType`, NOT `providesEnergy`. These cards sit in a DECK, attached to
nothing, and provision is a while-attached property (§6.5) — so there is nothing
to read but the print. This is the Decidueye row's argument used in the opposite
direction, and it is the one filter choice these two cards could get wrong.
Authoring `providesEnergy` here would be a loud no-op rather than a wrong card
(`matchesFilter` answers false — the `fix-pilescan` fixture pins it).

### One target rule, two op-shaped readers
`attachEnergyTargets` was **widened, not copied**: it took an `attachEnergyFrom`
op and now takes a shared **`AttachTargetRiders`** (`targetType` / `basicOnly` /
`benchOnly` / `bonusCounters` / `notIfKO`, effects.ts), so "is this Pokémon an
eligible attach target" is one rule both attach ops read. An eligibility rule
that drifted between them would make the same board legal for one attach and not
the other. `benchOnly` is the new member, and Electric Generator needs it
literally — its Active may be a Lightning Pokémon and is still not a target.

### There is NO play gate — and the draft that had one was the slice's one HIGH
The first draft added `attachFromTopPlayable` to `programPlayable`, refusing
Electric Generator when the controller had no Benched {L} Pokémon, by the "an
attach with no eligible target can only whiff" rule `attachEnergyFrom` follows.
The adversarial review killed it, correctly, and the argument is the useful part:

- **`programPlayable` is an AND over a program's ops**, so vetoing on this op
  vetoes the CARD — including Electric Generator's second printed sentence,
  "Shuffle the other cards back into your deck", which always resolves.
- The ruling `cardplay.ts` already quotes (ruling/284) draws exactly that line:
  playing a card for no effect is when the game state prevents **any** effect.
  Shuffling a known-bad deck top is an effect players deliberately buy — and the
  §15.E note this same slice added says so in as many words.
- Two in-repo precedents agree: Great Ball / Pokégear (`lookAtTopN` +
  `shuffleDeck`) are unconditionally playable, and so is Nest Ball into a full
  Bench. The attach variant behaving differently from the put-in-hand variant had
  no printed justification.

So the op is **ungated**, and the no-eligible-target board is a live path through
`stepOp`'s empty branch: it attaches nothing and shuffles, exactly like a whiffed
Great Ball. The distinction from `attachEnergyFrom` is not the attach — it is that
every card carrying THIS op also carries a leftovers clause that always happens,
so "no target" is never "no effect". A future card where the attach is the whole
effect would want a gate expressed as "no op in this program can do anything",
not as a per-op veto.

The cap follows the same discipline: `max` is `min(printed, candidates.length)`
for both forms, so `"any"` is the degenerate case rather than a branch, and "up to
2" with one Basic {L} in the window is a pick of **one** — a prompt reporting 2
there would have the dialog count "0/2" over a single row. The prompt's `note`
still reads as PRINTED ("up to 2"), the discardNote doctrine: the sentence is the
card's, the number is what you can do.

### Web — one new dialog, one new log row
`AttachCardsDialog` is a two-step **loop** rather than the two-step wizard
`MoveEnergyDialog` is: pick a card, pick where it goes, repeat. The target list
is mounted only while a card is waiting for one, and **clicking an assigned card
takes it back** — the only undo, since a parked decision cannot be dismissed. A
click at the cap is refused with `aria-disabled` (the DiscardEnergyDialog rule),
and the `<output>` live region carries the running count, which card is waiting
for a destination, and the fact that the cap is closed. Row names are set with
`aria-label` because the accessible-name algorithm trims and concatenates
adjacent elements — the visible "Lightning Energy → Pikachu" would otherwise be
announced as one run-on word. `promptKey` gained an `attachCards` case carrying
both the candidates AND the targets (both are half of every answer).

### Review (2 adversarial agents: engine+rules with 50 mutants / web+integration)
**One HIGH, from the engine agent — the play gate above, now removed.** The web
agent found no HIGH: it could not produce a dispatch the engine rejects, a state
where the player cannot complete or decline, or a leak this slice introduces.
Between them, **65 mutations**; every survivor is now dead or recorded. Fixes
applied beyond the HIGH:

- **`max` clamped to the candidate count** (both agents, independently) + a test.
- **The prompt keeps "you find there" and "in any way you like"** — the second is
  the only cue that both Energy may go on ONE Pokémon, which is the misconception
  the dialog's shape invites and the engine test at "…the SAME Pokémon" guards.
- **Four engine test holes**, each a mutation that passed all 1323 tests: the
  `max` cap was never the rule that rejected (every other board had
  `max === candidates.length`, so the was-it-offered check fired first); attaching
  onto an Active that **already holds Energy** was unpinned (a clobber survived);
  the discard pile was **empty at every Tri Howl seed**, so append-vs-prepend was
  unpinned; and the apply's four wire-safety guards were unreachable through the
  action API — now driven directly through `applyChoice`, including the
  out-of-range bench index, which without its guard **destroys a card** (the
  `bench.map` no-ops while the uid still leaves the deck).
- **The dialog's pending state is no longer `aria-pressed`.** Confirm dispatches
  `assignments`, which does not contain the card waiting for a destination — so
  announcing it as pressed promised an attach that would not happen. It is
  `aria-current` now, with its own ring and a "choosing…" suffix.
- **The assigned-row readback carries the SPOT** ("→ fix-lightning-1 · Bench 2").
  Without it, two benched Pokémon sharing a name are indistinguishable and the
  only way to check the choice is to undo it.
- **Releasing an assignment no longer cancels an unrelated pending pick.**
- **The at-cap live-region text says what you CAN do** ("Tap an attached card to
  move it") instead of "Pick a card", which at the cap is exactly what a click
  refuses — and the comment claiming the region announces a refused click was
  removed, because it does not (React bails out on an unchanged state; the
  DiscardEnergyDialog note is honest about the same limit).
- **A dispatch-time filter against the offer.** Today a no-op — the `promptKey`
  remount clears picks between parks — but the failure mode if that key ever stops
  discriminating is not a bad attach, it is an **unescapable dialog**: a stale uid
  renders no row so it cannot be released, every dispatch (including "Attach
  none") is rejected as not-offered, and an unchanged state never remounts the
  dialog. Now pinned by a DOM test that drives two real parks through one mounted
  HUD, plus tests for the live region, the pending/committed distinction, the
  independent release, and the visible row TEXT (every earlier assertion read the
  accessible name, so deleting both `<span>` children rendered blank buttons and
  passed).
- **The log row asserts its SEAT**, not just its text — "infer the actor from the
  other seat" is a bug this log has already shipped once (D43's `ENERGY_DISCARDED`).

**Recorded, NOT fixed:**
- **P4 hidden information.** `projection.ts` copies the parked prompt into
  `pendingDecision` for BOTH seats, so an `attachCards` prompt carries the
  controller's private deck-top uids. Pre-existing and already tracked for
  `chooseCards` (D36), unobservable in the hot-seat build — but with one new
  wrinkle worth the P4 filter's attention: for a **shuffle**-leftovers card the
  unattached candidates go back into the deck and never become public by any other
  route, where `DECK_TOP_REVEALED`'s non-taken cards are at least shuffled away.
- **`GameLog` announces only a batch's LAST row**, and this slice is the first
  where that row is a pure COST while the benefit is silent: Tri Howl's batch ends
  in `DECK_TOP_DISCARDED` ("discarded 2 looked-at cards"), Electric Generator's in
  `SHUFFLE`, so the attaches — the point of both cards — are never spoken. The fix
  is a batch summary, not a re-ordering.
- **Tri Howl on an empty deck** burns the once-per-turn allowance with only an
  `ABILITY_USED` row to show for it. Consistent with "a look is always playable
  enough"; a deck-size gate would be the one place that doctrine could bend, since
  deck SIZE is public.
- **Neither card is in a demo deck**, so the dialog is unreachable at `/play`
  without a builder deck — as with every other M5 op-slice card. Hydreigon is
  additionally a Stage 2 off Zweilous, so Tri Howl needs a full line or Rare Candy.

### The family's third member, and why it is NOT authored
**Dragonite VSTAR** (swsh10.5-050/-081) "Draconic Star" — "Look at the top 12
cards of your deck and attach any number of **Water or Lightning** Energy cards
you find there to your Pokémon in any way you like. Shuffle the other cards back
into your deck. **(You can't use more than 1 VSTAR Power in a game.)**" — is the
same op with two blockers, neither of them this op's: a **two-type filter** (no
`CardFilter` member is a union of types), and the **VSTAR Power once-per-GAME**
rule, which is a per-player allowance the engine has no vocabulary for (§15.J's
allowances all reset each turn). Authoring it without the second would print a
card that can be used every turn.

## M5 op-slice: discardFromHandCost as built (engine 0.26.0)
**2026-07-21.** The printed **hand COST** — the resume point's #1, and the first
op that is not an effect at all but the price of one.

### Two printed wordings, one mechanism — and the wording tracks the CARD'S ZONE
| | Trainers | Abilities |
|---|---|---|
| printed | "You can use this card **only if** you discard 2 **other** cards from your hand" | "You **must** discard a card from your hand **in order to use** this Ability" |
| cards | Ultra Ball (sv01-196), Earthen Vessel (sv06.5-096, "**another** card") | Tinkaton (sv02-105) "a card", Revavroom (sv01-142) "an Energy card", Meowscarada ex "a Basic {G} Energy card", Radiant Blastoise (swsh10.5-018) "a Water Energy card" |
| says "other" | **always** | **never** |

That correlation is exact across the family and it is not a style split: **a
Trainer is in the very hand it pays out of; an Ability's card is on the board.**
So "other" is not a field on the op — it is a consequence of where the payer sits,
and the only place it has to be honoured is the **play gate**, which runs while the
Trainer is still in hand. The APPLY never needs it, because `playTrainer` moves the
played card to the discard before the program runs. Written into the rules doc as
**§7.5**.

### It is an OP, and it is the FIRST one, because it PARKS
`{op:"discardFromHandCost"; count; filter?}`. "Discard a card from your hand" over a
mixed hand is a real decision, so the payment has to run through the interpreter —
which is what a handler field could never do. That field existed:
`AbilityProgram.cost` (`{kind:"discardBasicEnergy", energyType}`), paid by
`findAbilityCostCard` before `runProgram`. It is **GONE**, and Meowscarada migrated
onto the op, because it was only ever the **fungible special case**: Basic {G}
Energy copies are interchangeable, so "the first match" was as good as any, and
Tinkaton's bare "a card" is the general one. Widen, don't copy — the D44/D45
pattern, applied to a field this time instead of a function.

**Order is observable, and the printed sentence puts the cost first on every card
in the family.** Revavroom is the witness: pay 1 out of a hand of 5, THEN "draw
cards until you have 6" draws **two**. Paying afterwards would draw one and leave
five. Tinkaton's is the quieter version — the card you pay with comes from the
pre-draw hand, so a card you are about to draw cannot pay for the draw.

### MANDATORY: `chooseCards` grew a floor
The prompt gained a **required** `min: number` (and a `"discard"` dest). Every
printed "up to" consumer — searchDeck, discardPileRetrieval, lookAtTopN — declares
`min: 0`, and this op declares `min === max === count`: **the only mandatory
chooseCards park there has ever been.** Required rather than optional so each park
site has to state which it is; `validateChoice` enforces the floor, and the dialog
disables Confirm below it rather than letting the engine say no.

It parks only on a real question. `interchangeableCandidates`' key function was
generalized (`energyIdentity` → **`cardIdentity`**: basic Energy by the type it
provides, everything else by catalog id) and `handCostCandidates` keeps at most
`count` per class — so Meowscarada holding three Basic {G} asks nothing, exactly as
the old field behaved, and an offer no bigger than `count` auto-resolves. One
collapsed set serves **both** the prompt and the gate, which is sound because
collapsing at cap `count` cannot cross the threshold: either one class alone has
`count` members, or every class survives whole — so `kept >= count` iff
`actual >= count`.

### The gate VETOES — the opposite call from D45, one slice later
`handCostUnmet` (interpreter.ts) is checked by **both** action paths before
anything is committed, beside `trainerPlayableIf`. It is deliberately **not** in
`programPlayable`, and the contrast with the previous slice is the point:

- `attachFromTop` is **ungated** because a per-op veto inside `programPlayable`'s
  AND would have vetoed a CARD whose other printed clause always resolves — the
  engine guessing that one op would whiff.
- This one **does** veto the whole card, on the card's own printed authority: "You
  can use this card ONLY IF" states a precondition for the play. Same shape,
  opposite answer, and the text is what decides.

It also needs something `programPlayable` structurally cannot have — the played
uid — which is the second reason it lives beside `trainerPlayableIf` (a printed
RULE) rather than among the whiff heuristics.

### Landed: 9 catalog rows, and one pre-existing bug the slice tripped over
Ultra Ball, Earthen Vessel, Revavroom, Tinkaton, Radiant Blastoise, plus
Meowscarada ex ×2 migrated. **Earthen Vessel is the first `searchDeck` for SEVERAL
of something whose noun takes an article**, and it exposed that `searchNote` kept a
second, hand-rolled noun table beside the shared `retrieveNoun` one: its plural
branch printed "Search your deck for up to 2 **a Basic Energy** into your hand."
Only `byName` (Flamigo's "up to 3 Flamigo") had ever reached that branch, which is
how it survived. `searchNote` now reads the shared table like every note beside it.

### Deferred, with a named reason
**Superior Energy Retrieval** (sv02-189/-277) is the family's last row and stays
unauthored: "(You can't choose a card you discarded with the effect of this card.)"
means the cost's uids must reach the following `discardPileRetrieval`'s candidate
set — **op → op data flow, which this engine has never needed** (every coupling so
far is inside one op, or through the board). Authoring it without the exclusion
would be strictly wrong and quietly exploitable: discard 2 Basic Energy to pay,
then take those same 2 back plus 2 more. The natural home is a field on
`EffectContext` (already JSON, already carried across a park in
`EffectContinuation`), which is a mechanism slice, not a rider.

## M5 op-slice: the FLOOR, and the cost that is not a discard (engine 0.27.0)
**2026-07-21.** Two mandatory-exactly-N fixes, one on each prompt that could still
say "up to" — and the resume point's #1, which the previous slice's own review
found.

### "Choose 1" is not "up to 1" (`choosePokemonMulti` gained `min`/`max`/`declinable`)
The printed number in a *choose* clause is **exact**; a card that allows a smaller
answer prints the words "up to", and no consumer of `damageChosen` does. The prompt
had only `max`, so **Meowscarada ex / Radiant Blastoise could pay their hand cost
and then place nothing** — an irreversible payment for no effect, reachable in one
click. Written into the rules doc as **§9.1** (the general form of §7.5's "exactly
the printed number").

`declinable` is the third field, and it is not a synonym for `min: 0`:

| card | printed | prompt | legal answers |
|---|---|---|---|
| Meowscarada ex / Radiant Blastoise | "put N damage counters on **1** of your opponent's Benched Pokémon" | min 1, max 1, declinable **false** | exactly 1 |
| Hawlucha | "**you may** choose 2 … and put 1 damage counter on each" | min 2, max 2, declinable **true** | 2 **or** none — never 1 of 2 |
| (Janine's Secret Art, next in) | "choose **up to** 2 of your {D} Pokémon" | min 0, max 2 | 0, 1 or 2 |

Hawlucha is why a floor alone cannot describe this prompt. Its "you may" is
all-or-nothing, and the decline has **nowhere else to live**: `triggers.ts`
AUTO-FIRES optional triggers (the pure-upside doctrine), so the pick it governs is
the only place a player can say no. A `min: 0` would have bought that decline by
also legalizing a half-answer the card does not offer.

**What decides between a prompt and an auto-take is `optional`, not the Bench
size** — and the first draft got this wrong, which the review caught. A mandatory
snipe over a Bench of `count` or fewer has no decision left in it and auto-takes
(the M1 no-choice rule). A DECLINABLE one always has one, and it is the same
decision on a Bench of 1 as on a Bench of 5, so it now parks at every non-empty
Bench; keeping the old forced branch would have honoured Hawlucha's printed "you
may" only when the opponent had 3+ Benched Pokémon, which is precisely where
declining matters least. §8.6 still clamps the ASK (one Benched Pokémon → "you may
choose 1"), because doing as much as you can is about the number, not the
whether.

### `discardFromHandCost` → `payFromHand`, with a required destination
**Dendra** (sv02-179/-250/-266, Supporter): "Put a card from your hand on the
bottom of your deck. If you do, draw cards until you have 5 cards in your hand.
(If you have no other cards in your hand, you can't use this card.)"

Nothing is discarded and the word "cost" never appears, yet every clause of D46's
mechanism is on the card — which is why this is one field wider, not a second op:

| the mechanism | Ultra Ball | Dendra |
|---|---|---|
| a mandatory exact pick out of hand | discard 2 | put 1 under the deck |
| the benefit is conditional on it | "only if" | "**if you do**" |
| the printed play gate, "other" included | "2 **other** cards" | "(If you have no **other** cards…)" |

So the op is renamed for what it does — **pay** from hand — and `to: "discard" |
"deckBottom"` is **required**, the rule `chooseCards.min` set one slice earlier
(every author states it). `handCostUnmet` gates Dendra with no new code; the
rejection, the park heading and the HUD's disabled-card hint all read one new
helper, `handCostAction`, so the printed VERB reaches every surface ("put another
card from your hand on the bottom of your deck", never "discard").

**The event follows the destination's visibility.** `HAND_COST_PAID` gained `to`
rather than splitting in two: cards paid to the discard become public where they
land, cards paid under the deck go hidden → hidden and are never seen again. The
log speaks in counts either way (they came out of a hidden hand) but prints a
different verb, and P4's per-seat filter has the destination to key on. The paid
cards keep the order they were PICKED in — no printed card pays more than one to
this destination, so there is nothing to hide and no rng to spend.

**Order is observable here too** (the D46 property, restated): Dendra + 3 others is
a hand of 3 after the play, 2 after the payment, so the draw is **three**. Paying
afterwards would draw two and end at 4. And the bottom of a SHORT deck is not out
of reach — with 2 cards left, the paid card is drawn straight back the same turn,
which is what paper does and what a "never return the payment" guard would break.

### Skwovet — the same destination, and it needed no op at all
**Skwovet** (sv01-151/-222) "Nest Stash": "Once during your turn, you may shuffle
your hand and put it on the bottom of your deck. If you put any cards on the bottom
of your deck in this way, draw a card." That is `handRefresh` with **Iono's two
riders** — `toBottom` (the deck's order above survives) and `onlyIfAnyMoved` (an
empty hand draws nothing) — in an `oncePerTurn`, `activeOnly: false` AbilityProgram:
the first `handRefresh` reached through an ABILITY rather than the Trainer path, and
the first that can run twice in a turn (two copies, two allowances).

### Landed: 5 catalog rows
Dendra ×3, Skwovet ×2. 1363 → **1395** tests; engineVersion 0.26.0 → **0.27.0**.

### Review — 2 adversarial agents in ISOLATED worktrees, 86 + 67 mutations
Both agents ran on the committed slice in their own `git worktree`, which is how
mutation testing and a clean main tree coexist (they mutate freely, the tree they
mutate is thrown away). No HIGH from engine+rules; **one HIGH from web**.

**The HIGH: `usableAbilities` never mirrored the §7.5 gate.** The Trainer list has
greyed unpayable cards out since D46; the Ability list computed `disabled` from
`activeOnly` + `oncePerTurn` only, so Meowscarada ex with no Basic {G} in hand — a
routine board — rendered fully lit and was refused on click with
`ABILITY_COST_UNMET` and no reason anywhere. Recorded as "deliberate, per D29" a
slice ago; it is not defensible now that the same helper serves the Trainer row,
so Ability rows carry `handCostUnmet` + the printed reason (`title` + sr-only, the
Trainer pattern verbatim).

Fixes that changed behaviour rather than tests:
- **the forced-branch decline above** (engine MEDIUM), the slice's one real logic
  reversal;
- **`dest: "deckBottom"` on the prompt.** The first draft parked with
  `dest: "deck"` and let the dialog infer "Put under deck" from `min > 0` — which
  is exactly the guess `min` exists to prevent, since `discardPileRetrieval` also
  says `"deck"` and there it means SHUFFLED IN. The destination is the engine's to
  state;
- **the Ability rejection message** now reads the same `handCostAction` (it
  hard-coded "discard");
- **rows refuse at the cap with `aria-disabled`** (the ChooseCardsDialog rule this
  dialog had dropped), the multi prompt's `promptKey` carries its candidates and
  bounds, Ability rows name WHERE the Pokémon sits (Skwovet ×2 is the first board
  with two identical Ability labels), and an "up to" pick's Confirm drops the
  denominator it would otherwise print as "1/0".

Test holes each proved by a surviving mutation: the reprint rows (deleting
`sv02-250`/`sv02-266`/`sv01-222` left 1386 tests green — every prior slice ships
this test and this one had not), `HAND_COST_PAID.seat` (unasserted anywhere in the
repo, and the field a P4 filter keys on beside `to`), Dendra's Supporter-ness
(the fixture could have said "Item"), a PADDED multi-choice (the shape that
defeats all-or-nothing: two refs pass the floor, one is not a candidate, and
`placeSnipeCounters` would silently drop it), `applyChoice`'s wrong-kind guard,
Skwovet played from hand rather than placed by surgery, WHICH refs the snipe
dialog dispatches (a dialog sending "the first `max` candidates" passed every
length-only assertion), the live region surviving short→satisfied, and the
declinable-at-zero wording.

## M5 op-slice: §9.2 — a clause that reads what an earlier clause DID (engine 0.28.0)

The engine's first **op→op data flow**, and the mechanism two families had been
waiting on. Everything before this could be decided from `GameState` plus the op
itself. These cannot:

| Printed clause | Card | What it needs |
|---|---|---|
| "If you shuffled any cards into your deck **in this way**, draw 3 cards." | Miriam ×3 | did the earlier op move anything? |
| "**If you do**, draw cards until you have 5." | Dendra ×3 | the same question, on a payment |
| "(You can't choose a card you discarded with **the effect of this card**.)" | Superior Energy Retrieval ×2 | *which* cards the earlier op moved |

### Why the board cannot answer these
A pile after an effect looks the same whether a card got there by that effect or
was already sitting there. Superior Energy Retrieval is the sharp case: it pays
its hand cost **into the very discard pile its next clause reads**, so the two
Basic Energy just spent and the Basic Energy that were already there are the same
kind of card in the same zone. Only the *history* distinguishes them — and without
that distinction the player takes back exactly what they paid, the cost refunds
itself, and a 2-card price becomes a free +2.

### The shape: a named slot, a running record
- **`EffectSlot = "paid" | "moved"`** (effects.ts) — a CLOSED union, so a mistyped
  reference is a compile error. It has to be closed: an unrecorded slot reads as
  "nothing moved", which is indistinguishable from a real empty answer, so a typo
  would quietly cost Miriam its draw with every test still green.
- **`EffectRecord`** (interpreter.ts) — `{[K in EffectSlot]?: string[]}`, threaded
  through `runProgram` / `stepOp` / `applyChoice` as a mutable accumulator, exactly
  like `events`.
- **`recordAs`** on `payFromHand` and `discardPileRetrieval` files the uids
  ACTUALLY moved (not offered, not picked — a wire-dropped uid never moved).
- **Two readers, one record** (the D40 shape): `discardPileRetrieval.exclude`
  removes them from a candidate set, and a new op **`recordGate {slot, then,
  otherwise?}`** branches on whether any were filed.

### `EffectContinuation`, not `EffectContext` — a deliberate deviation
The backlog named `EffectContext` as the home for three slices running. It is the
wrong one. The context is **who** the program runs for: one seat, constant for the
whole program, read by ~30 helpers that would then be holding a value going stale
under them mid-run. The record is the opposite — an accumulator that changes at
nearly every op. Its sibling is **`rest`** ("the ops still to run") on the
continuation, not `seat`. `EffectContinuation.record` is optional and omitted when
empty, so every program that predates §9.2 parks into a byte-identical phase.

### Slot-keyed, not position-keyed — and the first card refutes the cheaper design
The obvious cheaper mechanism is "read the previous op's result". **Miriam kills
it** — though not, as a first draft of this section claimed, at the level of the
print. Miriam prints two ADJACENT sentences; the gap is the ENGINE's, because
"shuffle up to 5 Pokémon into your deck" is authored as a move plus a trailing
`shuffleDeck` (the Pal Pad / Super Rod pattern), putting the referenced op two
upstream. That decomposition is forced: the shuffle must precede the draw, or the
returned Pokémon sit at the deck's BOTTOM in pick order — what "shuffle" denies.
(Not, as also first claimed, because the player would draw cards they had seen:
`retrieveMove` appends to the END of the deck, so a draw-first program deals the
unshuffled pre-existing top and cannot reach the returned cards at all. The
review caught both overstatements by running the mutant.)

**Janine's Secret Art** (sv06.5-059, unauthored) is the print-level proof: "…
Then, shuffle your deck. If you attached Energy to your Active Pokémon **in this
way**, it is now Poisoned" — a whole sentence between the action and the clause.
A trailing shuffle is the commonest clause in the vocabulary, so "the previous
op" would be wrong across the family either way.

### The third gate, and why it is not a `BoardCondition`
`recordGate` splices into runProgram's work queue exactly like `coinFlipGate` and
`conditionGate`, so an op inside a branch can still park. It is **not** a new
`BoardCondition` member, even though `conditionGate` would then have carried it
for free: that union is shared with the printed PLAY gate (`trainerPlayableIf`),
which is checked **before anything has run**. A condition reading an op result
would be answerable in one consumer and meaningless in the other — keeping it out
is what makes the nonsense unrepresentable. It emits no event, for
`conditionGate`'s reason plus one more: the recording op already announced exactly
these cards (`HAND_COST_PAID` / `DISCARD_RETRIEVED`), so a gate event would be a
second telling of one fact.

`handRefresh`'s `onlyIfAnyMoved` (Iono, Skwovet) is the same idea confined to ONE
op — which is all those cards need, since their move and their draw are the same
op. This is that idea BETWEEN ops, and across a park.

### The record is keyed by UID, not by card id
Superior Energy Retrieval bars the two Energy *you just discarded*, not "Energy
like the ones you discarded" — a second copy of the identical print already in the
pile stays choosable. That is the printed sentence read literally, and it is the
reason the record carries uids. (Note the contrast with D42's interchangeable
collapse, which keys a Basic Energy by what it PROVIDES: there the question is
"which of these should I pick", where copies really are the same; here it is
"which physical card was it", where they are not.)

### Where the recording actually happens — both paths
Both recording ops PARK, so nearly every recording is made on the resume path
(`applyChoice`, reached through `resolveEffect`). But `payFromHand` also resolves
INLINE when its offer is no bigger than `count` — the ordinary late-game hand with
nothing to spare — so the recording exists in `stepOp` too. A record written on
only one of the two paths would leave exactly the tightest hand refunding its own
payment.

### Landed: 5 catalog rows
Miriam ×3 (sv01-179/-238/-251), Superior Energy Retrieval ×2 (sv02-189/-277), plus
Dendra re-authored so its printed "If you do" is stated in the program rather than
resting on a gate in another file. Both `payFromHand` and `discardPileRetrieval`
backlog rows are now closed except for Pelipper (an Ability). 1395 → **1446**
tests; engineVersion 0.27.0 → **0.28.0**.

### Review — 2 adversarial agents in ISOLATED worktrees, 49 + web mutations
**Engine+rules: NO HIGH.** 49 mutations, 42 killed, 7 survivors argued equivalent
(`validateChoice` proves every pick is a distinct member of the offer, so the
apply helpers' defensive filters have no reachable differing input). It verified
D14 replay through a JSON round-trip at *every* park, deep-freeze purity, card
conservation across five degenerate zone states, 8 garbage wire shapes, and all
six printed texts verbatim. Its three MEDIUMs were all **test holes**, each fixed
with the test that kills the mutant, and the first is the sharpest:

- **the slice's headline claim was never exercised** — `resumeProgram`'s
  `{...cont.record}` could be replaced with `{}` and all 12 original tests passed.
  Neither shipped card *reads* `cont.record`: both record and read inside one
  `runProgram`. The assertions pinned the **storage**, not the **carry**. Closed
  by a program that records, parks on a LATER op, then gates.
- **3 of the 5 new registry rows were unpinned** — the reprint ids could be
  deleted or misrouted with the suite green (the exact test `deckBottom.test.ts`
  ships for Dendra, and the third slice running to need it).
- **resume-seeding purity was unproven** — seeding by aliasing survived; a
  deep-freeze test now proves the stored record is never written through.

**Web+integration: ONE HIGH, and it is a design gap the engine review could not
see** — *the prompt described half the card*. Miriam's dialog said "Shuffle up to
5 Pokémon from your discard pile into your deck." with a button reading "Take
none", and **nothing anywhere mentioned the 3 cards**. Every prompt note before
§9.2 was the whole printed effect, because an op WAS the whole effect; a recording
op is the first that is not, so declining silently forfeited the draw *and* the
turn's only Supporter — and the `recordGate`'s false arm emits no event, so the
log said nothing either. Fixed in the engine, not the web: a parking op that
records now looks DOWN THE QUEUE for the gate that reads it and appends the
printed conditional (`withConsequence`). Dendra's cost prompt is now its printed
sentence verbatim. The describer is deliberately tiny and **silent on anything it
has no phrase for** — a partial consequence is worse than none.

Three MEDIUMs were **false claims in this slice's own prose**, all corrected at
the source, and they are the reason the review is worth its cost:

- "Miriam prints retrieve → shuffle → in this way" — **it does not**. Miriam
  prints two ADJACENT sentences; the gap is the engine's decomposition. Janine's
  Secret Art is the print-level proof and now carries the argument.
- "drawing first would hand the player cards off a deck top they have just seen"
  — **runtime-disproved**. `retrieveMove` appends to the deck's END, so a
  draw-first program deals the unshuffled pre-existing top and cannot reach the
  returned cards. The real reason is that they would sit at the BOTTOM in pick
  order, which is what "shuffle" denies.
- `discardPileRetrieval`'s self-match tripwire read "every card in scope is an
  Item…" — **Miriam is a Supporter on that op**, so the stated reason had rotted
  this slice; reworded to the still-true one (no card's filter matches its own
  category).

Also applied: the retrieval note carries SER's printed exclusion parenthetical
(the player watches those cards land in the public discard, so an offer that omits
them without explanation contradicts the board); a whiffing retrieval now files an
EMPTY answer rather than leaving a stale slot, so the two recording ops agree; and
Confirm's verb follows the engine's `dest` ("Shuffle 2" into the deck, "Take 2"
into hand) — wrong on Pal Pad and Super Rod since 0.15.0 and untested until now.
The web agent's 11 DOM tests also closed `DISCARD_RETRIEVED`'s log copy, which had
been unpinned in BOTH arms since engine 0.15.0.

### Recorded, not fixed
- **Miriam is playable into an empty discard**, spending the turn's only Supporter
  for a bare deck shuffle, and **SER is playable into a discard with no Basic
  Energy**, spending 2 cards for nothing. Both follow the shipped doctrine
  (ruling/284: a shuffle is an effect; SER matches ungated Energy Retrieval
  exactly), but Miriam is the first SUPPORTER on this op, where a whiff costs the
  turn rather than a card. The prompt is the mitigation, not the gate.
- **`promptKey`'s `chooseCards` bounds are unpinned** (dropping `min`/`max` from
  the key leaves the suite green). Unreachable today — hand uids and discard uids
  never collide — but SER is the first shipped card to park twice on one prompt
  kind, so the hole is now load-bearing for the next one.
- **`GameLog` announces only a batch's LAST row** — Miriam is the worst-shaped
  batch yet (retrieve / shuffle / draw), and the silenced row is the one saying
  what the card did.

## M5 op-slice: attachFromDeck as built (engine 0.29.0)

**SEARCH your deck for Energy and attach it straight onto your Pokémon** — the
deck-search sibling of `attachFromTop`, and the slice that turned the resume
point's one-card row (Janine's Secret Art) into a family. The catalog is what
reframed it: five distinct cards print "search your deck for … Energy … and
attach", and they differ only in the target rule and in a drawback.

### The op shares a prompt with `attachFromTop`, and differs only where the SOURCE forces it

Both ops answer the same printed clause — several cards, several places, chosen
together — so both park on the `attachCards` MAP prompt. Every difference falls
out of reading the WHOLE deck instead of a window on its top:

| | `attachFromTop` | `attachFromDeck` |
|---|---|---|
| source | the top `n`, an ordered window | the whole deck |
| candidate size | small by construction | a real list holds a dozen Basic {R} |
| collapse | none needed | at most `max` per interchangeable class |
| leftovers | `discardRest`, or a trailing shuffle | none — nothing ever left the deck |
| `max: "any"` | Hydreigon prints it | no printed search does |

The **collapse** is the substantive one. `interchangeableCandidates` already
existed for the mandatory discards (D42), keyed by `cardIdentity` — a Basic
Energy keys on what it **provides**, because the catalog prints the same Basic
Darkness Energy under four ids (sve-007/-015/-023, sv06.5-098). Offering twelve
identical rows for a pick of three is one question wearing twelve hats; the cap
is `max` per class rather than 1 for D42's reason, that a pick of three off one
class needs three rows to be answerable at all. The discard version keys the HOST
in as well (which Pokémon loses an Energy is always a real choice); here there is
no host — a card in a pile is attached to nothing — and that asymmetry is the
whole content of the difference.

### Two printed target rules, and the second is why the first is load-bearing

- **"in any way you like"** (Charizard ex) — no rider. Any split, including all
  three on one Pokémon.
- **"For each of those Pokémon … attach it to THAT Pokémon"** (Janine) —
  `maxPerTarget: 1`. One apiece onto distinct Pokémon; stacking both is not a
  legal answer.
- **"attach it to THIS Pokémon"** (Pawmot) — `toSelf`, added one slice later
  (D50) once `EffectContext.sourceUid` existed: the sole target is the Pokémon
  whose effect is running, resolved by board TOP uid. Its precedence over the
  other riders is stated in the op's doc (it ignores `targetType`/`benchOnly`;
  `maxPerTarget` would still cap) — authoring it alone is the rule, the doc is
  the enforcement.

A card prints "in any way you like" exactly when the split is free, so the
absence of the phrase is **not silence, it is the other rule** — written into
`ptcg-rules.md` §15.E. `maxPerTarget` lives on the OP rather than in
`AttachTargetRiders` because the riders answer a per-Pokémon question ("may this
one receive") shared with `attachEnergyFrom`, while this constrains the map as a
whole.

### Janine parks ONCE, and that is a claim about the card

Read literally the card asks two questions: which Pokémon, then which Energy for
each. The second has no content — same-type Basic Energy is fungible, the
doctrine `attachEnergyFrom` has asserted since M4 ("the only decision is the
TARGET") — so "choose up to 2 of your {D} Pokémon, one Energy each" and "attach
up to 2 Basic {D} Energy to distinct {D} Pokémon" are the same decision, and the
existing map prompt already says it. Modelling the printed first sentence as its
own `choosePokemonMulti` would have added a park that asks nothing.

This is why the slice does **not** consume §9.1's `min: 0` end after all — the
resume point expected it to. Saguaro still wants it (`healChosen` with a count),
and it stays on the list.

### `recordGate.contains` — a §9.2 gate that asks WHERE, not whether

"If you attached Energy to your **Active** Pokémon in this way, it is now
Poisoned." The record files the uids actually attached, exactly as D48's two
recording ops do, and the new `contains: "yourActive"` narrows the gate from "did
anything move" to "did any of it land on the Active". Two Energy onto the Bench
records two uids and poisons nothing — and that is the player's choice to make,
so a gate firing on any attach at all would be removing something the card grants.

**The narrowing reads the BOARD, not the record**, and that is deliberate: the
record's values stay one kind of thing everywhere (the cards an op moved), and
"where did it end up" is answered where every other board question is.

But "was attached there by that op" and "is there now" are **not the same
question**, and a first draft of this section claimed they were — that no op in
the vocabulary could separate them. Three can, and none is exotic:
**`switchActive`** (a different Pokémon is now Active, so the filed uids sit on a
benched one), **`moveEnergy`** (own → own, which can take the filed card off the
Active) and **`discardEnergy`'s `yourActive` arm** (the card is gone). No printed
card puts any of them between an attach and its "in this way" clause, and Janine
runs attach → shuffle → gate — so this is **safe as authored and unsafe as a
general rule**. The op's doc names the three, and records the likely answer if a
card ever needs one: file the HOST rather than widen the gate.

`withConsequence` needed the condition as well as the consequence: it hardcoded
"If you do, …", which is right for Miriam and **quietly wrong** here — a player
reading "If you do, it is now Poisoned" would take the poison for a certainty of
attaching at all and put both Energy on the Bench expecting it. `describeBranch`
grew its third phrase (`applyStatus`, self arm only), still silent on anything it
has no words for.

### The play gate, again — and this is the sharpest form of that call so far

Ungated, for `attachFromTop`'s reason: every card carrying this op also prints
"Then, shuffle your deck", a clause that always resolves, so "no eligible target"
is never "no effect" (ruling/284). But the precedent is weaker here than anywhere
it has been used before — Electric Generator is an ITEM, and **Janine is a
SUPPORTER** (§7.2, one per turn), so her whiff costs the turn's Supporter play
rather than a card. Same call as Miriam one slice ago, and the same mitigation:
the prompt, not the gate.

### Landed: 6 catalog rows
Charizard ex ×4 (sv03-125/-215/-223/-228) — also the first registry row reached
through an `onEvolve` trigger AND through Rare Candy, since D28's shared
`placeEvolution` runs both. Janine's Secret Art ×2 (sv06.5-059/-088) — the first
registry program to author `applyStatus` at all (every earlier one came from the
attack deriver), and the first card in the repo that poisons its OWN Active.
1446 → **1486** tests; engineVersion 0.28.0 → **0.29.0**.

### Deferred, each with a named blocker
- **Pawmot** (sv01-076/-209) "Electrogenesis" — "attach it to **this Pokémon**".
  `EffectContext` carries no source uid, the same wall `discardEnergy`'s
  `yourActive` arm documented. Unblocking it unlocks a family, and it is the
  cheapest structural row left. **(LANDED one slice later — D50,
  `EffectContext.sourceUid` + the `toSelf` rule above, engine 0.30.0.)**
- **Forretress ex** (sv02-005/-230) "Exploding Energy" — "If you searched your
  deck in this way, **this Pokémon is Knocked Out**". A §9.2 gate into a KO by
  EFFECT, which no op can do: flow.ts owns every Knock Out and the interpreter
  never touches the tail (D23/D25). **(Since D50 this is the WHOLE blocker: its
  attach is Charizard's "in any way you like" shape, and "this Pokémon" is now
  expressible — only the self-KO gate is missing.)**
- **Geeta** (sv03-188/-218/-226) — the attach itself is this op with a
  single-target cap, but "During this turn, your Pokémon **can't attack**" is a
  turn-scoped restriction that does not exist yet.

### Web — one field, and it is the first prompt that can refuse a legal-looking pairing
`AttachCardsDialog` gained `maxPerTarget`: a target already holding its one Energy
renders refused (`aria-disabled`, "has one"), and `promptKey` carries the field,
since an assignment gathered under "in any way you like" is not a legal answer to
a one-apiece prompt. One case had to be designed rather than translated: with ONE
eligible {D} Pokémon, "up to 2" is a hard 1, and picking the second card would
strand it against a list of rows that all refuse it. It is folded into the
dialog's existing `atCap` so the pick is refused UP FRONT, with the live region
explaining why "Attaching 1/2" is as far as it goes — the alternative left the way
out (tap the card again) to be guessed.

No new events, so no new log rows. **(One slice later — D50's review — the
dialog gained the sole-target commit: an offer whose target list holds ONE
Pokémon attaches on the card tap, "a list of one is not a decision". See the
sourceUid as-built section below.)**

### Review — 2 adversarial agents in isolated worktrees, 69 + 46 mutations
**Engine+rules: ONE HIGH, and it was a claim rather than a behaviour** — the same
one this session had already caught mid-flight, but the review found *four*
divergences where I had found one. "The two readings coincide" is false against
the op union, and not only for the reason recorded above: **`moveEnergy`'s
`benchToActive` route produces a false POSITIVE** (attach to the Bench, move it
up, get poisoned for an attach that never touched the Active), which the
detach-only framing misses entirely. All four are pinned as tests now.

Three more, all real:
- **the prompt's `max` lied** whenever `maxPerTarget × targets` was the true
  ceiling — Janine on the ordinary one-{D}-Pokémon board printed "up to 2" over a
  board where 1 was the maximum, which is exactly the dishonesty
  `attachFromTopOffer`'s own doc says its clamp exists to prevent. Now a third
  ceiling in the same `min`, taken BEFORE the collapse so the offer holds no
  representative the pick could not use. (The review declined this one as
  "looks deliberate" — it was not, and the rules-doc paragraph it read as intent
  was about the RULE, not the prompt.)
- **the whiff filed nothing where its two sibling recording ops file `[]`** — with
  three recording ops, the third disagreed by accident.
- the Charizard fixture sat under a "verified verbatim" banner with **three**
  undeclared deviations, the sharp one being that Charizard ex is a **{D}**
  Pokémon that merely attacks with {R}. Corrected in the data, not just the note.

Of 69 mutations, **15 survived the suite as first written**; the review's 33 new
tests kill 11, and three of those mattered — a mutant that **duplicates a card**,
one that **throws out of `applyAction`** (a D14 breach), and one that files the
*picked* uids rather than the *attached* ones.

**Web+integration: TWO HIGHs, both "a claim asserted in prose with no test under
it"** — the failure mode this repo keeps rediscovering, and both were in the new
test file's own header.
- **`maxPerTarget` rides `promptKey`** was listed as a case "below" and had none:
  deleting the field from the key left all 1524 tests green. The consequence is
  concrete — an assignment gathered under "in any way you like" survives into a
  one-apiece prompt, the dialog reads "Attach 2", and Confirm dispatches an answer
  the engine rejects with a pill that cannot say which pairing was wrong.
- **the log test's `texts()` helper discarded `entry.who` entirely**, so no
  assertion in the file could see a seat — under a test named "names BOTH
  attaches" that only checked "some row mentions Energy". Two mutants survived it:
  the self-poison filed under the **opponent's** seat, and one of Janine's two
  attaches never logged. Janine is the first `STATUS_APPLIED` in the game filed
  under the controller's OWN seat, which is precisely why the seat rule exists.

Also fixed: `tapCard`'s toggle-off — the documented "way out" of a pending pick,
and the only one, since the dialog has no decline and `HudDialog` swallows Escape
— was untested; and my own `noRoom` comment illustrated the feature with a board
the clamp above had just made unreachable, contradicting a sibling test 60 lines
away. One finding the review left as a design call is fixed here rather than
deferred: a full target row **replaced** its spot with "has one", against the
rule three lines above it, on exactly the board Janine creates (two identically
named {D} Pokémon). The spot now rides the state instead of being replaced by it.

1446 → **1526** tests.

### Recorded, not fixed
- **The P4 `pendingDecision` leak is qualitatively worse on three axes**, and the
  earlier note's wording ("the controller's private **deck-top** uids") is now the
  narrower half of the truth. (1) **Scope** — `attachFromTop` leaked "these are
  among your top N", a bounded window; this leaks "these are somewhere in your
  deck". (2) **A new kind of read: a hidden-zone COUNT by type.** When the collapse
  yields fewer than the printed `max`, the opponent reads off how many matching
  Basic Energy remain in the deck — Janine distinguishes 1 from ≥2, Charizard 1/2/≥3.
  No other prompt leaks that. (3) The older note's own axis — a shuffle-leftovers
  card's unattached candidates never become public by another route — now covers
  **every** declined candidate here, because this op emits no search event at all.
  Bounded by the interchangeable collapse (≤ `max` uids per class), which is the
  one thing that keeps a deck-wide list from crossing.
- **`maxPerTarget > 1` has no printed consumer.** The field is `number` and Janine
  is the only card, at 1; the plural note branch is reachable only from a test.
- **A full target row's disabled STYLING is unpinned** (no test in the game feature
  asserts a class string — house style), and `promptKey` still omits `max`
  (pre-existing).
- **`GameLog` announces only a batch's LAST row** — fifth slice running. Janine's
  batch ends on the poison, which is at least the interesting row; Charizard's ends
  on `SHUFFLE`, so its three attaches are silent.

## M5 op-slice: EffectContext.sourceUid as built (engine 0.30.0)

**The context now names the Pokémon whose effect is running** — `sourceUid?:
string`, the printed "this Pokémon", a FIELD rather than an op. Three places had
documented the wall in so many words (`discardEnergy`'s `yourActive` arm, the
attachFromDeck deferred list, the M4 slice-2 notes above), and the unblocking
was plumbing, not information: every run site already had the uid in scope.

### Set wherever the runner knows it, absent where there is nothing to know

| Run site | sourceUid |
|---|---|
| `useAbility` | the Ability's own Pokémon (the uid already keyed the once-per-turn stamp) |
| `runBoardTrigger` / `runCheckupTriggers` | the triggering Pokémon (the uid already rode `ABILITY_TRIGGERED`) |
| `runKoTrigger` | the KO'd Pokémon — a card that has LEFT play, named honestly; a source-reading op finds no board top and whiffs |
| attack path | the attacker **by uid**, not "the Active" — a program that moves its own attacker cannot stale it |
| `playTrainer` | **absent** — a Trainer has no "this Pokémon" |

Absence is structural: a Trainer's parked context serializes byte-identical to
the pre-slice `{seat}` (the §9.2 absent-when-empty promise, applied to a second
field). The value is constant for the whole run, like `seat` — the accumulator
shape stays on `EffectRecord` (D48's reasoning) — and rides `EffectContinuation`
across parks (JSON, D14).

### The first reader: `attachFromDeck.toSelf`, and resolution by board TOP

`sourceRef` resolves the source to a zero-or-one-element target list: the
controller's in-play Pokémon whose **top card** is the source uid. Top, not
stack membership, deliberately — a source **evolved over is a different
Pokémon** (the old top's "this Pokémon" no longer exists), and gone-from-play
likewise; both fall into the op's standing whiff path, where the printed
trailing shuffle still runs. Written into `ptcg-rules.md` as **§9.3**, along
with the LATENT gap the review's audit established: `sourceRef` would
RE-ACQUIRE a source that left play and RETURNED as a board top mid-program —
unreachable at HEAD (nothing in the op vocabulary returns an in-play card to
the board mid-program), but "a returned Pokémon is a NEW Pokémon", so the
first revival/self-recovery op must revisit it.

### Landed: 2 catalog rows

**Pawmot** (sv01-076/-209), "Electrogenesis" — `oncePerTurn`, **`activeOnly:
false`**, and the second flag is the card's whole point: a **benched Pawmot
feeds itself**, the sentence no seat-relative target rule could say. The park
stays declinable (a search of a hidden zone may be failed on purpose —
`ptcg-rules.md` §9.1), so the printed bare article does not make the pick
mandatory. The fixture shipped verbatim with zero deviations, independently
re-verified against D1 — the D49 banner lesson, held.

What this did and did not unblock: **Forretress ex** stays deferred on the
self-KO gate alone (see the narrowed note above); **Geeta** on turn-scoped
restrictions; and `discardEnergy`'s self-side arm still has no printed consumer
wanting the source — its wall comment now says the context HAS the uid, and
what is missing is an arm that reads it.

### Web: no new anything — and one deliberate behaviour change

A `toSelf` park is an `attachCards` prompt whose target list holds ONE fixed
Pokémon, and the review's design MED was that the dialog demanded a tap on that
list anyway — against the house **"a list of one is not a decision"** rule
(D44, `MoveEnergyDialog`'s sole-destination pre-choose). `AttachCardsDialog`
now **commits the attach on the card tap** when `targets.length === 1`
(`soleTarget`): the target list never mounts, and the `<output>` copy is
mode-aware. This reshapes Janine over a lone {D} Pokémon too, and the D49 DOM
tests were rewritten to the new interaction (the promptKey tests' carryover
device is now a stale committed ASSIGNMENT rather than a stale pending pick).

### Review — 2 adversarial agents in isolated worktrees, 43 + 33 mutations

**Engine+rules: ONE HIGH, the recurring pattern — a false coverage CLAIM, not
wrong behaviour.** The "board TOP, not stack membership — deliberately" doc and
the shipped evolved-over test claimed the discrimination, but the stale-uid
test sat its uid in the DECK, so **three wrong implementations**
(Active-by-stack-membership, bench-by-stack-membership, bench-by-base-uid)
passed the entire suite — under any of them, a source evolved over
mid-continuation attaches to the EVOLUTION. Closed by evolved-over tests on
both arms. The MED is the same lesson at the next altitude: every shipped board
benched ONE Pawmot at slot 0, so hard-coded-index-0 and match-by-catalog-id (a
two-Pawmot board resolves the WRONG copy) both survived; the closing board also
pins the per-uid once-per-turn stamp. LOWs: the `toSelf` exclusivity doc
claimed a rule the code doesn't enforce (reworded to the honest precedence),
and the cross-id collapse test was seed-vacuous-able (both prints now pinned
present in the deck). 43 mutants: 41 killed — 34 by the pre-existing suite, 7
only by the review's 11 new tests — and 2 equivalent, one being
`runCheckupTriggers`' threading, which nothing can observe today (no
betweenTurns program parks or reads the source).

**Web+integration: NO HIGH.** Besides the sole-target change: the `activeOnly`
mirror in `usableAbilities` was implemented but completely untested — deleting
it left all 1545 tests green, the exact lit-row-refused-click HIGH of D47, this
time on a benched Chien-Pao; pinned both directions. And `promptKey`'s
attachCards `targets`/`max` segments were comment-enforced only (mutants
dropping either survived); pinned via the belt technique. Also verified: the P4
`pendingDecision` leak is unchanged in KIND — a `toSelf` offer leaks strictly
LESS than Janine's (a 0/1 hidden-zone count by type) — and `GameLog` still
announces only a batch's LAST row, so Pawmot's attach is silenced by the
trailing `SHUFFLE`. Sixth slice running.

1526 → **1561** tests; engineVersion 0.29.0 → **0.30.0**.

## P3-M5 build session #36 (2026-07-22) — healChosen.upTo: §9.1's `min: 0` end lands (D51)

### One field, not a new op — and the field name carries the printed words

**Saguaro** (sv02-187/-255/-270, Supporter — identical text on all three
prints, verified verbatim against the local D1): "Choose up to 2 of your
Pokémon and heal 50 damage from each of them." Three slices after D47 reserved
the range, this is the **first consumer of `choosePokemonMulti` with
`min ≠ max`** — the prompt every earlier consumer used at `min === max`
finally asks a question whose partial answer is legal.

The op widening is `healChosen.upTo?: number`, and the name is deliberate:
`damageChosen.count` means EXACT (§9.1's headline — "choose 1" is not "up to
1"), so reusing `count` for a floor-0 pick would have made the field's meaning
depend on the op. `upTo` spells the printed words; an exact multi-count heal,
if one ever prints, gets its own field rather than a silent reinterpretation.
Absent `upTo`, the single arm (Potion / Fighting Au Lait / Arboliva's "all")
is byte-untouched — still `parkOrForce` onto `choosePokemon`, still
auto-resolving at one candidate, because an EXACT mandatory pick over one
candidate has no decision left. The `upTo` arm parks at **every non-empty
board** — `{min: 0, max: min(upTo, in play), declinable: false}` — the
declinable-snipe rule from D47: the take-fewer right is the same decision over
one candidate as over six, and `min: 0` IS the printed decline, so the
`declinable` flag stays unset (the prompt-doc rule).

Two candidate calls, both the printed clause read literally:
- **Candidates are ALL your Pokémon, damaged or not.** The printed choose
  clause has no damaged restriction; an undamaged pick heals 0 and emits
  nothing (the single-arm rule since M4). Filtering to damaged would have been
  a second unprinted rule hiding inside the offer.
- **The play is UNGATED** — a full-HP board can spend the turn's Supporter on
  nothing. `programPlayable` has never had a heal branch (Potion and Fighting
  Au Lait are the same call), so Saguaro follows shipped doctrine rather than
  deciding it mid-slice; the honest "Take none" in the prompt is the
  mitigation, and the wart stays on the carried-forward list, now three cards
  wide.

`healUpToNote` quotes the card with the §8.6-clamped number ("Choose up to 1
of your Pokémon…" over a lone Active — the ask clamps, the whether survives).
The `applyChoice` arm folds the picked refs through the existing single-target
`healChosen` helper — one HEALED per damaged pick, each clamped to its own
damage, `[]` a legal no-op resolve.

### The web needed ZERO source changes — and that claim is now pinned

`ChoosePokemonMultiDialog` was written for this day: `short` can never be true
at `min: 0`, so Confirm is always live, reads "Take none" at zero picks and
"Confirm N" (no denominator — nothing is owed) for partials; the live region
says "Pick up to 2 (0/2)."; `promptKey` already carried min/max/declinable.
What did NOT exist was any test with `min ≠ max` — the dialog's "up to"
branches were four comment-documented dead paths. Two DOM tests now drive the
Saguaro park end-to-end: the partial confirm pins WHICH ref is dispatched (a
dialog sending the first N candidates fails it), and the decline pins the
empty dispatch.

One test-surgery lesson worth keeping: `fix-basic-1` has 60 HP, and a
program-completion settle sweeps BOTH boards — so a test that leaves an
unhealed own Pokémon at damage ≥ 60 when the program settles gets it KO'd
mid-assertion. Real play cannot reach that state (damage ≥ HP is swept at
every source); surgery keeps persisting damage sub-lethal.

### Review — 2 adversarial agents in isolated worktrees, 34 + 8 mutations

**Engine+rules: NO HIGH, NO MED — and no false coverage claim at all, the
first such slice in three.** 34 mutants, 32 killed by the shipped suite; the
2 survivors both argued equivalent: `healUpToNote`'s `"all"` arm is dead code
(no printed consumer authors `"all"` + `upTo`, and its doc says so — a
declared-ready phrase, not a false claim), and `healChosen`'s own-seat guard
sits behind refs already validated against own-board candidates at all three
call sites (the runCheckupTriggers precedent — defense nothing can observe).
A 13-shape garbage probe (null refs, foreign seats, NaN indexes) all rejected
`BAD_EFFECT_CHOICE` with the state byte-identical (D14); all three reprint
rows are independently load-bearing (deleting any one fails its own test);
the fixture text is byte-equal to D1 on every id. The rules-fidelity LOW
worth recording: under TPCi's state-change doctrine Saguaro would be
UNPLAYABLE on a fully-healed board — the missing play gate is the real paper
divergence (`min: 0` itself is sound; no ruling forbids a 0 answer to a
visible-zone "up to" once the card is legally played) — and it is the
declared, carried-forward wart, now three cards wide.

**Web+integration: NO HIGH; its MED is the recurring shape** — `promptKey`'s
`pokemonMulti` arm was entirely UNPINNED: gutting the whole key to the bare
string `"pokemonMulti"` survived every test (the sibling chooseCards /
attachCards keys both have dedicated remount tests). The hazard is LATENT —
no live path parks this prompt twice with no render between (§7.2 blocks two
Saguaros a turn, and the `turn:action` render between any two parks unmounts
the dialog) — but the key's own doc claims the discrimination, so it is now
pinned by the attachCards belt technique: a real park, one prompt field
swapped, the stale pick must not survive the rerender — all four segments
(min / max / declinable / candidates), verified to kill both surviving
mutants. The web mutation table also proved the two NEW DOM tests are the
SOLE killers of the "up to" surfaces (the live region's "up to" phrasing and
the denominator-free Confirm) — the dialog's `min ≠ max` branches really were
dead paths until this slice. LOWs: Saguaro's row never travels the HUD button
in a test (scratch-verified lit ⇔ engine-accepts, including the undamaged
board — NOT the recurring lit-row-refused-click HIGH); and the batch
announcer still speaks only a batch's LAST row (7th slice): a 2-pick resolve
announces one HEALED of two, and a decline announces nothing after "played
Saguaro" — which now covers three distinct outcomes (declined, all-undamaged
picks, healed-then-silenced).

1561 → **1576** tests; engineVersion 0.30.0 → **0.31.0**.

## P3-M5 build session #37 (2026-07-22) — the reveal-and-bottom family, and the OPPONENT's decision (D52)

**Ortega ×2** (sv03-190/-219, Supporter) and **Greavard "Underworld Stroll"**
(sv01-105, DERIVED). Two ops, and the second of them is the slice's real
content: *a card can put a decision on the player who did not play it.*

### `bottomFromOpponentHand` — Miriam's shape, across the table

Ortega authors as `[bottomFromOpponentHand recordAs:"moved", recordGate
slot:"moved" then:[opponentMayDraw 1]]` — structurally D48's Miriam, with both
halves pointed at the opponent. Three calls are worth recording:

**The reveal is TOTAL, PUBLIC and FIRST.** New event `HAND_REVEALED` carries
*every* uid — the only hand event in `events.ts` that is not count-only, and the
exception is principled rather than convenient: the count-only rule protects
cards in a hidden zone, and a reveal is precisely the moment those cards stop
being hidden. It is emitted before the pick parks, and on the auto-resolving
path too (a single-class hand still reveals before it bottoms), so the event
sequence tells the story in printed order on both branches.

**The bottomed card is NAMED, where Dendra's is not.** `CARD_TO_BOTTOM_OF_DECK
{seat, uid, actor}` against `HAND_COST_PAID {..., to:"deckBottom"}`'s bare
count. Same destination, opposite visibility: Dendra's payment goes hidden →
hidden and only the payer ever knew it, while this card was just revealed and
picked in the open, so which card sits on the bottom is real public information
and the log is where it lives. **The event follows the move's visibility, not
its destination** — which is the rule the two rows together now state.

**The offer collapses per interchangeable class**, keyed by `cardIdentity` (the
D49 key — the catalog prints one Basic Energy under several ids, and two of them
in a hand are one answer wearing two uids). This is the interesting half: the
identical collapse in `payFromHand` **leaks**, because that offer names cards in
a hand that stays hidden, so `candidates.length` against the public hand size
says how many cards are copies. Here the whole hand went out in `HAND_REVEALED`
one step earlier, so the offer's shape has nothing left to give away. Same
mechanism, opposite verdict, and the difference is entirely *what the player was
already shown*.

### `opponentMayDraw` — the first NON-CONTROLLER decision

Every park before this one was answered by the program's controller. Even the
on-KO trigger, which parks during the opponent's turn, is answered by the
*controller of that sub-program* — `EffectContext.seat` and the answering seat
had never diverged. "Your opponent **may** draw a card" is the first printed
sentence where they must.

The mechanism is deliberately thin: `RunResult.parked` gained an optional
`decider`, `settleProgram` files it as **`phase.answerer` beside the existing
controller `seat`**, and `resolveEffect` gates on `phase.answerer ?? phase.seat`.
Three consequences fall out of filing it *beside* rather than *instead of*:

- `phase.seat` keeps its one meaning everywhere (the program's owner — where
  control returns, whose allowances are spent, what the projection's
  `activeSeat` reads), so no existing reader had to be re-examined;
- the field is **absent when the answerer is the controller**, so every park
  predating this slice serializes byte-identically (the §9.2 record's rule,
  applied a third time);
- the turn does not move. `waitingSeat` follows the answerer, `activeSeat` does
  not — the opponent answers a question in the middle of a turn that is still
  the controller's, and the board's turn glow must not say otherwise.

`EFFECT_PENDING`'s seat became `decider ?? controller`, since that event's own
doc says it names the seat that must resolve. The op **never parks when the
opponent's deck is empty** (both answers leave the same state — the M1
no-choice rule); note Ortega itself cannot reach that case, because the card it
just bottomed *is* their deck, which makes "bottom their last card, they may
draw it straight back" a real and rather pleasing printed corner.

Rules doc **§9.4**.

### Greavard derives; Ortega is authored

The attack twin prints Ortega's first sentence with a Supporter filter and no
second sentence, so it is deriver rule 13 (`REVEAL_BOTTOM_SUPPORTER`) rather
than a registry row — and it *has* to be, because `CardProgram.attack` is
per-CARD while Greavard's second attack (Sharp Fang) is a plain 30 that must
stay plain. The regex sweep over all 978 catalog rows × every text surface
matched exactly one row, with no false positives and no misses in its family.

### The play gate, and why it does not contradict D45

`programPlayable` refuses Ortega into an **empty opponent hand**. That looks
like the veto D45 removed, and is not: D45's reversal turns on
`programPlayable` being an AND over ops, so vetoing one op vetoes a card whose
*other* printed clause always resolves. Ortega has no such clause — its second
sentence is a `recordGate` on the first — so over an empty hand the whole card
does nothing, which is the Catcher/Hammer class under ruling/906 + ruling/284.
The gate reads hand **LENGTH and never the op's filter**, because a non-empty
hidden hand's *contents* are exactly what the game state does not establish
(the Poké Ball line) — and a gate that peeked would also leak, telling the
controller "no Supporter in there" before they spent the card.

`programPlayable` is now **exported**, and the HUD mirrors it for Trainers *and*
Abilities. That closes the finding this project has now logged four times (a row
rendered lit and refused on click, with the reason nowhere) — at the source
rather than per-card, since the predicate that rejects is now the predicate that
greys. It is a visible change well beyond Ortega: Boss's Orders, Switch,
Pokémon Catcher, Crushing Hammer, Energy Switch, Poppy and Giacomo all grey out
on boards where they were previously lit and dead.

### Web

One new dialog — `MayDrawDialog`, the first prompt this HUD shows to the seat
that did *not* act, mid-turn. It holds no state (both buttons dispatch on the
tap), names the deciding player outright (the handoff banner that normally does
sits **outside** the modal, hence inert once `showModal()` runs — on a hot-seat
device the wrong player is holding it), swallows Escape (the decision is owed;
`HudDialog` only calls `showModal()` on mount, so a dismissed dialog would never
return and the game would need a reload), and puts **Draw first in the tab
order** so that Enter cannot silently forfeit a card.

It deliberately has **no `<output>`** and **no `promptKey` arm**, against the
house pattern in both cases, because both exist to serve state this dialog does
not have: a live region earns its place by announcing a *change*, and a prompt
key by resetting *picks*. A first draft added the key arm with a comment about
stale labels; gutting it to a constant passed all 1612 tests, which is what
"nothing observable" looks like. `kind:note` already gives it a per-count
identity.

The projection withholds `pendingDecision` from a **non-answerer** — narrowly,
because handing the prompt to both viewers is D17's deliberate contract for
every other park (three tests pin it) and reversing that wholesale is a named P4
job. What this slice owed was the hole it opened: "who may see the prompt"
stopped being a tautology the moment an answerer could differ from the
controller, so the redaction lands exactly there.

Two log rows, both filed by the rule their sibling established: the reveal under
the seat whose hand it is (the chip names them), the bottoming under the
**actor**, naming the owner outright because there the chip does not.

### Review (2 adversarial agents, ISOLATED worktrees; 87 + 44 mutations)

**One HIGH each, and both were false CLAIMS over untested guards** — the fourth
slice running where that is the shape. Engine: the deriver test said it pinned
the ANCHORS while both its negatives were refused by the pattern *body*, so
dropping `^`/`$` passed all 722 tests where the same mutation on two sibling
rules dies immediately. Web: the `promptKey` arm above.

The engine MEDIUMs were all test-adequacy and all real — the apply's wire guard
could be deleted and **duplicate a card** off a crafted snapshot; the record
could file *picked* rather than *moved* uids and park a decision for an event
that never happened; the gate's `=== 0` boundary was never driven at a hand of
one; "reads length, never the filter" was unpinned; the reveal-first ordering
held on the parking path only.

Three web MEDIUMs changed code (the seat name, Escape, the redaction). And one
finding was a **pre-existing engine contradiction this slice made
user-visible**: `programPlayable`'s `discardEnergy` arm claimed "Crushing
Hammer's coin-GATED discard stays playable either way" while the `coinFlipGate`
branch six lines above descends into `then` for exactly that card (D41). The
descent wins — measured — and the stale comment is corrected, because as of this
slice the disagreement renders to a player as an unclickable row rather than a
transient pill.

See D52.

## P3-M5 build session #39 (2026-07-23) — count-scaled attack damage: the additive "+" family (D54)

The first reader to turn the **`ATTACK_EFFECT_SKIPPED` damage-modifier path** into
a simulated one. `cards.ts` `parseAttackDamage` has always split a `"20+"` into
`{base: 20, modifier: "+"}`, and nothing consumed the modifier — the numeric base
landed and the "+" was flagged loudly. Now the printed **"This attack does N more
damage for each damage counter on this Pokémon."** is SIMULATED. engineVersion
0.33.0 → **0.34.0**.

### The mechanism — a PRE-damage fold, not an EffectOp
A new reader **`deriveAttackDamageBonus(text): AttackDamageBonus | null`**
(effects.ts) parses the anchored whole-sentence into
`{per, count: {kind: "damageCountersOnSelf"}}`. It sits beside `deriveAttackEffect`
but is **DISJOINT** from it, and the distinction is load-bearing: `deriveAttackEffect`
returns `EffectOp[]` that the interpreter runs **AFTER** damage, whereas a scaling
clause changes the number the §8.5 pipeline **starts from**, so it is PRE-damage
math the *caller* computes. attack.ts holds the fold:

```
const damageBonus = … deriveAttackDamageBonus(effect);
const scaled = damageBonus === null ? 0 : scaledAttackDamage(active, damageBonus);
…
if (base + scaled > 0) {                       // widened from base > 0
  const afterWR = max(0, applyMod(applyMod(base + scaled + bonus, weakness), resistance));
  …DAMAGE_DEALT { base, scaled: scaled > 0 ? scaled : undefined, bonus, … }
}
```

`scaledAttackDamage(attacker, bonus)` = `Math.floor(attacker.damage / 10) * bonus.per`
(one damage counter = 10 HP, §12), read off the **attacker's** Active at
DECLARATION — before any recoil/self-damage, which is when the TCG counts "for
each damage counter". The fold lands at the same pre-W/R step as the continuous
Vitality Band bonus (both additive, so commutative; the log orders scaling first).

**A card carries at most one of the two derivers** — the whole-sentence anchor
means a scaling sentence never also derives a post-damage op, so `program` and
`damageBonus` are never both non-null for a real card.

### The rebuilt skip condition
```
const effectSimulated = program !== null || damageBonus !== null;
const modifierSimulated = damageBonus !== null;
if ((modifier !== null && !modifierSimulated) || (effect && !effectSimulated)) {
  …ATTACK_EFFECT_SKIPPED { effect: effectSimulated ? null : effect,
                           damageModifier: modifierSimulated ? null : modifier }
}
```
For any card with `damageBonus === null` this reduces **algebraically** to the old
`modifier !== null || (effect && program === null)` with the old field expressions
— so no existing card's skip behaviour changes (reviewer-verified, and pinned by
the zero-regression suite).

### Cards landed (verified vs the local D1 catalog)
| Card | ids | Attack | Program |
|---|---|---|---|
| Paldean Tauros | sv02-028 | "Raging Horns" (20+) | DERIVED — `{per: 10, count: damageCountersOnSelf}` |
| *fix-attacker* "Rage" | (test) | (10+) | same — the default test attacker, identical text |

**Charizard ex** sv03-125 "Burning Darkness" (180+, "…for each **Prize card your
opponent has taken**") is a DIFFERENT count source with no reader — DELIBERATELY
left on the `ATTACK_EFFECT_SKIPPED` path. It is the **anchor-guard witness**: the
deriver must REFUSE a scaling sentence it does not simulate, and the two "+"-skip
test witnesses (checkup.test.ts, logFromEvents.test.ts) migrated from Rage onto it.
`DamageCountSource` is a **union so the Prize-card reader lands as a member later**
(`opponentPrizesTaken` = `PRIZE_COUNT − defender.prizes.length`), widening
`scaledAttackDamage`'s signature to reach both boards — the next slice (see the
resume point).

### Web — one new field, one breadcrumb
`DAMAGE_DEALT` gained **`scaled?: number`** (present only when >0, the
`bonus`/`reduction` pattern), and logFromEvents renders **`· scaled +N`** ahead of
`· boosted +N` (§8.5 order). No projection/redaction change — `scaled` is public
damage math (a table fact); the only DAMAGE_DEALT consumer in `src/` is the log.

### Review (2 adversarial agents, isolated worktrees, 17 engine mutations) — NO HIGH
Rules confirmed verbatim (both fixtures, the damage-counter = 10 HP rule, the
pre-W/R fold timing). The anchor-killers, the pre-W/R ordering (a 40-vs-30 test),
the "right Pokémon at declaration" read, and `scaled`-honesty all genuinely die.
**Three false-coverage MED/LOWs found and FIXED, each mutation re-run:** (1) the
fold's `per` operand was untested — `* bonus.per → * 10` survived the whole suite
(every folded fixture prints per=10); (2) the widened `base + scaled > 0` guard was
untested (latent — no base-0 scaler). BOTH closed by ONE synthetic **base-0,
per-20** scaler ("Fury", fix-attacker index 4) — a deliberate probe (no real card
prints a 0-base "does N more"), asserting `{base:0, scaled:60, dealt:60}`: the
`* 10` mutant gives 30, the `base > 0` revert emits no DAMAGE_DEALT. (3) The
`· scaled +N` log breadcrumb was unpinned (deleting it survived) — closed with a
rendered-string assertion, the `· boosted +N` sibling's technique. A stale "stays
on the ATTACK_EFFECT_SKIPPED path" comment on the Raging Horns fixture was
corrected.

### Recorded, NOT fixed
- **No fixture exercises a card with BOTH a derived post-damage program AND an
  unsimulated "+" modifier**, so the skip arm firing `effect: null, damageModifier:
  "+"` (program ≠ null, scaling = null) is correct-by-analysis only — a pre-existing
  shape, no in-tree card.
- `scaledAttackDamage` is a **one-member switch with no trailing return** (tsc
  accepts it exhaustive); the `Math.floor` is defensive (all damage lands in tens),
  its removal survives the suite — both declared, resolved when `opponentPrizesTaken`
  lands.
- The slice's originally-flagged #1 (**Sandaconda** "rider clause") was FALSIFIED
  in exploration: the real text ("your opponent shuffles their Active Pokémon and
  all attached cards into their deck") needs a brand-new shuffle-into-deck op PLUS a
  persistent-marker subsystem (`types.ts` `markers[]` is a never-read stub), not the
  `recordAs` the D53 resume note assumed.

See D54.

## P3-M5 build session #40 (2026-07-23) — the count union's second member: `opponentPrizesTaken` (D55)

The cheapest continuation of D54: the additive damage-scaling family's `DamageCountSource`
union gains its **second member**, confirming the union-of-two shape the interface was built
to hold. engineVersion 0.34.0 → **0.35.0**.

### The member
`OPPONENT_PRIZES_SCALE` (effects.ts), anchored whole-sentence beside `SELF_COUNTER_SCALE`:

```
/^This attack does (\d+) more damage for each Prize card your opponent has taken\.$/
```

parses into `{per, count: {kind: "opponentPrizesTaken"}}`. `scaledAttackDamage` (attack.ts)
**widened** `(attacker, bonus)` → `(attacker, bonus, state, defenderSeat)` and gained the arm:

```
case "opponentPrizesTaken":
  return (PRIZE_COUNT - state.players[defenderSeat].prizes.length) * bonus.per;
```

Taken = **6 − remaining** (each player draws from their OWN Prizes on a KO, §8.1), read at
DECLARATION off `next` before this attack's own KO awards a Prize (§8.5). Robust by
construction too: this attack's KO prizes to `action.seat`, never the defender, so the
opponent's taken-count cannot move mid-resolution.

### "more" is the discriminator
The catalog prints the Prize source in TWO shapes, told apart by ONE word:

| Text | Family | Cards | Reader |
|---|---|---|---|
| "…does N **more** damage for each Prize card your opponent has taken." | additive **+** (`180+`) | Charizard ex ×4 (sv03-125/-215/-223/-228) | `opponentPrizesTaken` — THIS slice |
| "…does N damage for each Prize card your opponent has taken." | multiply **×** | Pecharunt ex, Annihilape, Wo-Chien ex | none — stays loud (resume #1) |

The "×" family folds nothing into a printed base (`damage = per × count`), so it is a
DIFFERENT shape, not a `count` member; the regex refuses it, witnessed by a deriver test.

### The witness migration
Simulating Charizard RETIRED it as D54's anchor-guard witness (the "+"-card that STAYS on
the loud `ATTACK_EFFECT_SKIPPED` path). Its role moved to a real replacement — **Entei
sv03-030 "Blaze Ball"** (60+, "…for each {R} Energy attached to this Pokémon.", an
attached-Energy count source no reader simulates) — across all three witnesses (scaledDamage's
discrimination test, checkup.test.ts, logFromEvents.test.ts). `SCALED_DAMAGE_DECK` gained 4
Entei; `fix-fire-energy` trimmed 20→16 to hold exactly 60.

### Web — nothing
`DAMAGE_DEALT.scaled` and the `· scaled +N` breadcrumb render generically over both count
sources; the only `DAMAGE_DEALT` consumer in `src/` is the log. No projection/redaction change.

### Review (1 read-only adversarial reviewer + an in-tree mutation self-audit, 6 mutations) — NO HIGH
Rules correctness (opponent = defender, 6−remaining, declaration timing), regex narrowness
(matches ONLY the 4 identical Charizard prints across the whole catalog; refuses every "×" and
self-scaler), deck integrity (=60), the Entei fixture (verbatim vs D1), and the two-case switch's
exhaustiveness all CONFIRMED correct. The `6−remaining`, the opponent-seat read, both new-regex
anchors, and the "more" keyword each individually die under mutation.

**ONE MED false-coverage FOUND AND FIXED, mutation-proven:** every apply-level Prize test used
Charizard's `per: 30`, so `* bonus.per → * 30` (the literal a careless author would most plausibly
hard-code — the "captured per" test only ruled out `* 10`) survived the WHOLE suite. Closed with a
synthetic **per-50 probe** — "Bounty" (fix-attacker index 5, base 40 + 50×count), the Prize-source
twin of D54's "Fury" (base 0, per 20); the `* 30` mutant re-run and confirmed dead.
`attack.test.ts`'s out-of-range-index witness bumped 5→6 (fix-attacker now prints 6 attacks).

### Recorded, NOT fixed
- `scaledAttackDamage` is now a TWO-member exhaustive switch with no trailing return — sound
  (a third member would fail tsc's "function lacks ending return", the safety D54 relied on for
  one member). `Math.floor` stays only in the self-counter arm (Prize counts are integers).
- The Prize arm's "folds before Weakness" ordering is not INDEPENDENTLY pinned by a W/R test; the
  fold (`base + scaled + bonus` → W/R) is shared code already pinned by the self-counter's fix-weak
  test, and the Prize arm only supplies the `scaled` number, so it cannot break the order alone
  (reviewer LOW).

See D55.

## P3-M5 build session #41 (2026-07-23) — the "×"/multiply damage family (D56)

The sibling of D54–D55's additive "+" family: "This attack does N damage for each Prize card
your opponent has taken." (NO "more") now SIMULATES. engineVersion 0.35.0 → **0.36.0**;
1653 → **1661** tests.

### The distinct fold
The additive family folds `per × count` ONTO a printed base. The "×"/multiply family's printed
"N×" is the **per-unit**, so `per × count` is the **WHOLE damage** with the printed base DROPPED
(count 0 → 0 damage). Same parse (`{per, count}`), same count evaluator — only the fold differs.

New reader `deriveAttackDamageMultiplier` (effects.ts) + regex `OPPONENT_PRIZES_MULTIPLY`:

```
/^This attack does (\d+) damage for each Prize card your opponent has taken\.$/
```

parses into `{per, count: {kind: "opponentPrizesTaken"}}` — **D55's evaluator reused UNCHANGED**.
attack.ts reads BOTH scaling derivers, `damageMultiplier` only when `damageBonus === null` (the
regexes are mutually exclusive on "more", so at most one fires), and:

```
const scaling = damageBonus ?? damageMultiplier;
const scaled = scaling === null ? 0 : scaledAttackDamage(active, scaling, next, defenderSeat);
const scaledBase = damageMultiplier !== null ? 0 : base;   // multiply drops the printed base
```

The §8.5 guard (`scaledBase + scaled > 0`) and `DAMAGE_DEALT.base` both use `scaledBase`, so the
additive family (where `scaledBase === base`) is byte-identical to before.

### "more" is the discriminator (again)
The catalog prints the Prize source in two shapes, told apart by ONE word — and this slice adds
the multiply reader D55 named:

| Text | Family | Cards | Reader |
|---|---|---|---|
| "…does N **more** damage for each Prize card your opponent has taken." | additive **+** (`180+`) | Charizard ex ×4 | `deriveAttackDamageBonus` (D55) |
| "…does N damage for each Prize card your opponent has taken." | multiply **×** | Pecharunt ex, Annihilape | `deriveAttackDamageMultiplier` — THIS slice |

Lands **Pecharunt ex** sv06.5-039 "Irritated Outburst" (60×, {D}{D}, Basic) and **Annihilape**
sv01-109 "Rage Fist" (70×, {F}, Stage 2) — two pers on one source. New `MULTIPLY_DAMAGE_DECK`
(Darkness/Fighting Energy pay the costs; Fire cannot).

### The anchor-guard witnesses
The bigger "×" siblings stay LOUD, each a DIFFERENT shape the reader must refuse:
- **Wo-Chien ex** sv02-027 "Covetous Ivy" — a benched-TARGET multiply ("…to 1 of your opponent's
  Benched Pokémon for each Prize…"), refused by the mid-sentence text the anchors exclude, and it
  says "Don't apply Weakness and Resistance for Benched Pokémon" — so when it lands it must bypass
  the §8.5 pipeline this fold runs.
- **Chien-Pao ex** "Hail Blade" — a DISCARDED-Energy count ("…for each card you discarded in this
  way."), a COMPOUND (an optional `discardEnergy` cost that PARKS, whose §9.2 moved-count then
  scales the damage — a count source read off the record, not the board).

Entei sv03-030 stays the ADDITIVE reader's anchor-guard witness (D55).

### Web — nothing
`DAMAGE_DEALT.base:0, scaled:N` renders through the generic `· scaled +N` breadcrumb; the only
`DAMAGE_DEALT` consumer in `src/` is the log. No projection/redaction change.

### Review (1 read-only adversarial reviewer) — NO HIGH, NO MED, no surviving mutants
Catalog narrowness proven EXHAUSTIVELY (of the 4 cards printing "for each Prize card your opponent
has taken", the multiply regex matches ONLY Pecharunt/Annihilape; refuses Wo-Chien benched and
Charizard's "more"). Base-drop pinned two ways: a count-0 "no DAMAGE_DEALT" test (a kept base
deals 60) and a count-2 `{base:0, scaled:120, dealt:120}` test (a kept base gives 180).
Captured-per pinned by Annihilape's 70 ≠ Pecharunt's 60. Mutual exclusivity + `deriveAttackEffect`
disjointness confirmed.

**ONE LOW FOUND AND FIXED:** the Pecharunt fixture's "Verbatim vs the local D1 catalog" comment
omitted the card's real "Subjugating Chains" Ability — a false-verbatim claim this repo names
explicitly (the Charizard fixture comment). Corrected to "printed STATS + attack row verbatim;
Ability OMITTED (unexercised, no registry row)".

### Recorded, NOT fixed
- The multiply W/R ordering is not INDEPENDENTLY pinned by a weak-defender test (every multiply
  test uses fix-bigbody, no weakness) — but the fold is the SAME shared pipeline line as the
  additive family, already pinned by "folds BEFORE weakness" (`scaled` sits inside the weakness
  multiply), and with `scaledBase` forced to 0 the multiply arm only supplies `scaled`, so it
  cannot break the order alone (reviewer LOW — the same call D55 made for its Prize arm).
- No fixture exercises a card with BOTH a derived post-damage program AND a multiply modifier
  (no such in-tree card; the shape is correct-by-analysis).

See D56.

## P3-M5 build session #42 (2026-07-23) — the "×" family's benched-target sibling (D57)

The last of the four "for each Prize card your opponent has taken" cards — Wo-Chien ex sv02-027
"Covetous Ivy" — and a genuinely new mechanism (not just a data row). engineVersion 0.36.0 →
**0.37.0**; 1661 → **1673** tests.

### Why it is NOT the D56 fold
Charizard/Pecharunt/Annihilape scale the damage to the DEFENDER (a pre-W/R fold in attack.ts).
Wo-Chien's damage goes to **one CHOSEN Benched** Pokémon instead — a targeted snipe, not the
main hit — so it derives to a **`damageChosen`** op that runs in the effect program, NOT the
scaling fold. The `damageChosen` op (the Hawlucha / Meowscarada put-counter snipe) already owns
the "choose N of the opponent's Bench" park (count-1, mandatory here), so it was extended rather
than duplicated:

- **`deals`** — the hit is ATTACK DAMAGE: emit `DAMAGE_DEALT` and apply the benched reduction
  passive, exactly `spreadDamage`'s model. The default snipe (no `deals`) emits a flat
  `COUNTERS_PLACED` counter, which reduction does NOT touch. Either way a Benched target takes
  no Weakness/Resistance (§8.5).
- **`perTakenPrize`** — the effective amount is `amount × the opponent's TAKEN Prizes`, computed
  in the interpreter's new **`snipeAmount(op, state, ctx)`** at the run site AND the pick. The
  two are provably equal: nothing takes a prize in the `effect:choose` window, and this attack's
  own KOs defer to `finishAttack`. 0 taken → amount 0 → the `amount <= 0` guard returns a no-op
  (no park, no event; the epilogue still ends the turn).

### The derive + the shared helper
`BENCHED_SNIPE_TAKEN_PRIZES` (effects.ts): `^This attack does (\d+) damage to 1 of your
opponent's Benched Pokémon for each Prize card your opponent has taken\.( …W/R clarifier…)?$`.
The "**1 of**" vs `SPREAD_EACH_BENCH`'s "**each of**" is the whole distinction; the optional
W/R-reminder tail is the spread family's. The "6 − remaining" Prize formula moved to a shared
**`takenPrizes(state, seat)`** in types.ts, now called by BOTH `scaledAttackDamage` (the D55/D56
fold) and `snipeAmount` — the one formula they would otherwise duplicate.

### Narrowness (the same catalog proof)
Of the ~20 catalog attacks printing "to 1 of … Benched Pokémon", the regex matches ONLY Wo-Chien.
Every other is a DIFFERENT shape and stays loud — chiefly the flat **"This attack ALSO does N
damage to 1 of your opponent's Benched Pokémon"** RIDER (Bellibolt, Miraidon, Palafin, Jumpluff,
Pawmot, Dartrix, Orthworm, …), a secondary snipe AFTER the main damage with no Prize scaling.
That is a whole untouched family and the high-yield next step: the SAME op minus `perTakenPrize`,
behind a "This attack also does …" derive.

### Web — nothing
A `DAMAGE_DEALT` on a benched uid renders generically (logFromEvents keys off seat/uid), exactly
as `spreadDamage`'s benched hits already do. No projection/redaction change.

### Review (1 read-only adversarial reviewer) — NO HIGH
Recompute-at-resolve safety, the 0-guard completeness, `deals`/`spreadDamage` parity, the
benched-KO-through-`finishAttack` turn-END (distinct from the Ability snipe's `resolveMidTurnKnockOuts`
resume), regex narrowness, and the `takenPrizes` refactor's value-identity all confirmed; the
Hawlucha/Meowscarada put-counter path is unbroken by the `placeSnipe` rename (`op.deals`
undefined → false).

**ONE MED false-coverage FOUND AND FIXED, plus 2 LOWs:** the "reduction passive" test benched a
passive-LESS body (fix-bigbody, reduction 0), so the `dealt = amount − reduction` subtraction and
the `reduction` field were never exercised (`dealt = amount` and `reduction: undefined` survived).
Closed by benching real **Bouffalant sv03-174 "Bouffer"** (−20), asserting `{base:60, reduction:20,
dealt:40}`. The purity test moved from the park path (which returns before `placeSnipe`) to the
state-rewriting AUTO-TAKE path. The captured `amount` is pinned by a per-40 `fix-bramble` probe
(Wo-Chien always prints 60).

### Recorded, NOT fixed
- The benched hit's `weakness/resistance: null` is hard-coded in `placeSnipe`'s `deals` branch (a
  Benched target never has W/R applied, §8.5) — no realistic mutation reaches it, so a
  weak-benched-defender test is unnecessary (reviewer LOW).

See D57.

## P3-M5 build session #43 (2026-07-23) — the flat benched-snipe rider family (D58)

The cheapest high-yield slice in the milestone: the D57 `damageChosen` op, built to generalize,
lands ~15 real cards for a ~26-line diff with ZERO new op or interpreter code. engineVersion
0.37.0 → **0.38.0**; 1673 → **1683** tests.

### The shape
"This attack ALSO does N damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness
and Resistance for Benched Pokémon.)" — a SECONDARY snipe AFTER the main hit (which rides the
attack's own `damage` field). It is D57's `damageChosen` op (count 1, `deals: true`) MINUS
`perTakenPrize` (a fixed N, not Prize-scaled), so all that is new is one anchored derive:

```
const ALSO_BENCHED_SNIPE =
  /^This attack also does (\d+) damage to 1 of your opponent's Benched Pokémon\.( …W/R tail…)?$/;
```

producing `[{op:"damageChosen", target:"opponentBench", amount:N, count:1, deals:true}]`. The main
hit and the rider coexist by the ordinary attack flow — attack.ts deals the `damage`-field base to
the Defender (through W/R) first, then the effect program runs the benched snipe (parks on the
count-1 choice, auto-takes a Bench of one, or whiffs on an empty Bench).

### Cards
Authored as fixtures: **Miraidon** sv01-080 "Lightning Laser" (90 + 30) and **Tadbulb** sv03-076
"Shake and Discharge" (20 + 10) — two Ns, two main-damage values. The same shape (any N) covers
Pawmot, Bellibolt, Decidueye ex, Jumpluff, Orthworm, Palafin, Pyroar, Dartrix — ~15 prints total.

### Narrowness — and what stays loud (the next shapes)
Of every catalog "also does … damage to" attack, the regex matches ONLY the 10 intended cards.
The refusals are each a DIFFERENT shape, and together they map the rest of the benched-snipe
rider family (all cheap now the op is proven):
- **Flamigo** "Synchronized Feathers" — "If Flamigo is on your Bench, this attack also does …": a
  board-condition gate, off the `^This` anchor.
- the **"each of"** also-SPREAD rider (all benched) — a `spreadDamage` rider, trivial.
- **"2 of"** — a `damageChosen count:2` rider.
- **"1 of YOUR Benched"** (self-target) and **"1 of your opponent's POKÉMON"** (any target incl.
  the Active) — new target modes.

### The test deck's determinism
`ALSO_SNIPE_DECK` pins BOTH setup Actives to `fix-bigbody` (32/60 dominant, so driveSetup's
`active` option finds it in the opening hand for every used seed). The Defender is then a
deterministic 200 HP body that survives the main hit, with an EMPTY Bench — so the benched targets
are exactly what a test places, with no seed-dependent displaced body. (The earlier draft used
`setActiveFromDeck` for the Defender, which displaces the setup Active onto the Bench — a
seed-dependent phantom that broke the count-1 / KO tests; the pin removes it.)

### Web — nothing
A `DAMAGE_DEALT` on a benched uid renders generically (logFromEvents keys off seat/uid), as
`spreadDamage`'s benched hits already do.

### Review (1 read-only adversarial reviewer, mutation-driven) — NO real defects
Every load-bearing field is genuinely pinned: a `count:2` injection fails 3 tests, a
`perTakenPrize:true` injection fails 6, the captured amount is pinned by Miraidon 30 ≠ Tadbulb 10,
`deals` by DAMAGE_DEALT + `not COUNTERS_PLACED`, main+rider coexistence and ordering by the two
bases (90 then 30). Regex narrowness proven over 18 edge cases + the whole catalog. **ONE comment
nit FIXED:** the code claimed the word "also" is what separates this from Covetous Ivy, but the
whole-sentence anchor does — Covetous Ivy's clause continues "… Benched Pokémon FOR EACH Prize …",
so the `\.$` after "Pokémon" blocks it (making "also" optional survives the suite, harmlessly).
Corrected to name the anchor as load-bearing.

See D58.

## P3-M5 build session #44 (2026-07-23) — the ANY-target snipe, with conditional W/R (D59)

The benched-snipe family's generalization: a chosen hit on 1 of ALL the opponent's Pokémon —
the Active OR a Bench — where the ONE genuinely new idea is that Weakness/Resistance apply
conditionally (only when the pick lands on the Active). engineVersion 0.38.0 → **0.39.0**;
1683 → **1693** tests.

### The shape and the rule
"This attack does N damage to 1 of your opponent's Pokémon. (Don't apply Weakness and
Resistance for Benched Pokémon.)" — the WHOLE attack (no `damage` field). The reminder is the
tell: it names *Benched* specifically because for the *Active* pick, W/R DO apply (rules §8.5:
"Weakness/Resistance apply only to the Active/Defending Pokémon"). So one op, two damage models
picked at resolution.

### Implementation (extending the shared snipe op, not a new one)
- effects.ts: `CHOSEN_ANY_TARGET` derives `[{op:"damageChosen", target:"opponentAny", amount:N,
  count:1, deals:true}]`. The op's `target` union widened to `"opponentBench" | "opponentAny"`.
- interpreter.ts:
  - `oppAnyRefs` — candidates = the opponent's Active (always present during an attack, so the
    set is never empty) + the whole Bench, Active first.
  - `placeSnipe` gained an **Active arm** (`snipeActive`) run when any ref is the opponent's
    Active. It is the FULL §8.5 pipeline — `base + attacker.damageBonusBeforeWR → ×Weakness →
    −Resistance → −reduction`, floored — byte-for-byte attack.ts's main hit, minus only the
    main attack's own printed base (the snipe's `amount` is its whole base). The Bench arm is
    unchanged (flat, no W/R).
  - `snipeNote` gained a `target` param ("Pokémon" vs "Benched Pokémon").

### Why the shared machinery does not regress
`placeSnipe` is shared by the put-counter snipe (Hawlucha / Meowscarada), Wo-Chien, and the
rider family — all `opponentBench`, whose candidates are Bench-only and whose picks
`validateChoice` constrains to those candidates. So `refs.some(active)` is always false for
them → the Active arm never fires and `next === state`, leaving their behavior byte-identical.
The one real change, `if (targeted.size === 0) return next` (was `return state`), is the
essential fix so an auto-taken Active snipe is not discarded. 42 prior snipe/Covetous/rider
tests stay green.

### Cards; and what stays loud
Lands Fezandipiti ex (100), Rotom (20), Paldean Tauros "Aqua Dive" (60), Bellibolt ex /
Kilowattrel (50). Stays loud, each a future shape: Umbreon "Feint Attack" ("… isn't affected by
Weakness or Resistance" — a no-W/R-even-on-the-Active flag), Pawmot ex (a leading discard cost),
Magikarp (a leading coin flip).

### Review (1 read-only adversarial reviewer) — NO HIGH, and one MED fixed
No shared-code regression (the `next` threading, the `validateChoice` Active rejection, and the
regex narrowness all confirmed). **ONE MED FOUND AND FIXED:** `snipeActive` dropped the
attacker's `damageBonusBeforeWR` (Vitality Band's "+10 to the opponent's Active, before W/R"),
which DOES apply to an Active snipe — the draft's "consistent with the Bench arm" comment was a
false equivalence (the Bench correctly omits it; the Active is exactly what Vitality Band
boosts). Because these cards have no main `damage` field, the bonus was applied NOWHERE, so a
Vitality-Band Fezandipiti would deal 100 where the rules say 110. Fixed by folding the bonus
into the pre-W/R term + emitting the `bonus` field, pinned by a new test asserting
`(20 + 10) × 2 = 60`.

### Recorded, NOT fixed (reviewer LOW)
`snipeActive`'s Resistance application, the `− reduction` term, and the two `Math.max(0, …)`
floors are not INDEPENDENTLY pinned (no fixture gives the Active a Resistance or a reduction
passive; none drives the total negative), and the Active-snipe KO → prize flow is untested —
all a verbatim copy of attack.ts's own tested §8.5 pipeline (Weakness order IS pinned) and the
benched arm's tested reduction, so a real bug is unlikely. Left analysis-only rather than adding
three fixtures for a LOW. `snipeActive` duplicating attack.ts's W/R math (rather than sharing a
helper) is acceptable until a third consumer justifies extraction.

See D59.

## Notes for effect authoring at scale
Authoring handlers for many cards is a natural **Workflow** fan-out (one agent per
set/card batch, each verified against the rules doc). Ask the user before
launching one. The mechanics all live in `interpreter.ts` (op programs incl.
spreadDamage, the `damageChosen` snipe + `attachEnergyFrom`), `continuous.ts` (persistent-zone
modifiers + special-energy provision), `triggers.ts` (triggered-Ability scan
points — onPlayToBench/onEvolve/betweenTurns/**onKnockOut**) and `registry.ts`
(EnergyProgram, StadiumEffects, PassiveEffects, TriggeredAbility incl. the on-KO
`onKoPrizeGuard`, AbilityProgram — whose activation `cost` is now the
`payFromHand` op at the head of its program, not a field — op programs), and the
KO flow reaches the whole board (attacks, the Checkup, a mid-turn snipe via the
shared `settleProgram`, and now an on-KO trigger that can pause the sweep for a
decision via the `koTrigger` stage + `resumeTail`), so a new card in a known
family is a few lines of data in `registry.ts` — the fan-out adds rows, not code.

### Stadiums can now ACTIVATE, and the "each player's turn" pattern (D102, engine 0.53.0)
A Stadium is no longer continuous-only. `StadiumEffects.ability?: {label, program}`
(registry.ts) makes the shared Stadium run an interpreter **program** on demand,
driven by a new **`useStadiumAbility {seat}`** action (cardplay.ts — the
`useAbility` twin, minus the ability-lock/`activeOnly`/hand-cost paths a Stadium
never has; there is no `target` because there is exactly one shared Stadium).
Artazon / Mesagoza / Town Store landed on it with **no new op** (Nest Ball /
Poké Ball search shapes) plus two `CardFilter` refinements — `basicPokemon.noRuleBox`
(the new `cards.ts hasRuleBox` = the ex/V/…/GX suffixes ∪ the "Radiant " NAME PREFIX)
and `toolCard`.

**The reusable lesson — "once during EACH player's turn" is a per-turn bool, not
a per-player map.** The backlog feared "a per-PLAYER once-per-turn allowance, not
the per-ability `abilitiesUsed` key". It is simpler: `turnGate` already admits
only `phase.seat`, and `TurnAllowances` **reset every turn** (`freshAllowances`),
so a single new bool (`stadiumAbilityUsed`) gives "once this turn" for the active
player AND automatically re-arms for the opponent's own turn. NO `answerer`/`decider`
routing (contrast D101's on-KO reaction, where the whole program belonged to the
non-turn seat). Any future "once during each player's turn" effect keys off the
same shape.

**Deferred:** the HUD affordance. The engine action + projection surface for a
**target-less "global" Stadium button** (no Pokémon `PokemonTarget`, no drag
target) is a distinct web/schema slice — it needs a new redacted-phase field
(`@luminous/schema`) + a button the client renders and dispatches. Landed
engine-only, reachable by tests and the P4 action path; surface it with a live
/play pass. Also deferred, out of the sv01–03 scope: **Academy at Night
sv06.5-054** (the 4th activated Stadium — "put a card from hand on top of their
deck", a `payFromHand to:"deckTop"` op that does not exist yet).

**Process scar (see the auto-memory `biome-format-churn`):** `bun run check` runs
`biome lint`, NOT `biome format`. Committed code is not format-clean, so
`biome format --write <dir>` reformats dozens of unrelated files. Never run it
repo-wide; rely on the lint gate and match surrounding style.

### The retreat-cost seam, end to end — CLOSED at 10/10 (D108–D111 + D114, engine 0.65.0)
The seam is **complete** for the **ingested** pool (six sets, 978 cards — see the pool note
below; the live remote D1's ~3698 cards would reopen it). The table below was written when
the census covered only the five sv/sve sets and read 9/9; `swsh10.5` added a 10th print,
**Wimpod `swsh10.5-025` "Punk Out"**, built in D114. A full D1 census (`%retreat cost%` over
`attacks_json ‖ abilities_json ‖ effect`, re-run twice) returns exactly **9 unique ids** —
4 distinct MODIFIER effects (6 printings) and 4 distinct READER effects (6 printings), with
Spidops ex sitting in **both** buckets. Alternate wordings were swept and found empty:
`to retreat`, `more to retreat`, `retreating`, `escape`, `without paying` all return **zero**
hits, so "costs {C} more to retreat" phrasing does not exist in this pool.

| | card | state |
|---|---|---|
| modifier | Beach Court `sv01-167` (−1, Basic, both boards) | built (`basicRetreatDiscount`) |
| modifier | Calamitous Wasteland `sv02-175` (+1, Basic non-{F}, both boards) | built (D109 `basicRetreatSurcharge`) |
| modifier | Clefable ex `sv03-082` "Lunar Zone" (set-to-zero, own board, {P} clause) | built (D108 `noRetreatCostAura`) |
| modifier | Spidops ex `sv01-019`/`-223`/`-243` "Trap Territory" (+1, opponent's ACTIVE only) | built (D111 `opponentActiveRetreatSurcharge`) |
| modifier | Wimpod `swsh10.5-025` "Punk Out" (set-to-zero, **SELF only**, gated on the OPPONENT holding a Pokémon V in play) | built (D114 `noRetreatCostSelf`) |
| reader | Heracross `sv01-002`, Spidops ex "Wire Hang", Sharpedo `sv03-047` (base + 30·n) | built (D110) |
| reader | Stoutland `sv03-172` "Chomp Chomp Panic" (`50×`, bare 50·n) | built (D110) |

**Read the Active clauses off the print, one end at a time.** Trap Territory's are
ASYMMETRIC and the sentence says so: "your opponent's **Active** Pokémon's Retreat Cost"
scopes the TARGET, and *nothing* scopes the source — so a **benched** Spidops ex imposes it
exactly as an Active one does. (Contrast `damageAttacker`, where the Active clause is on the
holder.) The same care applies to stage: neither end is Basic-gated, unlike both Stadiums.

**`effectiveRetreatCost` is now a fold, not a chain of early-outs.** D111 had to convert the
`!isBasicPokemon(top) → return printed` early RETURN into a zero TERM (`stadiumRetreatDelta`),
because a stage-agnostic aura would otherwise be silently swallowed on a Stage 1/2 Active.
The shape is now `max(0, printed + Σdeltas)` with the set-to-zero checked first:
- **the floor applies to the SUM, not per term** — a printed-0 Basic under Beach Court is −1
  before Trap Territory's +1, and reads 0, not 1;
- a Stadium and an aura **can** coexist, so the ± composition D109 correctly found unreachable
  between the two Stadiums *is* reachable here — that is the case worth testing;
- set-to-zero still beats everything (the official "no Retreat Cost applies after the ±
  modifiers" rule).

**A card can sit on both sides of one seam.** Spidops ex's "Wire Hang" READS the very cost
its own "Trap Territory" raises, so an Active Spidops ex hits for +30 off its own Ability
(90 → 150 against a printed-retreat-1 body). Nothing special was needed to make that work —
it falls out of the single derivation point — but it is the test that proves the loop closes.

Do **not** confuse this with the **retreat-LOCK** seam ("the Defending Pokémon can't
retreat") — a different mechanic, built separately in D112 (next section).

**Scope correction (D112, 2026-08-01) — since RESOLVED by D114.** The original "9/9 closed"
was scoped to the **five sv/sve sets**; the local D1 also holds `swsh10.5`, which contains a
**10th** cost-seam print: **Wimpod `swsh10.5-025`** "Punk Out" — *"If your opponent has any
Pokémon V in play, this Pokémon has no Retreat Cost."* **Built in D114** as
`PassiveEffects.noRetreatCostSelf?: { requiresOpponentSuffixInPlay?: PokemonSuffix }`, read
through a **sixth** scan `hasFreeRetreatSelf` — the first **SELF-only** member of the family
(it frees its holder and nobody else, yet must look across the table to decide). It is NOT a
refinement of `noRetreatCostAura`: that field frees *all of your* Pokémon satisfying its
clause, and conflating them would have silently freed the whole board the moment a Wimpod hit
the Bench. The predicate is a bespoke `PokemonSuffix` field rather than a `BoardCondition`
member — precedent `damageBonusBeforeWRIfTarget` in the same interface, and structurally
forced: `conditionHolds` lives in `interpreter.ts`, which imports `continuous.ts`, so reading
a `BoardCondition` from a continuous scan would close an import cycle.
**⚠️ The seam still reopens the moment a set beyond the ingested six is ingested** — the live
remote D1 matches ~54 `%retreat cost%` printings against these 10.

> **`legal_standard` is NOT a slice-selection criterion — stop treating it as one (D113).**
> D112's resume point flagged Snorlax and Wimpod's `legal_standard=0` as something to
> "decide about before spending a slice". The DB settles it: **851 of the 978 ingested cards
> are `legal_standard=0`, including every single card in `sv01`/`sv02`/`sv03`** (763 reg-mark
> G + 85 F + 2 D). The flag tracks the post-G rotation, and only `sv06.5`'s 96 reg-mark H
> cards plus most blank-mark Energies are Standard. The engine has simulated non-Standard
> cards from D1 onward and has no legality concept anywhere; format legality is a
> **deck-builder (P2)** concern reading the catalog column, not an engine one. Pick engine
> slices by *mechanism*, never by `legal_standard`.

**The one derivation point held.** `effectiveRetreatCost(state, pokemon)` (continuous.ts)
is the only place the rule lives, and it now has **four** readers — turn.ts's retreat
action, redact.ts's `redactedRetreatOf`, the web `GameHud.tsx`, and (new) attack.ts's
`scaledAttackDamage`. Adding the damage readers cost **one `switch` arm**, because that
function already received `state` + `defenderSeat`. Every modifier in play is therefore
automatically inside the number the attacks read — tested directly (Beach Court 70→40,
Calamitous Wasteland 70→100, its {F} exemption holding at 40).

**The reusable lesson — when the printed sentence is a clean anchored whole, the
DERIVER path beats authoring, and costs nothing per card.** D110 added **zero**
registry rows: two regexes in effects.ts plus a `DamageCountSource` member simulated
six printings at once. The `AttackDamageBonus {per, count}` shape already covered both
arithmetic arms (additive "+" vs "×"/multiply, discriminated by the word **"more"** —
the same tell as the Prize twins), so a new *count source* is a strictly cheaper slice
than a new *op*. Two guardrails make it safe:
- **The sentence is load-bearing.** A fixture whose text drifts by one character
  silently un-simulates the card with no test failure — so any deriver-path fixture
  gets an explicit verbatim-text assertion (`retreatCostScaling.test.ts`). Confirm the
  bytes against D1: these prints use **ASCII apostrophes** and a real `é`.
- **The `×` arm has no base.** `50 × 0` emits **no `DAMAGE_DEALT` at all** (the count-0
  behaviour the Prize twins already had) — that is correct, not a bug, and is the case
  that distinguishes the two arms on the board.

**The six continuous-aura scans now form a family** — same derived-seat trick, differing
only in reach, return type, and which end of the printed sentence is Active-scoped. When the
next aura lands, copy the nearest of these:

| scan | reach | returns | gated on §9 | Active-scoped end |
|---|---|---|---|---|
| `disabledAbilityUids` | both boards, predicate-matched targets | `Set<uid>` | no (a lock never disables a lock) | source, per-aura via `requiresActive` |
| `seatRemovesWeakness` | own board, per SEAT | `boolean` | yes | neither |
| `hasFreeRetreatAura` | own board, per TARGET | `boolean` | yes | neither |
| `opposingRetreatSurcharge` | **cross-board**, per TARGET | **`number` (summed)** | yes | target only |
| `opposingRetreatBlocked` | **cross-board**, per TARGET | `boolean` | yes | **both** |
| `hasFreeRetreatSelf` (D114) | **SELF only** — reads across the board merely to decide | `boolean` | yes | neither |

**"Scan" ≠ "aura" (D114).** The sixth member breaks the family's unstated assumption that a
dedicated scan means the effect reaches other Pokémon. `hasFreeRetreatSelf` modifies **only
its holder** — what it needs the walk for is resolving the word "your opponent" in its
*condition*. The rule that actually decides between a scan and the seat-free `passivesOf`
fold is therefore: **does the effect need to know a seat?** — not "does it reach anyone
else?". `passivesOf` is deliberately seat-free (which is why `damageBonusBeforeWRIf` is
returned raw and folded at the read sites); anything with a side-relative clause, reach or
condition, needs a scan.

**A suffix predicate belongs on the field, a board fact belongs in `BoardCondition` (D114).**
`PassiveEffects` already carried `damageBonusBeforeWRIfTarget: { targetSuffix: PokemonSuffix }`;
`noRetreatCostSelf: { requiresOpponentSuffixInPlay?: PokemonSuffix }` follows it. There is
also a hard structural reason not to reach for `BoardCondition` from a continuous scan:
`conditionHolds` lives in **`interpreter.ts`, which imports `continuous.ts`** — the import
would close a cycle. If a future print really needs the shared vocabulary in a continuous
context, move `conditionHolds` down to a module both can import, don't add the back-edge.
Note `pokemonSuffixOf` tests `" VMAX"`/`" VSTAR"` before the bare `" V"`, so
`=== "V"` means *exactly* the printed "Pokémon V" — VMAX and VSTAR are excluded by
construction, which is the same line Choice Belt draws.

**Read the Active clauses off the print, one end at a time** (the D111 lesson, sharpened by
D113): the last two scans are structurally the same walk and differ *only* here. Trap
Territory's sentence scopes the TARGET ("your opponent's **Active** Pokémon's Retreat Cost"),
so a benched Spidops ex still imposes it; Block *opens* with "As long as this Pokémon is in
the **Active Spot**", which scopes the SOURCE as well, so its source list is the opponent's
Active alone. An Active clause is enforced in the SCAN, never by a new `activeOnly` field —
the `damageAttacker` precedent.

**§9 reachability is a function of the source's STAGE.** Klefki `sv01-096` "Mischievous Lock"
= `{ stage: "Basic", side: "both", requiresActive: true, exemptAbilityNamed: "Mischievous
Lock" }`, so it silences BASIC sources only. Florges, Clefable ex and Spidops ex are all
Stage 1/2, which is why their suites could record only the §9 negative; Snorlax is a **Basic**,
so `blockTest`'s §9 case is the family's **first positive** — an Active Klefki really does
take Block down, and the freed Pokémon is the Klefki itself.

### The retreat-LOCK seam — CLOSED, all three shapes built (D112 + D113, engine 0.64.0)

A *condition on the Pokémon*, not a cost modifier — it shares nothing with the seam above
but the word "retreat". The census (local D1, D112) puts it at **three sentence shapes,
17 printings / 15 names**:

| | shape | where | state |
|---|---|---|---|
| **L1** | `"During your opponent's next turn, the Defending Pokémon can't retreat."` | attack rider, the WHOLE effect | **built** — 15 printings / 13 names: `sv01-103` Espathra, `sv01-138`/`-219` Bombirdier, `sv02-016` Tarountula, `sv02-030` Talonflame, `sv02-165` Corvisquire, `sv03-012` Trevenant, `sv03-059` Wugtrio, `sv03-102` Houndstone ex, `sv03-112` Stunfisk, `sv03-137` Inkay, `sv06.5-013` Sneasel, `sv06.5-020`/`-070` Dusknoir, **`swsh10.5-036` Onix** |
| **L2** | `"Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat."` | attack rider, ONE of two clauses | **built** — `sv03-128` Paldean Clodsire "Poison Ring" |
| **L3** | `"As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon can't retreat."` | **Ability**, continuous, no turn duration | **built** (D113) — `swsh10.5-055` Snorlax "Block", the only continuous-Ability retreat lock in the pool and its only printing. `PassiveEffects.preventOpponentActiveRetreat` read through the 5th aura scan `opposingRetreatBlocked`, at the retreat gate — **not** in `effectiveRetreatCost`: a block is not a cost, so the printed cost stands and there is simply no legal retreat to spend it on |

**L3 rides neither the flag nor an op.** It has no turn duration, so there is nothing to
apply and nothing to clear: the aura is read LIVE off both Active spots and lapses the
instant either end leaves. That means the three D112 read sites take one more `&&` term each
(`turn.ts` gate, `redact.ts` `can`, the web HUD) and nothing else — no new events (a
continuous aura announces nothing), no new error code (`RETREAT_PREVENTED` is reused; only
the *message* differs, because "an attack effect" would be a lie for an Ability), no new op,
no wire field. **The two provenances are two independent guards at the same gate**, which is
what makes the composition trivial.

Alternate wordings were swept and are empty: `cannot retreat`, `can't be retreated`,
`unable to retreat`, `must stay`, `may not retreat`, `can't switch`, `retreating`, and the
U+2019 twins of all of them — **zero** hits. `switch this` returns 15, every one a benign
own-side self-switch. All apostrophes in the pool's retreat text are **ASCII**.

**Where the flag lives, and why not in `SpecialConditions`.** `InPlayPokemon.retreatBlocked`,
a sibling of `conditions`, not a member of it. `SpecialConditions` is pinned field-by-field by
`RedactedConditions` (`@luminous/schema`) and `BattleConditions` (the playmat), and its members
render as status chips, tick at the Checkup and gate ATTACKING — a retreat block does none of
those, and adding a field there would have dragged the wire + playmat into an engine-only
slice. **The reusable rule: a struct something else pins field-by-field is not a free place to
put a new field.** The price is that the three "an effect of an attack ends here" sites clear
one more field by hand (`clearOnLeavingActive` in turn.ts, the evolve literal, the
interpreter's switch); each has a test.

**The lifetime was already in the engine, wearing a different name.** §13.4's paralysis clear
in `runCheckup` — the `endedSeat`-only block — **is** "until the end of your opponent's next
turn"; follow the seats and it lands exactly right. Applied during the ATTACKER's turn, the
block survives the Checkup that immediately follows (`endedSeat` is the attacker there), holds
through the locked player's whole next turn, and lifts at the Checkup ending it. Any future
"during your opponent's next turn" effect copies those four lines. It inherits paralysis's one
caveat — a SELF-applied instance would lift a turn early — unreachable here because both
derived shapes target the defender.

**The read sites were three `&&` terms.** A new `RETREAT_PREVENTED` error code at turn.ts's
retreat gate (its own code, not `STATUS_PREVENTS_RETREAT` — a client rendering
"Asleep/Paralyzed" there would be lying), one term in redact.ts's `can` (**no new wire
field**), one in the web `GameHud.tsx`. New `RETREAT_BLOCKED`/`RETREAT_BLOCK_ENDED` events;
the early clears stay silent, told by their own POKEMON_SWITCHED/POKEMON_EVOLVED row.

**A Switch dodges the lock, and that is correct** — the print refuses *retreating*, not being
moved. So does evolving. Both are tested, because both are the kind of rule a future
refactor silently breaks.

### ⚠️ The ingested pool is SIX sets / 978 cards — re-derive it, never quote it

Every census in this file written before 2026-08-01 says five sets / ~890 cards. That is
**wrong**: the local mirror also holds **`swsh10.5`** (Pokémon GO — 88 cards, reg-mark F,
`legal_standard=0`, `legal_expanded=1`), which no earlier sweep looked at. Per-set counts:
`sv01=258, sv02=279, sv03=230, sv06.5=99, sve=24, swsh10.5=88`.

- The mirror lives at `apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` —
  query it with `sqlite3` directly.
- **COALESCE or you will lose most rows**: `abilities_json || attacks_json` is NULL whenever
  either column is NULL, so a `LIKE` over the raw concatenation silently drops them. Use
  `LOWER(COALESCE(abilities_json,'') || COALESCE(attacks_json,'') || COALESCE(effect,''))`.
- The **live remote D1 holds 3698 cards** through `sv10.5b` + `svp`
  (`bunx wrangler d1 execute luminous --remote --command "…"`). Every seam here is
  ingested-pool-scoped and **reopens the moment a new set is ingested**.
- When a census claims a seam is "N/N closed", say **which** scope: raw local pool, or the
  Standard-legal subset. The retreat-COST seam read 9/10 raw until D114 built Wimpod
  `swsh10.5-025`; it is now **10/10 against the raw local pool**, which is the scope that
  matters — `legal_standard` is *not* a slice-selection criterion (D113).

---

## The CONDITIONAL flat attack-damage bonus (D115, engine 0.66.0) — "If \<clause\>, this attack does N more damage."

The largest unbuilt **attack-text** family in the ingested pool, and the first slice built on
the P3-M5 long tail whose value is a **shared skeleton with independently-priced predicates**
rather than a single card or a single mechanism.

### The census that mattered — sweep the SKELETON, not the PREDICATE

Both leads D114's resume point named were costed first and both were corrected, one fatally.
The lesson is general enough to keep: **when a named lead dies, re-census one level up.** The
resume point pointed at a *predicate* ("Future Pokémon in play", "Stadium in play"); sweeping
the *sentence skeleton* instead turned a dead 1-printing lead into a 43-printing family.

| pattern (case-sensitive, per-attack, whole-sentence) | distinct sentences | printings |
|---|---|---|
| `^If <clause>, this attack does N more damage\.$` | **32** | **43** |
| coin-flip riders (`Flip a coin. If heads, …`) | 13 | 30 |
| `^This attack does N more damage for each …` (built, D54/D110) | 26 | 50 |

Three negative facts from the same sweep, each load-bearing for the anchored regex:
- the pool holds **no** trailing "… more damage **if** …" — the conditional is ALWAYS leading;
- the pool holds **no** `If …, this attack does N **less** damage.` twin;
- **no** sentence combines a leading `If` with a trailing `for each` — so this bucket and the
  three built scaling buckets are **disjoint by construction**. That is what makes
  `^If (.+), this attack does (\d+) more damage\.$` safe next to the exact `for each` arms.

The coin-flip family (26 printings) can never reach an anchored `^If`, because the flip
sentence always precedes it — it is a genuinely different mechanism (a flip is new
information and must be announced; a board condition is not, per the D40 invariant).

### The design — a fourth `DamageCountSource` that is a 0-or-1 INDICATOR

```ts
| { kind: "boardCondition"; cond: BoardCondition }   // effects.ts
```
`per × count` is then the printed flat bonus when the clause holds and **0** when it does not.
Modelling the conditional bonus as a degenerate *count* is what lets it reuse the additive
`AttackDamageBonus` fold whole: **no new fold in attack.ts, no new branch in the §8.5
pipeline, no new op, no new event or event field, no registry row, no web/API/DB/`@luminous/schema`
diff.** This is D110's "a member, not a mechanism" rule applied a second time.

The **only** structural change is that `scaledAttackDamage` gains the **ATTACKER's seat**. It
knew only `defenderSeat`, and a `BoardCondition` is relative to whose board it reads — "you
have a Stadium in play" is the attacker's ownership; "your opponent's Active …" reaches across
from there. `action.seat` was already in scope at the single call site (`snipeActive` does not
use this function), so it is a one-argument change.

The D110 payoff repeats: `effectSimulated` and `modifierSimulated` both flip purely because
`scaling !== null`, so the printed `+` and the sentence stop being flagged **whether or not the
condition holds**. That is correct — the card IS simulated when the answer is "no bonus" — and
it is asserted in both directions.

### The clause table — a `Map`, and unmapped means LOUD

```ts
const CONDITIONAL_DAMAGE_CLAUSES = new Map<string, BoardCondition>([...])
```
**A `Map`, not an object literal, on purpose:** the key is arbitrary PRINTED text, and an
object lookup on arbitrary text can hit `Object.prototype` (`"constructor"`, `"toString"`) and
hand back something that is not a `BoardCondition` at all. Keep it a `Map` for every future
printed-text→structure table.

**An UNMAPPED clause falls through to `null` and stays LOUD** (`ATTACK_EFFECT_SKIPPED`).
Silently scoring an unrecognised condition at 0 would be a wrong number with no failure; the
loud path is a visible gap. Each of the 18 still-unmapped clauses is a future **one-row**
extension — this is the cheapest backlog in the engine right now.

**The whole-sentence anchor is not decoration.** Three printings in the pool contain the
mapped substring `has any damage counters on it` inside a damage-PLACEMENT sentence — Yveltal
`sv06.5-035` "Put 2 damage counters on each of your opponent's Pokémon that has any damage
counters on it.", Vespiquen ex `sv03-096`/`-212` with the Benched twin. A substring matcher
would have scored a bonus off them. (Both currently derive to `null` on *both* paths: the
`Put N counters on EACH <filter>` spread shape is unbuilt, so they sit wholly on the loud path.)

### What landed — D115: 11 printings / 11 ids / 7 cards / 4 sentences, ZERO registry rows

| printed clause | `BoardCondition` | cards | printings |
|---|---|---|---|
| `you have a Stadium in play` | `yourStadiumInPlay` **(already existed)** | Palossand `sv02-096` (+80) | 1 |
| `you have more Prize cards remaining than your opponent` | `morePrizesThanOpponent` **(already existed)** | Gyarados `sv02-043` (+100) | 1 |
| `your opponent's Active Pokémon already has any damage counters on it` | `opponentActiveDamaged` (new) | Meowscarada ex `sv02-015/-231/-256/-271` (+120), Gyarados ex `sv01-045/-225` (+180) | 6 |
| `your opponent's Active Pokémon is an Evolution Pokémon` | `opponentActiveIsEvolution` (new) | Seviper `sv02-137` (+50), Houndoom `sv03-133` (+70), Toxicroak `sv06.5-024` (+90) | 3 |

**Two of the four cost ZERO new predicate code.** The D40 board-condition vocabulary
(2026-07-21, built for Falkner's `conditionGate` and Fighting Au Lait's play gate) is now on
its **fourth consumer** and its first reached through printed ATTACK text rather than a
registry row. When a new printed family shows up, check the existing vocabulary before adding
to it — that is the whole return on having spelled it once.

`opponentActiveIsEvolution` reuses **D105's `evolveFromOf(card) !== null`** verbatim, so the
Evolution reading can never drift from the `evolutionPokemon` CardFilter's.

### The rules call: "already" is a TIMING word, not a predicate refinement

`opponentActiveDamaged` is read at **declaration**, before this attack's own damage lands — so
an undamaged defender cannot bootstrap the bonus with the very hit the bonus is scaling
(Gyarados ex into a clean Active is **180, not 360**). The predicate itself cannot enforce
this; the read site does, and the suite asserts it explicitly. `conditionNote` deliberately
**drops** the "already" — a reject/tooltip fragment is read in the present tense.

## D116 (engine 0.67.0) — the SELF-SCOPED clause, and 4 more table rows

The second wave. The table goes **4 → 8 entries, 18 of the pool's 43 printings**, again on
ZERO registry rows and with **no change to the fold, the ops, the events or the wire** — 4
union members, 4 `conditionHolds` arms, 4 `conditionNote` arms, 4 table rows. `conditionClause.test.ts`
(46) on a dedicated `CONDITION_CLAUSE_DECK`.

| printed clause | `BoardCondition` | cards | printings |
|---|---|---|---|
| `this Pokémon has any damage counters on it` | `yourActiveDamaged` | Talonflame `sv02-030` (+90), Darmanitan `sv03-035` (+60) | 2 |
| `your Benched Pokémon have any damage counters on them` | `yourBenchDamaged` | Tyranitar ex `sv03-066`/`-211` (+100) | 2 |
| `your opponent's Active Pokémon is Poisoned` | `opponentActivePoisoned` | Seviper `sv01-128`, Paldean Clodsire `sv03-129` (both +120, both printing "Venoshock") | 2 |
| `your opponent's Active Pokémon is affected by a Special Condition` | `opponentActiveHasSpecialCondition` | Sableye `sv02-136` (+70) | 1 |

### The design call: a printed PRONOUN resolves in the TABLE, not in `conditionHolds`

"If **this Pokémon** has any damage counters on it" is the family's first clause whose subject
is the card itself, and `BoardCondition` is **shared**: `trainerPlayableIf` (a Trainer play
gate) and the HUD's grey-out read the same union, and a Trainer has no self. Adding a
self-scoped member meaning "the attacker" would have put a value in the vocabulary that two of
its five consumers must never author.

**The member is named for what it READS — `yourActiveDamaged` — and the CLAUSE TABLE resolves
the pronoun.** The table is the only layer that knows the sentence came off an attack, and the
reading is EXACT rather than approximate: §8 lets only the Active declare an attack, so on the
one path this sentence can arrive by, "this Pokémon" *is* "your Active". No second union, no
`context` parameter threaded through `conditionHolds`, one evaluator still.

> **Reusable form:** when a printed sentence's subject is context-dependent, resolve it at the
> site that knows the context and keep the shared vocabulary context-free.

The same reasoning runs through `conditionNote`: `yourActiveDamaged`'s fragment is "your Active
Pokémon has damage counters on it", with the pronoun dropped for the same reason "already" is.

### The other three, and the readings they pin

- **`yourBenchDamaged`** — the printed plural ("your Benched Pokémon **have** any damage
  counters on **them**") is the game's usual **collective "any of them"**, not a requirement
  that every benched Pokémon be damaged. The Active is deliberately excluded (the printed word
  is "Benched", and `yourActiveDamaged` covers the other spot), and an **empty Bench is false**
  rather than vacuously true. The regression the suite catches: damage on Tyranitar ex *itself*
  must NOT satisfy it.
- **`opponentActivePoisoned`** — Poison is a counter **amount** on the model
  (`poisonDamage`, which effects may raise), so "is Poisoned" is `> 0`, exactly as the Checkup
  reads it. Distinct from the still-unmapped **self** twin, Okidogi ex `sv06.5-036`/`-082`/`-090`
  "If **this** Pokémon is Poisoned…" (+130, 3 printings).
- **`opponentActiveHasSpecialCondition`** — reuses **`presentStatuses` verbatim**, the same
  list the status chips and `STATUS_CLEARED` events are built from, so "affected" cannot drift
  from what the board shows. Any ONE of rotation/Poison/Burn suffices.

### Census notes (re-derived against the local D1, 2026-08-01)

- D115's shorthand **confirmed exactly**: 43 printings / 32 distinct sentences — plus a number
  nobody had counted, **26 distinct CLAUSES**. Clauses are what the table costs, so that is the
  number to rank future slices by.
- **"already" is the sole lexical discriminator** between the two damage-counter clauses. One
  word apart, two different members, one own-board and one cross-board.
- Every clause string is ASCII apostrophes + a precomposed U+00E9; the suite pins each one's
  UTF-8 byte length (80/80/92/81/103) because a decomposed `é` or a U+2019 is **invisible in a
  diff** and would silently un-map the row. `TextEncoder` is NOT available under the engine's
  `tsconfig` (`lib: ["ES2022"]`, `types: []`) — the suite uses a local code-point summer.
- Sableye's clause is the pool's **only** "is affected by" printing. The setter form ("is now
  affected by that Special Condition", Vivillon `sv01-010`) is a different sentence entirely.

### Costed and NOT built

- **Slither Wing `sv06.5-026`** ("If your opponent has any **Future** Pokémon in play…") is
  **blocked on an ingest change**, not on engine work. The `cards` table has **no subtype/tag
  column and no column that could hold one**; the upstream tcgdex `suffix` field IS parsed
  (`packages/schema/src/tcgdex/card.ts`) but **dropped before the D1 insert** — and it carries
  the rule-box suffix (`ex`/`V`), never the Ancient/Future tag. In the ingested pool "Future
  Pokémon" is a **1-card name list** (only Iron Moth `sv06.5-009` could satisfy it) that rots
  the moment sv04/sv05 ingest. Do not hardcode the name list.
- **Paldean Clodsire ex `sv02-130`/`-244`** is NOT part of the Stadium sub-shape: its sentence
  is on an **Ability**, and it reads *presence* ("if **a** Stadium is in play"), not the
  ownership `yourStadiumInPlay` encodes. A different seam. **Falkner `sv02-180`/`-251` was
  already built** (D40). So the "5 printings" the D114 resume point recorded for this
  sub-shape was really **one**: Palossand.

## D117 (engine 0.68.0) — the clause table's third wave: the SELF-Poison twin and the rule-box clause

The table goes **8 → 10 entries, 22 of the pool's 43 leading-`If` printings**, on ZERO registry
rows and with **no change to the fold, the ops, the events or the wire** — 2 union members, 2
`conditionHolds` arms, 2 `conditionNote` arms, 2 table rows. `clauseTable.test.ts` (38) on a
dedicated `CLAUSE_TABLE_DECK`.

| printed clause | `BoardCondition` | cards | printings |
|---|---|---|---|
| `this Pokémon is Poisoned` | `yourActivePoisoned` | Okidogi ex `sv06.5-036`/`-082`/`-090` "Chain-Crazed" (+130) | 3 |
| `your opponent's Active Pokémon is a Pokémon ex or Pokémon V` | `opponentActiveIsExOrV` | Ceruledge `sv02-098` "Fighting Sword" (+100) | 1 |

### D116's pronoun rule, used a second time — call it settled

`yourActivePoisoned` is the exact SELF twin of D116's `opponentActivePoisoned`, and the printed
subject is again the pronoun "this Pokémon". Same resolution, no new argument needed: **the
member is named for the board fact it READS, and the CLAUSE TABLE resolves the pronoun**, because
`conditionHolds` is shared with `trainerPlayableIf` and the HUD, where a self has no referent.
`conditionNote` drops the pronoun for the same reason ("your Active Pokémon is Poisoned").

**The lexical fact this slice pins:** a COALESCE'd sweep for `is Poisoned` over the ingested pool
returns **exactly five printings, all now mapped** — 3 self (Okidogi ex) and 2 cross-board
(Seviper `sv01-128`, Paldean Clodsire `sv03-129`). The two clauses are **one possessive apart and
read OPPOSITE boards**. That is the standing argument for keying the table on whole printed
clauses and never on substrings, and both directions are asserted in `conditionClause.test.ts`
(which owned the self clause as its unmapped near-miss witness until this slice) and again here.

### `opponentActiveIsExOrV` is `isExOrV`, NOT `hasRuleBox`

The sentence names ex and V and nothing else, so it reuses **D107's `isExOrV`** verbatim (the same
predicate Mimikyu "Safeguard" reads) rather than the wider `hasRuleBox`, which also matches
VMAX/VSTAR/GX and Radiant. A VMAX Active does **not** satisfy the clause, and that is the case in
the suite that catches conflating the two. It inherits `isExOrV`'s one limitation: the class is
derived from the card NAME's suffix, tcgdex's structured markers being dropped at ingest.

### The board finding: an own-side Poison can only arrive from across the table

Okidogi's own index-0 "Poisonous Musculature" self-Poisons — and is **UNBUILT** (a deck search +
attach + shuffle + a conditional self-Poison in one sentence pair, which neither deriver owns), so
it stays on the loud `ATTACK_EFFECT_SKIPPED` path. There is therefore **no way to Poison your own
Active from your own side of the board**, and the suite arms the clause the way the real game
does: P2's Seviper `sv01-128` "Spit Poison" applies it, §13.1's Checkup ticks it (10 on the
attacker, asserted rather than dodged), and Chain-Crazed reads it a turn later for 260. Worth
remembering for any future SELF-status clause — the arming path is the opponent's turn.

### Notes for the next wave

- All three Okidogi printings are **byte-identical in rules text** (one distinct
  `hex(attacks_json)`; only id/local id/rarity/illustrator differ), so **one fixture serves three
  ids** — the Tyranitar ex pattern again. Check this before authoring a second fixture.
- The UTF-8 byte-length pin does **not** have a `+1` invariant: it is `length + count("Pokémon")`.
  Chain-Crazed prints `Pokémon` once (62 chars / 63 bytes), Fighting Sword three times (97 / 100).
- **A corrected fixture docstring:** Ceruledge's index-0 "Life Sucker" ("Heal 30 damage from this
  Pokémon.") is **not** a built program — the op deriver owns only the compound `SELF_SLEEP_HEAL`
  form (`This Pokémon is now Asleep. Heal N damage from it.`). The bare self-heal sentence family
  is unbuilt and loud; it is a real, small, unclaimed slice.
- The "unmapped stays LOUD" witness in `conditionalDamage.test.ts` has now moved twice (Venoshock
  → Ceruledge → **Greedent `sv01-152` "Enhanced Fang"**, "If this Pokémon has a Pokémon Tool
  attached, …"). Re-point it, never delete it — it is the only thing pinning the fall-through.

## D118 (engine 0.69.0) — the FIRST PARAMETERISED clause, and a second resolution pass

The clause family's fourth wave, and the first one that is **not** a table row. 6 printings / 5
cards / 4 sentences on **zero registry attack rows**, with no change to the fold, the ops, the
events or the wire. `energyClause.test.ts` (51) on a dedicated `ENERGY_CLAUSE_DECK`.

| printed clause | `BoardCondition` | cards | printings |
|---|---|---|---|
| `this Pokémon has any {R} Energy attached` | `yourActiveHasEnergyAttached` `{energy:"Fire"}` | Scovillain `sv01-029`/`-202` "Super Spicy Breath" (+90) | 2 |
| `this Pokémon has any {L} Energy attached` | … `{energy:"Lightning"}` | Galvantula `sv06.5-002` "Shocking Web" (+80) | 1 |
| `this Pokémon has any Special Energy attached` | … `{energy:"special"}` | Cetitan `sv02-055` "Special Horn" (+140), Tinkaton `sv02-105` "Special Hammer" (+90) | 2 |

### The design call: the parameter belongs in the union

D117's resume point left this open, and the census answers it. Four literal rows would have
covered today's four sentences — but this is a **template**, not four sentences: the pool prints
**nine** energy codes in **two rival notations**, so the literal form costs a table row *and* a
union member per type per notation forever while the template costs **nothing** for the tenth
printing. The parameter is the only axis the printed sentences vary on.

```ts
| { kind: "yourActiveHasEnergyAttached"; energy: BasicEnergyType | "special" }
```

> **Reusable form:** a clause that varies on ONE token is a pattern, not N rows. Keep the literal
> table for clauses that genuinely differ, and add a second pass for the ones that don't.

`boardConditionForClause(clause)` (effects.ts) is that second pass, and the ORDER is load-bearing:
the literal `CONDITIONAL_DAMAGE_CLAUSES` table first, then anchored whole-clause templates. Literals
win by construction, so adding a template can never re-interpret a clause a row already owns. The
outer `^If (.+), this attack does (\d+) more damage\.$` anchor is untouched; the template
(`^this Pokémon has any (.+) Energy attached$`) is itself whole-clause anchored, so the capture is
the token alone.

The token vocabulary is a **`Map` built FROM the two existing notation maps** (`ENERGY_TYPE_BY_CODE`
+ `ENERGY_TYPE_BY_NAME`) plus `Special`. D115's rule one level down — an object lookup on arbitrary
printed text can hit `Object.prototype` — and building it from the existing maps is what stops the
three vocabularies drifting. An unresolvable token falls through to null and stays LOUD.

### `"special"` is a different AXIS, not a tenth type

The card CLASS, not an energy type — which is why the parameter is `BasicEnergyType | "special"`
rather than a widened type union. **The Luminous+Jet board is where that shows**: with a demoted
Luminous and a Jet attached, the `{R}` clause reads FALSE while the `Special` clause reads TRUE.
Modelled as a tenth type, the two could not disagree.

`{C}` is refused for exactly the reason it is absent from `ENERGY_TYPE_BY_CODE`: Colorless is the
conservative provision fallback for every unauthored Special Energy, so a `{C}` filter would quietly
match cards nobody meant — and the demoted Luminous on that same board genuinely does provide it.

### The predicate is PROVISION, not the printed name

continuous.ts's new `hasAttachedEnergy(state, pokemon, energy)` — `providesEnergyType` for a type,
`isSpecialEnergy` for the class. It lives beside the provision code for the reason `unitsProvidedBy`
already gives: **"an Energy that can pay a {R} cost" and "an Energy this clause counts" must be one
question.** The consequence is testable and is the slice's best case: a wildcard **Luminous Energy
alone satisfies `{R}`** on a Grass Scovillain (→180), and attaching a **second** Special demotes it
to `{C}` so the SAME board — nothing left, no counter moved, same attacker — scores **90**. A
name-matching read cannot behave that way.

D116's pronoun rule, **third use**: the member is named for the board fact it READS and the clause
pattern resolves the printed "this Pokémon". `conditionNote` is the family's first note **built from
a parameter** rather than returned as a literal.

### Census notes (local D1, 2026-08-01)

- The leading-`If` skeleton holds **five** Energy-mentioning sentences: these four plus Absol
  `sv06.5-030`'s "you have at least **3 {D} Energy in play**" — a whole-board count, a different
  scan, and now the suite's **live** unmapped witness (the outer shape matches and the clause still
  misses, which is the strongest possible proof the fall-through is loud).
- **Notation is split by SET, not mixed:** sv01/sv02/sv03/sv06.5 use brace codes exclusively;
  **swsh10.5 spells names out exclusively** ("Water Energy", "Psychic Energy") — 25 matching cards,
  zero brace codes. Nothing in swsh10.5 prints *this* sentence today, so the spelled-out arm is
  covered by a **constructed** test and labelled as such; a code-only parser would silently skip a
  whole set the moment one of its cards prints the shape.
- The near-misses are real and close: **Okidogi `sv06.5-074`'s ABILITY** ("If this Pokémon has any
  {D} Energy attached, **it gets +100 HP**, …") is prefix-identical to the mapped shape;
  **`sv03-022`** prints the mapped substring inside a `for each` sentence; **Haxorus `sv06.5-046`**
  is the opponent-scoped twin ("… it is Knocked Out."). All three stay null, all three are asserted.
- Only **4 Special Energy** cards exist in the ingested pool, all sv02 (Jet `sv02-190`, Luminous
  `sv02-191`, Reversal `sv02-192`, Therapeutic `sv02-193`). Luminous's own printed text ("has any
  **other** Special Energy attached") is a second, self-referential instance of the same predicate.

### A shorthand corrected

The family's registry claim is **"zero registry ATTACK rows"**, not "zero registry rows". Tinkaton
`sv02-105` already carries an **abilities-only** program (Gather Materials, authored in the
payFromHand slice) on a key the attack path never consults. The suite asserts it both ways — four
ids with no row at all, Tinkaton's row named and explained — rather than tolerating a claim that is
almost true. Check `programFor(id)?.attack`, not `programFor(id)`, when making this claim again.

## D119 (engine 0.70.0) — the PUBLIC-COUNT cluster: clauses that read no Pokémon at all

The clause family's fifth wave. 5 printings / 4 cards / 4 clauses on **zero registry rows**, with no
change to the fold, the ops, the events or the wire. `publicCount.test.ts` (44) on a dedicated
`PUBLIC_COUNT_DECK`.

| printed clause | `BoardCondition` | card | printings |
|---|---|---|---|
| `your opponent has exactly 1 Prize card remaining` | `opponentPrizesRemaining` `{counts:[1]}` | Krokorok `sv01-116` "Payback" (+90) | 1 |
| `your opponent has exactly 2 or 4 Prize cards remaining` | … `{counts:[2,4]}` | Houndstone `sv03-101` "Two Four-ocious" (+120) | 1 |
| `your opponent has 3 or fewer cards in their hand` | `opponentHandAtMost` `{count:3}` | Absol ex `sv03-135`/`-214` "Cursed Slug" (+120) | 2 |
| `you have the same number of cards in your hand as your opponent` | `handSizesEqual` | Bronzong `sv03-145` "Extrasensory" (+90) | 1 |

### The rules call: a COUNT is public even when the cards are not

`BoardCondition`'s standing invariant says every member reads only public state, and it names **"a
hand's CONTENTS"** as the thing that would break it. A hand's **SIZE** is on the other side of that
line: both players watched every draw, play and discard that set it. redact.ts already agrees — the
opponent's hand ships as `hiddenHand(side.hand.length)`, face-down backs with a real length — so
these three members are *more* online-evaluable than `yourStadiumInPlay`, which the wire withholds.
None of them widens the P4 gap.

> **Reusable form:** when a printed clause reads a hidden zone, ask whether it reads the zone or a
> COUNT over it. A count is usually public and usually already on the wire.

### `exactly` is set MEMBERSHIP, never a range

`counts: readonly number[]`, matched with `.includes`. `[2, 4]` is **not** "2 to 4" — the case that
catches the confusion is a 3-Prize board reading FALSE between two true values, and the suite sweeps
0-6 rather than sampling. The single-valued `[1]` is the degenerate case of the same member, which
also makes **0 Prizes FALSE** — the thing a "1 or fewer" reading would get wrong.

### Two values, one member — and still two LITERAL rows

The two Prize sentences share a shape, so they share a member (D118's rule). They do **not** share a
template, and the reason is the rule's own wording — "one TOKEN varying":

- **Two things vary**, the count LIST and the grammatical number agreeing with it ("1 Prize **card**"
  vs "2 or 4 Prize **cards**"). A pattern spanning both needs `cards?`, which would then accept
  "exactly 2 Prize card remaining" — text the game does not print.
- **The printed space is bounded and tiny.** A Prize count is 0-6, and the whole 978-card pool holds
  three distinct lists across every use of the word "exactly". D118's template paid because the
  energy space was nine tokens × two notations × forever.
- **It is reversible by construction.** `boardConditionForClause` runs literals FIRST, so a template
  added later cannot re-interpret either row. Choosing the cheap form costs nothing later.

The two HAND sentences stay **two members** for a different reason: a threshold against a printed
constant and an equality between the two hands are different comparisons over different operands.
They share a noun and nothing else. `handSizesEqual` is the vocabulary's first **seat-symmetric**
member (equality commutes) — asserted from both seats rather than assumed.

### `conditionNote` round-trips here, and only here

All four notes are **character-for-character the printed clause**. Every earlier note in the family
had to drop something: a pronoun with no referent on the board (D116/D117) or the timing word
"already" (D115). These clauses name no Pokémon and no timing, so nothing needs dropping — and the
Prize note builds its own grammatical agreement from the parameter (`printedList` spells `1`,
`2 or 4`, `2, 4, or 6` the way the pool does). The suite asserts the round-trip against the clause
table's own keys.

### Census corrections (local D1, 2026-08-01) — three, all load-bearing

1. **The skeleton is bigger than the docs' number.** `^If (.+), this attack does (\d+) more damage\.$`
   matches **71 printings / 45 sentences / 32 clauses**. The long-quoted **43 / 32 / 26** is that set
   **minus the 26-printing coin-flip family minus one anaphoric `you do`** (Cresselia `sv06.5-021`/
   `-071`, "You may turn 1 of your face-down Prize cards face up. If you do, …"). Both numbers are
   right; 43/32/26 is the backlog, 71/45/32 is what the regex sees. Say which one you mean.
2. **One attack can carry three skeleton sentences.** Bisharp `sv03-149` "Fury Cutter" prints the
   shape three times (20/60/120) in a single `effect`, which is why printings (71) exceed distinct
   ids (69). A per-card census undercounts.
3. **`exactly` is a Prize-only word in this pool** — 5 sentences, zero hand-count, in three
   grammatical forms (`exactly 1`, `exactly 2 or 4`, `exactly 2, 4, or 6`). And **`or fewer` occurs
   twice in 978 cards, both the same Absol ex string**; there is no `N or more cards in hand` shape
   anywhere yet.

### The near-misses, and the one that matters

- **Bronzor `sv03-144` "Mirror Draw"** — Bronzong's own **pre-evolution** — prints Extrasensory's
  entire clause word for word inside a DRAW effect ("Draw cards until you have the same number of
  cards in your hand as your opponent."). A substring matcher scores a damage bonus off it; the
  whole-sentence anchor refuses it. This is the sharpest real near-miss the family has found.
- **Slowbro `swsh10.5-020`** prints Payback's clause in a USABILITY frame ("You can use this attack
  only if …") — a real future slice (an attack-level `playableIf`), not a bonus.
- **Slaking V `swsh10.5-058`/`-077`** prints the three-value list on an **Ability**, own-seat: it
  would want a `yourPrizesRemaining` sibling. Unbuilt, and loud.
- ~20 rows print "cards in your hand" as a **draw target** and one (Xerosic's Machinations) as a
  discard target. None is a condition.

### Board facts this slice pinned down

- **With mulligan compensation declined (`extraDraw: 0`), both hands are exactly 7** at P1's turn 2
  (7 dealt − 1 placed as the Active + 1 drawn). So `handSizesEqual` is TRUE on the untouched board —
  the family's first clause that the real setup arms by itself. **One more `endTurn` makes it 7 and
  8**, because the draws alternate: the equality is a property of *where in the turn cycle you look*.
  Declining compensation is what makes a hand-size suite seed-independent at all.
- **A two-Prize knockout moves the row 6 → 4 in one swing**, which is exactly one of Houndstone's two
  printed values — so the clause can be armed through the real §8.1 path (damage surgery on the
  doomed body, then a genuine attack, `takePrizes` with **both** indices in one action, `promote`).
  `takePrizes` requires exactly `count` indices per call; after `promote` the phase is already
  `turn:action` for the KO'd player, because attacking ended the attacker's turn.
- `fix-bigbody` carries **no attacks** (`battler` defaults them to null), so any case that needs the
  far seat to swing must field a real attacker there.

### Still unmapped after this slice (13 → 17 of 26 clauses mapped)

`this Pokémon moved from your Bench to the Active Spot this turn` (3, needs per-turn state) ·
`this Pokémon has a Pokémon Tool attached` (1, a loud witness) · `you have at least 3 {D} Energy in
play` (1, the other loud witness) · `your opponent's Active Pokémon is a Dragon Pokémon` (1, cheap) ·
`Falinks is on your Bench` (1, needs a name field) · three that need new per-turn/cross-turn state ·
`your opponent has any Future Pokémon in play` (blocked on an ingest change) · and the 26-printing
coin-flip family, which is a different mechanism and deserves its own costed slice.

## D120 (engine 0.71.0) — TYPE and NAME: when a one-token clause may be a TEMPLATE

Two clauses, both singletons, both varying on **exactly one token**, and they get **opposite
treatments**. That is the whole reason they were built in one slice.

- **Sylveon `swsh10.5-035` "Wonder Flash"** (`90+`, +90) — "If your opponent's Active Pokémon is a
  **Dragon** Pokémon, this attack does 90 more damage." → a **TEMPLATE**,
  `{ kind: "opponentActiveHasType"; type: PokemonType }`.
- **Falinks `sv02-119` "Reckless Charge Together"** (`70+`, +90) — "If **Falinks** is on your Bench,
  this attack does 90 more damage." → a **LITERAL ROW**,
  `{ kind: "yourBenchHasNamed"; name: string }`.

Both derive straight off printed text; neither card has a registry row of any kind.

### The rule this slice adds — D118's missing precondition

D118 said: *a clause that varies on ONE token is a pattern, not N rows.* True, and not sufficient.
The question a template has to answer is **what happens to a token it does not recognise**, and the
only good answer is "nothing, loudly".

- A **type name** has a closed vocabulary: `POKEMON_TYPES`, eleven words. So
  `^your opponent's Active Pokémon is a (.+) Pokémon$` can capture `Basic` — a real reading the pool
  prints on another skeleton (Houndoom ex `sv03-134`, "If the Defending Pokémon is a Basic Pokémon,
  it can't attack…") — fail to resolve it, and leave the sentence on its `ATTACK_EFFECT_SKIPPED` row.
- A **card name** has none. `^(.+) is on your Bench$` has nothing to reject against: it would read
  "a Pokémon with an Ability is on your Bench" as a card *called* "a Pokémon with an Ability", build
  a perfectly well-formed condition, and answer **FALSE on every board forever** — no throw, no
  skipped row, no symptom at all. Wrong-with-no-failure is the one outcome this family refuses.

So: **ask what an unrecognised token does before writing the regex.** The printing COUNT is not the
test — these two clauses are both singletons and they diverge anyway. Both calls stay reversible in
D119's direction, since `boardConditionForClause` runs literals FIRST: a name template added later
(once something can validate a name against the catalog) cannot re-interpret the Falinks row.

### `POKEMON_TYPES` — a Pokémon type is WIDER than an energy type

```ts
export const POKEMON_TYPES = [...BASIC_ENERGY_TYPES, "Dragon", "Colorless"] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];
```

Built FROM the schema list (D118's anti-drift rule), not re-typed. `Colorless` and `Dragon` are
absent from `BASIC_ENERGY_TYPES` for good reasons — a cost symbol, and a type with no Basic Energy —
but a **Pokémon** is very much allowed to BE either: **117 of the pool's 978 rows are** (100
Colorless, 17 Dragon). Typing a Pokémon-type condition with `BasicEnergyType` makes Sylveon's clause
literally unspellable. Keep the two vocabularies distinct and build the wider one from the narrower.

`conditionHolds` reads `activeTop(...).card.types` with `.includes` — the same field and the same
read `weaknessOf`/`resistanceOf` make two lines later in the §8.5 pipeline, so a printed type cannot
mean one thing to the clause and another to the multiplier it feeds. `types` is null on Trainers and
Energy (hence `?? []`), and every Pokémon row in the pool carries exactly one type; the predicate is
written for an array anyway, since dual types are a real printing.

### `yourBenchHasNamed` — the vocabulary's first card IDENTITY

Every member before it asks what a Pokémon *is* (damaged, Poisoned, an Evolution, an ex). This one
asks *which card it is*. That is fine for a shared vocabulary — `CardFilter.byName` and the aura's
`exemptAbilityNamed` already do it, and the deck builder keys on names all day — with three rules:

- **Read the stack TOP** (§1.2, via `topCardOf`), so evolving the named Pokémon stops satisfying it.
- **Honour the printed zone word.** "Bench" excludes the Active, exactly as `yourBenchDamaged` does;
  the attacking Falinks does not count itself. An empty Bench is false.
- **Do not model it as "another copy of me"**, tempting though it is: both pool printings of the
  shape happen to name their own card, but the sentence names a CARD, and Lunatone `sv03-092`'s "If
  you have Solrock in play" is already the counterexample sitting in the same pool.

### Census notes (local D1, 2026-08-01)

- The word **"Dragon" appears in exactly ONE sentence in 978 cards** — this one. Four spelled-out
  `<Type> Pokémon` sentences exist in total, the other three being the swsh10.5 Moltres/Articuno/
  Zapdos "Symbol" buffs (a static own-side selector, not a predicate). The 17 brace-coded
  `{X} Pokémon` sentences are all selectors and counters on other skeletons.
- **A Pokémon's TYPE is printed as the bare word in BOTH notation eras**, so D118's brace-code vs
  spelled-name split (which is real for ENERGY, and splits cleanly by set) does not apply here.
- `is on your Bench` → **3 sentences, 2 in a clause frame**. The second is Flamigo `sv03-185`
  "Synchronized Feathers", which prints Falinks' clause word for word under a **different
  consequent** ("…this attack ALSO does 60 damage to 1 of your opponent's Benched Pokémon"), so it
  never reaches the leading-`If` skeleton. One row per printing is what per-printing means.
- **`<Name> is in the Active Spot` does not exist in the pool at all** — all 28 "in the Active Spot"
  sentences use a pronoun. Do not build for it.
- Other named-card predicates, for whoever generalises this later: Lunatone `sv03-092` ("If you have
  Solrock in play"), Munkidori ex ×3 ("if you have any Pecharunt ex in play"), Vespiquen `sv02-009`
  ("If you can't shuffle a Combee into your deck"). Across that family **three** things vary — the
  name, the zone/quantifier and the consequent — which is a second reason the Bench clause is a row.

### Fixture notes

- **Drampa `sv03-161`** is the Dragon body. The pool offered three Basic Dragons with no ability
  (Noibat `sv02-152`, Dratini `sv03-157`, Drampa); Drampa's **120 HP** is the only one that survives
  the un-armed 90 and dies to the armed 180, so the control/armed pair differs in more than a number.
  It carries neither Weakness nor Resistance, so the 180 is the fold alone.
- **`fix-fighting-weak` is SYNTHETIC**, and deliberately: no faithful ×2 Fighting body in the pool is
  inert — every one carries attacks, an ability or a rule box. It is a sibling of the existing
  `fix-psychic-weak`/`fix-water-weak` bodies.
- `board()` pins **both** setup Actives by name. `setActiveFromDeck` pushes the sitting Active onto
  the **Bench** — the exact zone the Falinks clause reads — so an unpinned starter would have made
  the clause deal-dependent.

### The loud-witness bookkeeping

This slice mapped the clause that **both** surviving "unmapped stays LOUD" cases were using, so both
were **re-pointed, never deleted**: `clauseTable.test.ts` → Lokix `sv02-021` (evolved-this-turn),
`conditionClause.test.ts` → Lucario `sv01-114` (last-turn KO). The two older witnesses
(`conditionalDamage.test.ts` → Greedent `sv01-152`, `energyClause.test.ts` → Absol `sv06.5-030`) are
untouched. Whenever a slice maps a witnessed clause, re-point the case in the same commit.

### Still unmapped after this slice (17 → 19 of 26 clauses mapped)

`you have at least 3 {D} Energy in play` (1, a loud witness — a board-wide fold over D118's provision
predicate, and a template by D120's test since the energy vocabulary is closed) · `this Pokémon has a
Pokémon Tool attached` (1, the other loud witness) · `this Pokémon moved from your Bench to the Active
Spot this turn` (3, **needs new per-turn state** and is the biggest printing count left outside the
coin flips) · three that need new per-turn/cross-turn state (`evolved from Nymble during this turn`,
`played a Supporter … during this turn`, `any of your {F} Pokémon were Knocked Out … last turn`) ·
`your opponent has any Future Pokémon in play` (blocked on an ingest change) · and the 26-printing
coin-flip family, a different mechanism that deserves its own costed slice.

---

## D121 — the BOARD-WIDE Energy count (engine 0.72.0)

Absol `sv06.5-030` "Darkfall": *"If you have at least 3 {D} Energy in play, this attack does 50 more
damage."* One card, one clause, zero registry rows, no fold change.

### The one word

`attached` (D118) scopes to a **single Pokémon** — nine printings across four cards. `in play` means
**your whole side of the table**. The predicate underneath is deliberately the SAME (provision, not
the printed name, computed on the holder); only the fold over it is new.

- `continuous.ts countEnergyInPlay(state, seat, energy)` sits **beside `hasAttachedEnergy`**, for that
  module's standing reason: the reading must not drift from what pays a cost. "A {D} Energy" means the
  same card whether the sentence scopes it to one Pokémon or to the board.
- It counts **CARDS, not units of provision**. One Energy is one Energy however many symbols it
  offers. A wildcard is 1, not 9.
- Active + Bench, via continuous.ts's null-safe `holders` idiom (`side.active === null ? side.bench :
  [side.active, ...side.bench]`), so a side mid-promotion counts its Bench rather than throwing.

### The template rule, corrected

**D120's resume point predicted a TEMPLATE here** ("the energy token vocabulary being closed"). The
census reversed it, and the correction is the reusable part:

> **D120's closed-vocabulary precondition tells you when a template is SAFE. It never tells you when
> one is WARRANTED. The warrant is a second printing.**

Here there is none: **`at least` and `Energy in play` are each a HAPAX in the ingested 978 cards.**
And two tokens could vary (the threshold *and* the energy), so D118's one-token test fails outright
and **D119's corollary applies — take the literal row.** The MEMBER is still parameterised, exactly
as `opponentPrizesRemaining` is: `conditionHolds` genuinely compares a count against a threshold.
What is literal is the **table key**. Rows match first, so a template can be added over it later.

The printed **"at least" makes it `>=`** — a threshold, not D119's set membership. That is the whole
difference from its nearest sibling, and it is swept 0-5 rather than sampled: `===` for `>=` fails on
a single value ABOVE the line and survives a two-point check.

### Census facts (local D1, 2026-08-01)

- The sentence is **PURE ASCII, 75 code points / 75 bytes** — it names no Pokémon and carries no
  apostrophe of either kind. The family's simplest byte claim.
- **No reprint.** `sv06.5-030` is the only card in the pool named exactly "Absol"; the two "Absol ex"
  printings are a different card (and are byte-identical to each other).
- **"in play" attaches to exactly three noun kinds pool-wide**: Pokémon, Stadium, and Energy on this
  one card. It never co-occurs with a narrowing scope word, and cards that mean a hidden zone say "in
  your discard pile" / "in your hand". So the field-scoped reading is the only one consistent with the
  catalog — but note it rests on a single printing.
- **A trap for a sentence-level matcher:** split effects on sentence boundaries and the leading-`If`
  anchor additionally captures **27 coin-flip / "you do" clauses**. It must stay anchored to the WHOLE
  effect string.
- The whole-effect skeleton re-confirmed row by row at **43 printings / 32 distinct (condition, N)
  pairs / 26 distinct clauses**.

### Fixture notes

- **The plain `{C}` line in `ENERGY_IN_PLAY_DECK` is load-bearing, not padding.** Darkfall costs a
  bare `{C}`; paying it with a Darkness Energy would put a **counted** card on the attacker in every
  case and confound "in play" with "attached" in exactly the direction this clause is most likely to
  be wrong. `fix-energy` pays and counts zero, which is what makes "3 on the Bench, nothing on Absol"
  a reachable board.
- `fix-darkness-weak` is **SYNTHETIC**, on the `fix-fighting-weak` precedent (D120) and for the same
  reason: no faithful ×2 Darkness row in the file is inert.
- `board()` leaves both benches **EMPTY** — the pinned starter is what the deal opened with, so
  nothing is displaced. A bench body appears only where a surgery fields an attacker over the top of
  it, so the arming helper seeds a holder when the seat has none. (This differs from the D120 suite,
  where every armed seat was also the seat that fielded an attacker.)
- **Absol's whole cast is one attack**, so the family's usual index-keyed negative becomes "the array
  has length 1".

### The sharpest test in the suite

A **second** Luminous Energy attached to the same body **disarms** the clause: the two Specials demote
each other to `{C}`, neither counts any more, and the same attacker on the same board with **one MORE
card attached** scores 20 instead of 70. A name-matching read cannot behave that way. Its control —
two Luminous on **different** bodies both count — is what pins that provision is computed per holder.

### The loud-witness bookkeeping

This slice mapped `energyClause.test.ts`'s witness, so it was **re-pointed, not deleted** →
**Slither Wing `sv06.5-026`** ("any Future Pokémon in play"). That keeps the case's original `in play`
vs `attached` discriminator intact, and it is the better long-term choice: it is blocked on an
**ingest** change (the catalog parses tcgdex's `suffix` but drops it before the D1 insert), so no
table row can map it out from under the case.

### Still unmapped after this slice (19 → 20 of 26 clauses mapped)

`this Pokémon has a Pokémon Tool attached` (1, Greedent `sv01-152` — the last cheap one, and
`conditionalDamage.test.ts`'s loud witness) · `this Pokémon moved from your Bench to the Active Spot
this turn` (3 — **needs new per-turn state**, the biggest printing count left outside the coin flips)
· three needing new per-turn/cross-turn state (`evolved from Nymble during this turn`, `played a
Supporter … during this turn`, `any of your {F} Pokémon were Knocked Out … last turn`) · `your
opponent has any Future Pokémon in play` (blocked on an ingest change) · and the 26-printing
coin-flip family, a different mechanism that deserves its own costed slice.

## D122 — the POKÉMON TOOL clause (engine 0.73.0)

Greedent `sv01-152` "Enhanced Fang" — "If this Pokémon has a Pokémon Tool
attached, this attack does 80 more damage." One printing, one card, one clause,
no reprint. The table goes **16 → 17 literal rows + 2 templates, 21 of 26
distinct clauses / 37 of 43 printings**.

### The seam this closes

**Every clause in this family that reads a field the model already carries is now
mapped.** The five left are not table rows:

- `this Pokémon evolved from Nymble during this turn` (Lokix `sv02-021`)
- `you played a Supporter card from your hand during this turn` (Pikachu
  `swsh10.5-027`)
- `this Pokémon moved from your Bench to the Active Spot this turn` (Revavroom ex
  `sv06.5-015`/`-081`, Golisopod `swsh10.5-026` — **3 printings, the best
  printings-per-clause left**)
- `any of your {F} Pokémon were Knocked Out … during your opponent's last turn`
  (Lucario `sv01-114`)
- `your opponent has any Future Pokémon in play` (Slither Wing `sv06.5-026`) —
  blocked on an INGEST change, not engine work

The first four all want the same kind of thing: **per-turn / cross-turn state that
the engine does not record today.** They are one design slice, not four rows, and
the right move is probably to cost them together.

### Why this member was the cheapest in the vocabulary

`InPlayPokemon.tools` is already a uid array beside `energy` and `stack`, and
**every uid in it reached it through `attachTool` (cardplay.ts), which refuses
anything whose `trainerType` is not `"Tool"` before it can land.** So there is no
reading question of the kind D118's Energy clauses have — an Energy card can pay
for a type it is not named after, which is why that predicate had to be PROVISION
and had to live in continuous.ts. A Tool is a Tool. The predicate is
`active.tools.length > 0` and this slice adds **no continuous.ts diff at all**.

### The one real call: `> 0`, never `=== 1`

§7.4 caps a Pokémon at one Tool. That cap is enforced **at the attach gate** — and
Revavroom ex `sv03-156`'s "Tune-Up" Ability raises it to 4. A predicate written to
the printed singular ("a Pokémon Tool") would answer FALSE on a board the sentence
plainly describes.

> **A rule enforced at a GATE is not an invariant of the state the gate writes
> into. Read the state, not the rule.**

Worth carrying: the same shape will recur wherever a §-rule is checked on the way
in rather than held true on the way out.

### The near-misses, and why the whole-sentence anchor earns its keep here

Two other cards print this clause's exact words under a different consequent:

- **Genesect `sv06.5-040` "ACE Nullifier"** — *byte-identical through the comma*
  ("If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE
  SPEC cards from their hand.")
- **Stunfisk `sv03-112` "Custom Trap"** — the same words as a **middle conjunct**

Both are Abilities. A `.includes` matcher would have scored a damage bonus off two
Abilities; the anchored whole-effect match does not. This is the sharpest instance
so far of the rule the table has carried since D115.

### Census facts (local D1, 2026-08-01)

- `43 / 32 / 26` re-confirmed **row by row** (printings / distinct (clause, N)
  pairs / distinct clauses).
- `sv01-152` is a **singleton**: the only card named "Greedent", and its
  `attacks_json` is unique in the catalog.
- The effect string is **77 code points / 79 UTF-8 bytes**, two é, **no apostrophe
  of either kind**.
- **`for each Pokémon Tool` occurs ZERO times in 978 cards** — there is no
  per-Tool scaling family waiting to land, so the bare tag needs no parameter.
- Pool-wide byte fact worth keeping: the ENTIRE text corpus (attacks + abilities +
  effect across 978 rows) holds exactly **two** distinct non-ASCII code points,
  **U+00D7 `×`** and **U+00E9 `é`**. **No U+2019 anywhere** — every possessive is
  ASCII. Confirms D113's finding at the whole-corpus level.

### A harness fact that shaped the whole suite

**`attachTool` refuses UNAUTHORED Tools with `TRAINER_NOT_SIMULATED`, so there is
no Tool in the pool that attaches successfully while doing nothing.** `fix-tool`
cannot arm this clause through a real action. That is why the deck carries two
*real* Tools, chosen so the pair separates the clause from the Tool:

| Tool | Passive | Role |
|---|---|---|
| Bravery Charm `sv02-173` | `basicHpBonus: 50` | **SILENT arm** — Greedent is a **Stage 1**, so the +50 does not apply (`effectiveMaxHp` still 120) and the whole 80-point swing is the clause's |
| Vitality Band `sv01-197` | `damageBonusBeforeWR: 10` | **LOUD arm** — arms the clause *and* adds its own +10 in the same pre-W/R step: **170** against the Charm's **160** |

A fold that mistook the Tool's own passive for the clause would score those two
identically. That pair is the suite's best case.

### New harness helper

**`attachToolFromDeck(state, seat, target, cardId)`** — the harness's first Tool
surgery (`target` is `"active"` or a bench index). The real action is turn-gated
and hand-scoped, so it cannot put a Tool on the OPPONENT's board, which is exactly
what a seat-asymmetry case needs. It deliberately does **not** enforce the §7.4
one-Tool cap, because the predicate must be testable above one.

### The loud-witness bookkeeping

`conditionalDamage.test.ts`'s "unmapped stays LOUD" witness was **re-pointed, not
deleted** → **Pikachu `swsh10.5-027`** ("you played a Supporter card from your hand
during this turn"). It has now been Venoshock (→D116), Ceruledge (→D117), Greedent
(→D122); this time it was deliberately pointed at a clause that **needs new
per-turn state**, so no one-row table extension can map it out from under the case.

## D123 — the SUPPORTER-PLAYED clause (engine 0.74.0)

Pikachu `swsh10.5-027` "Buddy Bolt" — "If you played a Supporter card from your
hand during this turn, this attack does 30 more damage." One printing, one card,
one clause, no reprint. The table goes **17 → 18 literal rows + 2 templates, 22
of 26 distinct clauses / 38 of 43 printings**.

### D122's "cheap era is over" was HALF right — and this is the correction

D122 said every remaining clause buys new state, an ingest change or a new
mechanism. That was true of the **BOARD**. This clause reads a **TURN EVENT**, and
the fact it needs already existed anyway: §7.2's one-Supporter-per-turn cap is
`state.allowances.supporterPlayed` (`types.ts` `TurnAllowances`), set by
`playTrainer` (`cardplay.ts`) when the played Trainer's `trainerType` is
`"Supporter"` and cleared by `freshAllowances()` on every `startTurn`
(`flow.ts`). **So the printed "during this turn" is not a new clock — it is
exactly the lifetime the allowances bag already has.** Zero new state: no field on
`TurnAllowances`, none on `PlayerSide`, no serializer change, no
`MATCH_RECORD_VERSION` bump, no `redact.ts` diff.

**The lesson to carry: before costing a per-turn clause as "new state", check the
RULE-ENFORCEMENT flags first.** The engine already tracks a per-turn fact for every
once-per-turn cap it enforces (`energyAttached`, `retreated`, `supporterPlayed`,
`stadiumPlayed`, `stadiumAbilityUsed`, `abilitiesUsed`). Any clause that asks "did
you do X this turn" where X is *capped* by the rules is already recorded — the cap
and the clause are the same bookkeeping seen from two sides.

### The one real call: THE SEAT GUARD

`GameState.allowances` is a **SINGLE bag** describing whoever owns the current
turn — it is deliberately not per-seat (the doc at `types.ts:156` explains why it
lives on `GameState` and not on the phase). `conditionHolds(state, seat, cond)` is
**seat-relative**, and it has consumers where `seat` is **not** the turn owner: a
`conditionGate` op running under a `koTrigger` / `damagedTrigger` stage evaluates
during the **OPPONENT's** turn (the `resumeTail` case on `effect:choose`). Read
unguarded, the bag would answer *"your OPPONENT played a Supporter"* as *"you
played a Supporter"*.

So the arm proves ownership before it reads the flag:

```ts
case "youPlayedSupporterThisTurn":
  return phaseViewOf(state, seat).activeSeat === seat && state.allowances.supporterPlayed;
```

The owner comes from **`phaseViewOf` (`phaseView.ts`), THE one exhaustive switch
over `Phase`** — never from turn parity, which that module's own header
(`phaseView.ts:13-16`) forbids for precisely the case that breaks it (a `ko:*`
park, where the turn owner and the deciding seat differ). `activeSeat` is
viewer-independent, so passing `seat` as the viewer arg is immaterial.

**Import note:** `phaseView.ts` imports from `interpreter.ts` **type-only**
(`import type { EffectPrompt }`), so the new value import interpreter→phaseView is
erased at runtime and leaves no cycle. Verified green; no lint complaint.

**Generalisable rule (the D123 half of D122's gate lesson): a state field scoped to
the TURN is a fact about the TURN OWNER, not about a seat. A seat-relative
predicate over it must first prove the seat owns the turn.** Any future clause
reading `allowances` owes the same guard.

### The vacuous-between-turns reading

During a **checkup-origin** `ko:*` park `phaseViewOf` reports `activeSeat: null`
(nobody owns a turn between turns), so this member reads **FALSE for both seats**.
That is the intended reading: no turn is in progress, so no turn holds a Supporter
play. An **attack-origin** `ko:*` park is different — `koParkActiveSeat` still
names the attacker, so the owner keeps reading TRUE there. The suite pins both,
which is what proves the guard reads *ownership* rather than blanket-refusing
every `ko:*` phase.

### D116's pronoun rule does NOT apply here — the family's first full round-trip

Every previous member had to translate a printed pronoun ("this Pokémon", "your
opponent's Active Pokémon"). This clause's printed subject is already **"you"**,
which is exactly what a seat-relative predicate means, so the table translates
nothing and `conditionNote` returns the printed sentence **byte for byte**. No
timing word to drop, no card-face glyph to spell out.

### Census facts (local D1, 2026-08-01)

Swept over the WHOLE effect string of every attack of all 978 cards (the D121
lesson), case-insensitive:

- `played a Supporter` → **1 hit**, `swsh10.5-027`. **HAPAX.**
- `Supporter card from your hand during this turn` → the same single hit.
- `you played` (attacks) → the same single hit. In **abilities**: exactly one
  other, Crobat `sv06.5-029` "Shadowy Envoy" — *"Once during your turn, if you
  played Janine's Secret Art from your hand this turn, you may draw cards until
  you have 8 cards in your hand."* It differs **twice**: it names a **SPECIFIC
  card**, and it drops the **"during"**. The whole-sentence anchor refuses it on
  either difference alone. **0 abilities mention "played a Supporter".**
- `during this turn` in attack effects → **3 distinct clauses**, all singletons:
  Buddy Bolt (this one), Lokix `sv02-021` (`evolved from Nymble`), and Malamar
  `sv06.5-034` "Colluding Tentacles" — *"…If you didn't play Xerosic's
  Machinations from your hand during this turn, this attack does nothing."*
  (negative polarity + named card + a "does nothing" consequent: a different
  skeleton entirely, not a row on this one). In trainer `effect` text: the three
  Geeta printings (`sv03-188`/`-218`/`-226`), a can't-attack lock, unrelated.

So the sentence is a **bare tag on a literal row** with no template warrant
(D121): one printing, and the varying half has no closed vocabulary anyway (D120).

### The Buddy Bolt string is PURE ASCII — the first in this family

96 characters, 96 UTF-8 bytes, **zero non-ASCII code points**: no `é` (it never
says "Pokémon"), no apostrophe of either kind. Every clause row before it carried
at least a precomposed `é`. The suite pins this deliberately, in contrast to
`toolClause.test.ts`'s é-pinning — the byte guards are per-sentence, not a house
constant.

### Card facts + fixtures

`swsh10.5-027` Pikachu: hp 60, `["Lightning"]`, Basic, retreat 1, weakness
`Fighting ×2` (the `×` is U+00D7 — non-ASCII, but in the weakness field, never in
the effect), no resistances, **no abilities**, regulation mark F. One attack:
`Buddy Bolt`, cost `{L}{C}{C}`, damage `"30+"`.

`SUPPORTER_CLAUSE_DECK` (`testFixtures.ts`) carries **both** `fix-lightning-energy`
and `fix-energy` — Buddy Bolt's `{L}{C}{C}` cost cannot be paid by plain Colourless
alone. Nemona `sv01-180` ("Draw 3 cards.", already authored in the registry) is the
Supporter the board cases actually **play through a real `playTrainer` action**,
which is what makes the arming assertion real rather than a hand-set flag.

The Weakness fold uses `fix-lightning-weak` (130 HP, ×2 Lightning) — the defender
is weak to the **attacker's** type, and 130 HP survives both 60 and 120 so no
KO/park interrupts the measurement.

### The loud-witness bookkeeping

`conditionalDamage.test.ts`'s "unmapped stays LOUD" witness was **re-pointed, not
deleted** → **Revavroom ex `sv06.5-015`** ("If this Pokémon moved from your Bench to
the Active Spot this turn, this attack does 120 more damage."). Occupant **#4**:
Venoshock (→D116), Ceruledge (→D117), Greedent (→D122), Pikachu (→D123).

**Why this occupant is safe when the last one was not:** Pikachu's clause *looked*
like it needed new per-turn state and did not — the flag already existed, so a
single table row mapped it out from under the case within one slice. The new
occupant needs state **nothing on the model carries in any form**: "moved from your
Bench to the Active Spot this turn" is **per-Pokémon and per-turn at once**, and no
field on `InPlayPokemon`, `TurnAllowances` or `PlayerSide` records *where a Pokémon
was earlier in the turn*. It also has **3 printings**, so it is the highest-value
clause left as well as the safest witness.

### Still unmapped after this slice (21 → 22 of 26 clauses mapped)

1. `this Pokémon moved from your Bench to the Active Spot this turn` — **3
   printings** (Revavroom ex `sv06.5-015`/`-081` +120, Golisopod `swsh10.5-026`
   +90). The best printings-per-clause left. Needs a promoted-this-turn fact that
   survives **both** a retreat and a KO-promotion.
2. `this Pokémon evolved from Nymble during this turn` — 1 (Lokix `sv02-021`
   +100). Two facts: evolved-this-turn (`turnPlayed` may already answer it) plus
   the NAME evolved from, readable off the stack (§1.2). Open vocabulary → literal
   row, never a template (D120).
3. `any of your {F} Pokémon were Knocked Out by damage from an attack during your
   opponent's last turn` — 1 (Lucario `sv01-114` +120). Cross-turn, type-filtered,
   and must distinguish a KO by attack damage from any other KO route. Last, or
   not at all.
4. `your opponent has any Future Pokémon in play` — 1 (Slither Wing `sv06.5-026`
   +120). **Blocked on a P1 INGEST change**, not engine work.

## D124 — the PROMOTED-THIS-TURN clause (engine 0.75.0)

Revavroom ex `sv06.5-015`/`-081` "Accelerator Flash" (20+, **+120**) and Golisopod
`swsh10.5-026` "First Impression" (20+, **+90**) SIMULATE:
*"If this Pokémon moved from your Bench to the Active Spot this turn, this attack
does N more damage."* — **3 printings / 2 cards / 1 clause on ZERO registry rows**,
the best printings-per-clause ratio in the whole family. The table goes **18 → 19
literal rows + 2 templates, 23 of 26 distinct clauses / 41 of 43 printings.**

### One row, not a template — D118's rule read from the other end
The pool prints this at **two** amounts (120 and 90), which looks like exactly the
variation D118 built templates for. It is not. The amount is captured by the
**OUTER** skeleton (`this attack does (\d+) more damage`), so the clause string
itself is **byte-identical** across all three printings. Nothing varies *inside*
the clause; there is nothing to parameterise. The suite pins this by deriving both
real printed sentences and asserting the **same `cond`** at **different `per`**.

### This is the family's FIRST slice that buys new state
D123 got its turn event free by reading a rule-enforcement flag
(`allowances.supporterPlayed`), and its lesson was "check the rule-enforcement
flags before costing a per-turn clause as new state". **That shortcut is now
spent** — no rule caps how often a Pokémon may move up, so there was no
bookkeeping to borrow. The fact is **per-Pokémon AND per-turn at once**, and
nothing on the model held it:

- `turnPlayed` records when the **CARD entered play**, not when the Pokémon
  changed zone (and `placeEvolution` re-stamps it, so it is actively wrong here).
- `markers: string[]` is **never read in production** — a write-only bag. Using it
  would have been a stringly-typed channel with no compile-time reader.
- `TurnAllowances` is per-**SEAT**, not per-Pokémon.

So `InPlayPokemon` gained `promotedTurn: number | null` (types.ts).

### The decision: a TURN STAMP, not a flag
`promotedTurn` holds the turn number the Pokémon last came up from the Bench;
the predicate is `active.promotedTurn === state.turn`. It pays three times:

1. **No turn-boundary clear.** The fact expires by arithmetic. `startTurn` has no
   loop over in-play Pokémon today, and a boolean would have forced one — plus a
   permanent invitation for a later slice to forget it.
2. **No seat guard**, the exact inverse of D123 — see below.
3. **§8.1 falls out free.** A KO promotion runs during the OPPONENT's turn and
   stamps THEIR turn number, which can never equal `state.turn` once the
   controller's own turn begins. Without this, every KO would hand the defender a
   free +120 on its next attack.

### THE GENERALISATION: D123's seat guard was owed to seat-AMBIGUOUS STATE, not to "this turn"
D123 concluded *"a state field scoped to the TURN is a fact about the TURN OWNER;
a seat-relative predicate over it must first prove the seat owns the turn."* That
is **too broad, and this slice is the counter-example.** The real reason
`youPlayedSupporterThisTurn` needs `phaseViewOf(state, seat).activeSeat === seat`
is that `state.allowances` is a **single bag** describing whoever owns the current
turn — the *state* is seat-ambiguous. The words "this turn" had nothing to do with
it.

`promotedTurn` is stamped **on the Pokémon**, and a Pokémon already knows whose it
is. `state.turn` is a global counter. So the predicate is **total**: true exactly
when *this* Pokémon moved during the turn now in progress, for any `seat`, from
any consumer, in any phase. The suite proves it on ONE board where the seat
answering TRUE is **not the turn owner** (P1 plays Boss's Orders and drags a P2
Revavroom up; `conditionHolds(state, "p2")` is true while P1 owns the turn), and a
mirror board so neither answer is a constant.

**Corrected rule: ask where the state LIVES, not what its lifetime is. A fact on a
shared/turn-owned structure owes an ownership proof; a fact stamped on an object
that already has an owner does not.**

### All three bench→Active routes stamp it, and all three COUNT
The printed verb is **"moved"**, not "retreated", so every route is a move:

| route | site | note |
|---|---|---|
| `retreat` | turn.ts | the deliberate half |
| `switchInto` | interpreter.ts | **three** provenances at once: Switch/Escape Rope (`switchOwn`), Boss's Orders (`gust`, on the OPPONENT's board), and Jet Energy's on-attach switch (turn.ts `attachEnergy`) |
| `resolvePromotion` | flow.ts | after a Knock Out — almost always the opponent's turn |

Setup placement (`setupPlaceActive`) is **not** a route: a card arriving from the
hand never came from the Bench, so `makeInPlay` stamps `null`.

**Jet Energy is what makes this a real card**, not a retreat-only trick — and it is
the reason the stamp lives in `switchInto` rather than at each of its three
callers.

### It SURVIVES evolution
`placeEvolution` spreads the whole Pokémon and clears only `conditions`,
`retreatBlocked` and `markers`. §10 sheds the effects of **ATTACKS**; having moved
is a fact about the turn, not an effect on the card. So retreating a Varoom in and
evolving it into Revavroom ex the **same turn** leaves the clause armed — which is
both the printed reading and the only line on which the card is actually good. The
suite drives this end to end with the real `sv06.5-043` Varoom.

### MATCH_RECORD_VERSION 1 → 2
A record written by the previous deploy has in-play Pokémon with **no
`promotedTurn` at all** — a **missing required field, not a widening**, which is
the one case that constant's own doc block says must bump. Note *why* it is not
optional to skip: it would read back **benignly** (`undefined === state.turn` is
false, i.e. "did not move this turn"), and a silently-defaulted rules-relevant
field is precisely the misreading the version exists to refuse. `redact.ts`
allow-lists what crosses the wire, so nothing else moved: no wire field, no
`@luminous/schema` diff, no web/API diff beyond the constant.

### Census facts (local D1, 2026-08-01, 978 cards, whole effect string)
- `Active Spot this turn` — exactly **5** cards (the 3 positive printings + 2
  Palafin). `moved from` — exactly **3** (the positive printings).
- **Zero U+2019 in the entire pool.** Only two non-ASCII characters exist
  anywhere: `é` U+00E9 (always in "Pokémon") and `×` U+00D7 (always in weakness
  values). The clause string is 101 code points / 102 UTF-8 bytes — one `é`.
- Data oddity, faithfully mirrored in the fixture: Revavroom ex's `types_json` is
  `["Lightning"]` while both attack costs are `Metal` (weakness Fighting, which is
  consistent with Lightning). The fixture matches the **ingest**, not intuition.

### Two near-misses, and neither is a table near-miss
- **Palafin `sv03-062`/`-200` "Justice Kick"**: *"If this Pokémon **didn't move
  from the Bench** to the Active Spot this turn, this attack **does nothing**."*
  A different **consequent**, so the OUTER anchor refuses it before the table is
  ever consulted; also a different verb form and no possessive on "the Bench".
  Same state underneath — a **`conditionGate`-shaped** slice, cheap now that
  `promotedTurn` exists, but not a row on this skeleton.
- **Weavile `sv02-134` "Assaulting Hunt"** reads the same transition as a
  present-tense **`when` TRIGGER** (*"when this Pokémon moves from your Bench to
  the Active Spot, you may…"*), not a per-turn query. A different mechanism.

### Fixtures + suite
New `FIXTURE_POOL` rows: `sv06.5-015` Revavroom ex, `swsh10.5-026` Golisopod,
`sv06.5-043` Varoom (the pre-evolution, for the evolution-survival case) and one
synthetic `fix-lightning-weak-big` (320 HP, ×2 Lightning) — sized so the §8.5
fold-order pair ((20+120)×2 = **280** vs 20×2 = 40) never KOs, because a KO would
park a *second* `promotedTurn` stamp into the middle of the arithmetic.
`sv06.5-081` is deliberately **not** a fixture (byte-identical to `-015`); it
appears only in comments and in the ZERO-registry-rows assertion. Wimpod
`swsh10.5-025` was already in the pool from D114.

`PROMOTED_CLAUSE_DECK` (60): 4 Revavroom ex / 3 Varoom / 3 Golisopod / 4 Boss's
Orders / 3 Switch / 5 {M} / 3 {W} / 5 {C} / 3 fix-lightning-weak-big / 27
fix-bigbody. **2 copies of Boss's Orders was not enough** — at seed 11 both landed
outside the dealt deck; 4 is the working count. Revavroom ex is a Stage 1 and can
never open, but both Actives are still pinned to `fix-bigbody` on the sibling
suites' precedent.

`promotedClause.test.ts` (**34 tests**) adds a block the siblings do not have —
**`promotedTurn` — the state itself** — because this is the first slice in the
family with state to test: null on every Pokémon that never came from the Bench,
each of the three routes driven through a **real action**, and the evolution
survival case.

### A harness fact worth knowing
**`promote` resolves the promotion AND rolls the turn over in the same
`applyAction`.** There is no reachable state where a freshly KO-promoted Pokémon
can be observed with the turn counter still the attacker's. The suite asserts the
arithmetic instead (stamp `=== 2` from the park state's own `turn`, `done.turn ===
3`, `conditionHolds(done, "p2")` false) and then drives P2's Revavroom attacking
on its own turn for the printed 20. The "still true between turns" reading is
covered separately by crafting `ko:takePrizes` / `ko:promote` phases onto a Boss's
Orders board and showing the answer does **not** move — the direct contrast with
`youPlayedSupporterThisTurn`, which flips to false for both seats there.

### The loud-witness bookkeeping
`conditionalDamage.test.ts`'s "unmapped stays LOUD" witness moved to occupant
**#5**, Lokix `sv02-021` — **now SHARED with `clauseTable.test.ts`**. That sharing
is a fact about the pool, not a slip: only **three** unmapped clauses remain in 978
cards against **four** suites that each need a witness (`energyClause` /
`energyInPlay` already share one). Lokix is a safe occupant for a reason no
predecessor had: it is **two** facts (evolved + *from Nymble*) and the name half is
open-vocabulary, so D120 forbids a template and D119 forbids calling it one varying
token.

### Still unmapped after this slice (22 → 23 of 26 clauses mapped)

1. `this Pokémon evolved from Nymble during this turn` — 1 (Lokix `sv02-021`
   +100). Two facts: evolved-this-turn plus the NAME evolved from, readable off
   the stack (§1.2). ⚠️ `turnPlayed` does **not** answer the first half cleanly —
   `placeEvolution` re-stamps it, so it says "evolved this turn" *and* "was played
   this turn" with no way to tell them apart on a Pokémon that was benched this
   turn and evolved later. Open vocabulary on the name → literal row, never a
   template (D120). **`promotedTurn` is NOT reusable here: evolving is not
   moving**, and the two facts have deliberately separate stamps.
2. `any of your {F} Pokémon were Knocked Out by damage from an attack during your
   opponent's last turn` — 1 (Lucario `sv01-114` +120). Cross-turn, type-filtered,
   and must distinguish a KO by attack damage from any other KO route. Last, or
   not at all.
3. `your opponent has any Future Pokémon in play` — 1 (Slither Wing `sv06.5-026`
   +120). **Blocked on a P1 INGEST change**, not engine work.

---

## D125 — the REQUIREMENT skeleton (engine 0.76.0)

Palafin `sv03-062`/`-200` "Justice Kick" (`{W}{W}`, **210**) and Lycanroc
`sv03-117` "Finishing Fang" (`{F}`, **90**) SIMULATE:
*"If \<clause\>, this attack does nothing."* — the clause family's **SECOND
CONSEQUENT**, **3 printings / 2 cards / 2 clauses on ZERO registry rows**, and
**ZERO new `BoardCondition` members**. The damage-bonus table is untouched at 19
literal rows + 2 templates (23 of 26 clauses / 41 of 43 printings).

### The sweep is what set the slice's size
D124's resume point named Palafin as the cheapest thing left and asked for a sweep
first. It paid: `does nothing` occurs in **19 printings across 6 distinct clauses**,
so the unit of work was the **consequent**, not the card. Two of the six are
`BoardCondition`-shaped and both are now mapped. The census, so nobody re-runs it:

| clause | prints | why it is (not) mapped |
|---|---|---|
| `this Pokémon didn't move from the Bench to the Active Spot this turn` | 2 | ✅ → `yourActivePromotedThisTurn` (D124's state) |
| `your opponent's Active Pokémon has no damage counters on it before this attack does damage` | 1 | ✅ → `opponentActiveDamaged` (D115's member) |
| `Flip a coin. If tails, …` | 12 | coin-flip mechanism; the flip sentence in front denies it `^If` |
| `If you can't, …` | 3 | ANAPHORIC — "can't" points back at a cost sentence the reader cannot see |
| `If you didn't play Xerosic's Machinations from your hand during this turn, …` | 1 | Malamar `sv06.5-034` — a SPECIFIC named card, and multi-sentence |

### A NEW CONSEQUENT IS A NEW SKELETON, NOT A NEW VOCABULARY
The whole family cost a regex, a two-row `Map` and a gate, because both clauses
were facts the union already carried. **Before costing a new sentence family, check
whether the *condition* half is already spelled.** The expensive half is usually the
consequent, and the two are independent — which is exactly the axis the first ten
slices of this family never had to think about, having only ever had one consequent.

### THE PLACEMENT RULE: a derived shape is classified by WHERE IN RESOLUTION IT LANDS
D124's resume point forecast this as *"a `conditionGate`-shaped slice"*. **It cannot
be one.** An effect PROGRAM runs at `attack.ts`'s tail, strictly **after** the §8.5
damage pipeline, and no `EffectOp` can retract damage already dealt. A cancel must
be evaluated **in front of** the pipeline, so it is not a program at all — however
naturally the sentence maps onto `conditionGate`.

The gate the engine already had for exactly *"no damage, no effects, and the turn
still ends"* is the **§8 step-3 CONFUSION path**. D125 is that path minus the
self-damage: push `ATTACK_FAILED` and `return finishAttack(...)`, which keeps the
§8.1 both-board sweep and the turn end — **a cancelled attack is an attack that was
USED**. Reuse this ending for any future cancel rather than inventing a second one.

**Ask "before or after damage?" before costing any future shape.** It is the
difference between a table row and a new seam. The remaining pre-damage candidates
are the whole coin-flip family and the 3 anaphoric "If you can't" prints.

### THE POLARITY DECISION: it belongs to the SKELETON, not to the vocabulary
`BoardCondition` gained **no** `{ kind: "not", cond }` member, and should not on
present evidence. **All six distinct "does nothing" clauses in the pool are NEGATIVE
sentences**, and that is the *grammar of the mechanic* rather than an accident: a
card prints "does nothing" precisely to state a **requirement**, and English states
a requirement by naming its failure. So `deriveAttackRequirement` reads the printed
NEGATIVE and returns the **POSITIVE** fact required; `attack.ts` cancels on its
ABSENCE.

A `not` member would make the vocabulary **recursive** — five consumers
(`conditionHolds`, `conditionNote`, `redact.ts`, `cardplay.ts`'s playability
descent, `registry.ts`) each owing a recursion arm, and `conditionNote` owing a
readable negated phrasing English does not supply — to buy a spelling nothing in
978 cards asks for. If a POSITIVE clause ever appears under this consequent, **that
is the warrant** (D121's rule), and the cheap answer even then is a second table of
positive-sense rows, still without touching the union.

### Two consequents get two TABLES, sharing the vocabulary but never a lookup
`ATTACK_REQUIREMENT_CLAUSES` is deliberately unreachable from
`boardConditionForClause`. A clause meaning *"80 more damage if X"* must not be
resolvable from a sentence meaning *"nothing if X"* — a shared Map would make a
mis-anchored sentence produce a plausible wrong answer instead of staying LOUD,
which is the one outcome this family refuses.

### A printed TIMING qualifier can be discharged by the SITE
Lycanroc's trailing *"…before this attack does damage"* needed **no modelling at
all**. `opponentActiveDamaged`'s own doc block already commits it to a
declaration-time read (that is what "already" means for the D115 bonus family), and
the requirement gate sits in front of §8.5 — so the qualifier is true *by where the
check runs*. An undamaged defender cannot bootstrap the clause with the very hit
the clause gates, and the suite pins that non-bootstrap explicitly. **Check what the
evaluation site already guarantees before adding a phase parameter to a predicate.**

### The event: a widening, not a bump
`ATTACK_FAILED.reason` went `"confusion"` → `"confusion" | "requirement"`. Per
D124's own distinction, **a widened enum is not a `MATCH_RECORD_VERSION` bump** (the
bump is for a MISSING REQUIRED FIELD on a record written by an older deploy).
`log.ts` must branch on the reason, or a cancel renders as a confusion that never
happened.

### The suite
`attackRequirement.test.ts` (**34**) on a new `ATTACK_REQUIREMENT_DECK`, with four
faithful fixtures — Palafin + Finizen, Lycanroc + Rockruff. The byte-identical
`sv03-200` reprint is **deliberately not fixtured** (one card, one row). Real routes
throughout: retreat, Switch, Boss's Orders, a real evolve, a real KO+promote chain
proving §8.1 still cancels on the following turn, and — the case worth copying —
**Lycanroc's own "Slashing Claw" supplies the damage its "Finishing Fang" reads two
turns later**, so the arming board is one the game itself produced. The
zero-new-vocabulary claim is pinned *directly*: `deriveAttackDamageBonus`'s `cond`
on the real POSITIVE sentences deep-equals `deriveAttackRequirement`'s on the
negatives.

`promotedClause.test.ts`'s Justice-Kick near-miss case was **kept and BOUND**, not
deleted: its three refusals (`deriveAttackDamageBonus` / `deriveAttackDamageMultiplier`
/ `deriveAttackEffect`) still hold and are still the proof the OUTER anchor does the
work, and two assertions were added that a **fourth** reader now claims the sentence.
That is the pattern for any future slice that maps a documented near-miss: bind the
two suites, do not orphan one.

### Still unmapped after this slice
Unchanged — the three damage-bonus clauses (Lokix `sv02-021`, Lucario `sv01-114`,
Slither Wing `sv06.5-026`) and their loud witnesses are untouched. On this
consequent, the four families in the census table above.

**The coin-flip family is now a better-shaped slice than it was.** D125 built the
pre-damage cancel seam its 12 "If tails" prints need (the gate site,
`ATTACK_FAILED.reason`, the `effectSimulated` term). What is missing is only the
announced flip — an event, and `rngState` consumed in front of §8.5, precisely
where §8 step 3's confusion flip already sits. Take its "If heads, this attack does
N more damage" half (16 prints across 8 amounts) in the **same** slice; they are one
mechanism and splitting them builds the fold twice.

---

## P3-M5 — the PRINTED COIN FLIP (D126, engine 0.77.0)

*"Flip a coin. If heads, this attack does N more damage."* (**20 printings**, 7
distinct N) and *"Flip a coin. If tails, this attack does nothing."* (**11
printings**) now SIMULATE. **31 printings — the largest single mapping in P3-M5 —
on TWO REGEXES and ZERO vocabulary.** No table row, no `BoardCondition` member, no
`DamageCountSource` member, no state field, no registry row, no web/API/DB diff.

### The census corrected the plan's numbers
The resume point carried "16 `If heads` printings across 8 amounts" and "12 `If
tails`". The re-census against the local D1 says **20 / 7** and **11 / 1** for the
*pure* forms; the difference is entirely the EXTENDED prints, which the `$` anchor
refuses and which the plan had silently folded into the counts. **Re-census before
sizing a slice, even when a previous session already did** — the earlier number was
taken from a `%…%` LIKE, not from the anchored shape actually being built.

### One mechanism, two consequents, ONE slice
Heads-bonus and tails-cancel are a **single pre-damage flip read from two ends**.
Built separately, the flip, its event and its placement would have been designed
twice and the second design would have had to justify not being the first. The
deriver returns a **2-member union** (`AttackCoinFlip`), which makes "at most one
flip per attack" a **type property** rather than a rule `attack.ts` must keep.

### The clause is a FIXED LITERAL — that is why it is cheap
Every predecessor of the "does N more damage" shape bought a printed-clause table
row and usually a `BoardCondition` member. Here the clause is the word *heads*, and
**a coin face is not a board fact at all** — no state answers it. So there is no
table and no vocabulary: two anchored regexes and a union is the whole cost.
`scaledAttackDamage` stays **pure and state-only** on purpose; the face is drawn
from `rngState` at resolution and has no business in `DamageCountSource`. **The
generalisation: when the condition is not read off the board, do not try to spell
it in the board vocabulary.**

### Where it lands (D125's rule, applied not re-derived)
The flip block sits in `attack.ts` **after** the D125 requirement gate and **before**
the §8.5 pipeline — the same site as §8 step 3's confusion flip, one gate later. It
could not be an `EffectOp`: a program runs at the function's tail, so a
`coinFlipGate` could neither add to a number already computed nor retract damage
already dealt. Heads folds `coinBonus` into a new `scaledTotal = scaled + coinBonus`
used at all three `scaled` sites (the `> 0` guard, the pre-W/R sum, the
`DAMAGE_DEALT.scaled` field) — so the bonus is **pre-Weakness**: Litwick on heads
into a Fire-weak body is `(10 + 10) × 2 = 40`, not `10 × 2 + 10`.

**Why after the D125 gate:** an attack already cancelled must not burn an `rngState`
step. Honestly — no printing carries both (the sentences are whole-string anchored),
so nothing in the suite pins that order. It is the order the rules read in.

### The event was REUSED, not joined by a sibling
`ATTACK_EFFECT_COIN_FLIP` names a **fact** — "a coin was flipped resolving this" —
and that fact is identical here and inside a `coinFlipGate`. Its log copy was already
neutralised ("flipped \<face\> for the effect") back when Trainers started sharing
it, so it reads correctly unchanged. A second type would owe a new log arm and a new
wire member to carry information the existing one already carries. `CONFUSION_CHECK`
stays separate for the opposite reason: it is a §12 **status** check, not part of the
attack's printed text.

`ATTACK_FAILED.reason` widened again, `"confusion" | "requirement" | "coinFlip"` — a
**widening, so no `MATCH_RECORD_VERSION` bump** (D124's distinction). `log.ts` gained
a third arm that states the **consequence** only; the preceding flip row already named
the face.

### ⚠️ The `modifierSimulated` trap — real, and silent
The 20 heads printings carry a printed `"10+"`-style damage marker, and the coin
reader is exactly what consumes that `+`. `effectSimulated` gaining a term is the
obvious half; **`modifierSimulated` gaining `coinFlip?.kind === "bonusOnHeads"` is
the half that is easy to miss**, and omitting it produces perfectly correct damage on
all 20 *plus* a loud `ATTACK_EFFECT_SKIPPED` row on every one. Only a
"no-skipped-row on either face" assertion catches it. The cancel printings carry a
FLAT number, which is why the term is narrowed to the one union member.

### ⚠️ The double-read risk, and what prevents it
`deriveAttackEffect` **already** reads *"Flip a coin. If heads, your opponent's
Active Pokémon is now Paralyzed."* (16 printings) into a `coinFlipGate` program. If
`deriveAttackCoinFlip` also claimed it, the attack would flip **twice**. The
consequent anchor is what prevents it, and the suite asserts both directions
empirically rather than by reading the regex.

### The long tail that stays LOUD, and which anchor refuses it
- `$` refuses the **extended** prints: Floette `sv01-092` (`…30 more damage, and heal
  30…`), Conkeldurr V `swsh10.5-040`/`-073`/`-074` (`…90 more damage, and … Confused.`),
  Dragonite ex `sv03-159` (`…140 more damage. If tails, …can't attack.`), Squawkabilly
  `sv01-162` (`…does nothing. If heads, …prevent all damage…`).
- `^Flip a coin\.` refuses a different **number of flips**: `Flip a coin until you get
  tails.` (9 prints, incl. Bouffalant `sv03-174`'s `more` variant), `Flip 2 coins.`
  (18), `Flip 3 coins.` (10, incl. Bisharp `sv03-149`'s three-quantifier sentence),
  `Flip 4 coins.` (1), and `Flip a coin for each …` (3).
- The consequent refuses every other single-flip family (Paralyzed ×16, damage-prevent
  ×11+2, discard-Energy ×4, and 12 singletons).
- `Flip a coin` is **lowercase mid-sentence exactly once** in 978 cards — Eelektross
  `sv03-069`, which is also the only anaphoric `If you do` in the coin corpus.

### Pool facts worth not re-deriving
- The two mapped sentences are the family's first printed text that is **pure ASCII**
  — no `é` at all — so the usual `bytes = codePoints + count("Pokémon")` invariant
  degenerates to `bytes === codePoints`. The suite pins that explicitly rather than
  inferring it from equal totals.
- `×` (U+00D7) lives in the **`damage`** field, never in the effect string; `{R}`-style
  energy tokens appear in exactly ONE coin effect (Torkoal `sv01-035`) while `cost` uses
  spelled-out words. Zero U+2019, zero NBSP, zero double spaces anywhere in the corpus.
- **Zero consumers of `ATTACK_FAILED` outside `packages/engine/src`** — grepped `apps/`
  and `packages/`. The widening is engine-local.
- There is **no catalog-wide census test** in the repo. `coverage.test.ts` is the M5
  "5 existing-op cards" suite, `clauseTable.test.ts` has no table-size assertion, and
  `FIXTURE_POOL` is synthetic — so mapping 31 real printings moved **no** numeric
  expectation, and the three loud witnesses were never touched.

### The suite
`coinFlipDamage.test.ts` (**27**) on a new `COIN_FLIP_DECK` with two faithful Basics:
Tarountula `sv01-018` "Surprise Attack" (`{G}`, 30, cancel) and Litwick `sv03-036`
"Firebreathing" (`{R}`, 10+, +10). Both faces are reached by the established **seed
sweep** (`for (let seed = 0; seed < 24 && !(sawHeads && sawTails); seed++)`). It pins
the full **rngState account** — exactly one `flipCoin` step per attack, verified by
recomputing `flipCoin(before.rngState)` — which is the only thing that would catch a
double flip, and asserts the three `ATTACK_FAILED` reasons produce three distinct log
rows.

### Still unmapped after this slice
The three damage-bonus clauses (Lokix `sv02-021`, Lucario `sv01-114`, Slither Wing
`sv06.5-026`) and their loud witnesses are untouched. On the coin consequent, the
next-largest shapes are now **`Flip N coins. This attack does N damage for each
heads.`** (~24 printings, a multi-flip count fold) and **`Flip a coin until you get
tails.`** (9 printings, an unbounded fold). Both are the same seam D126 built, with a
LOOP instead of a single draw — and both would want the flip results announced as a
sequence, which is the one design question they raise that D126 did not have to answer.

---

## P3-M5 — the MULTI-FLIP COUNT FOLD (D127, engine 0.78.0)

*"Flip N coins. This attack does D damage for each heads."* (**22 printings**:
N=2 ×12, N=3 ×9, N=4 ×1; D ∈ {10, 20, 30, 40, 50, 60, 70, 80, 100}) now SIMULATES,
on **ONE anchored regex, ONE union member and still ZERO vocabulary.** No new event,
no new op, no `BoardCondition`/`DamageCountSource` member, no clause-table row, no
state field, no registry row, no log arm, no `MATCH_RECORD_VERSION` bump, no
web/API/DB diff.

### The census matched the plan for once — but only because the plan had been re-censused
The previous resume point's numbers (22 printings, N ∈ {2,3,4}, the two "more"
near-misses) came from a sweep run against the shape actually being built. Re-running
it confirmed all of them exactly. **That is D126's rule paying off, not an argument
against it** — the number that had to be corrected last time came from a `%…%` LIKE.

### The whole diff is a `for` loop
Same reader (`deriveAttackCoinFlip`), same union, same site in `attack.ts` (after the
D125 requirement gate, in front of §8.5), same `coinBonus` → `scaledTotal` fold, same
event, same log copy. What changed: a third union member, a bounded loop where D126
took a single draw, one term in `scaledBase`, one in `modifierSimulated`.

**THE GENERALISATION: once a shape's SITE is right, varying its CARDINALITY is
cheap.** The expensive questions in this family were *where in resolution does this
land* (D125) and *what answers this clause* (D126). "How many times" is not in their
league. Price a cardinality-only slice as cheap even when its printing count is large.

### N flips are announced as N rows — the question D126 did not have to answer
`ATTACK_EFFECT_COIN_FLIP` carries exactly ONE `CoinFace`. One event per flip, in flip
order, is the only reading that does not invent an aggregate the event, the wire and
the log cannot express. The alternative — a single row carrying a heads COUNT — would
owe a new event type, a new wire member and a new log arm to say what a reader can
already count off the rows, **and it would discard the ORDER**, which is exactly what
a player watching a three-flip attack wants to see.

### It is the MULTIPLY family, and the printed MARKER is what says so
All 22 carry a `"D×"` marker whose digits ARE the per-heads D, so `scaledBase` drops
the printed base the same way it does for `deriveAttackDamageMultiplier`: Tandemaus
on two heads is **60, not 30 + 60**. `perHeads` is the third claimant on that rule
and the coin family's first.

The word that separates the two families is *more*, and the pool holds **two live
"more" near-misses** the whole-sentence anchor must refuse — a substring matcher
scores both wrong:
- Melmetal `swsh10.5-046` — `Flip 2 coins. This attack does 90 more damage for each heads.` (base `30+`)
- Bouffalant `sv03-174` — `Flip a coin until you get tails. This attack does 30 more damage for each heads.` (base `50+`)

### Why `bonusOnHeads` is NOT `perHeads` with `flips: 1`
The arithmetic coincides — `heads × per` is right for both, and `attack.ts` computes
them with ONE expression, so the branch in the flip block is over **cancellation**,
not over the members. `bonusOnHeads` really is the one-flip case of the same fold.
What is NOT shared is the printed marker: `"+"` keeps the base, `"×"` drops it. One
boolean flag would hide the only real difference behind a name that does not mention
it, so they stay two members and the difference stays where the marker is read
(`scaledBase`).

### And still not a `DamageCountSource` — D126's rule applied, not re-derived
The count comes from the flips, not from the board. No state answers it,
`scaledAttackDamage` stays pure and state-only, and the value belongs in the coin
union with its siblings, at the coin site, for the same reason they do.

### ⚠️ The `modifierSimulated` trap recurred exactly where D126 said it would
`"D×"` is a marker the reader consumes, so the term needed widening — and widening it
**inverted** the expression. Two of three members now own a modifier, so the honest
statement names the one that does not:

```ts
scaling !== null || programDamage || (coinFlip !== null && coinFlip.kind !== "cancelOnTails")
```

Naming the EXCEPTION rather than the cases is what keeps a future member from
silently defaulting to "unsimulated" — which is the failure mode that produces
perfectly correct damage plus a loud `ATTACK_EFFECT_SKIPPED` row on every printing.

### The two guards, and why neither is arbitrary
- **`flips >= 2`** because the sentence's *coins* is PLURAL. The one-flip form is
  printed *"Flip a coin."* and belongs to D126's two patterns, so `"Flip 1 coins."`
  is neither English nor in the pool. Refusing it (rather than quietly reading it as
  one flip) keeps the grammar of the sentence and the shape of the value in agreement.
- **`flips <= MAX_PRINTED_FLIPS = 10`** is a REFUSAL CEILING, not a rule. The pool's
  maximum is 4 (Unfezant `swsh10.5-063`), but the digits are read out of INGESTED
  THIRD-PARTY TEXT, where an unbounded `\d+` would let one malformed row spin the
  resolution loop for an arbitrarily long time. **A refusal is LOUD; a hang is not.**
  Any future deriver that loops on a printed number owes the same ceiling.

### ZERO HEADS is a RESOLVED attack that dealt nothing, not a cancelled one
No `DAMAGE_DEALT` at all (the `scaledBase + scaledTotal > 0` guard fires before
Weakness is ever consulted, so the multiplier is unobservable on that outcome), no
`ATTACK_FAILED`, and the turn still ends. That is the sharpest behavioural difference
from `cancelOnTails` and it has its own case in the suite.

### Pool facts worth not re-deriving
- Both mapped sentences are **pure ASCII**, 56 chars each — the same degenerate
  `bytes === codePoints` invariant D126's pair had, pinned explicitly.
- `×` (U+00D7) is in the **`damage`** field, never in the effect string — unchanged
  from D126.
- The two multi-flip fixtures are both **Colorless**, and the pool holds no multi-flip
  attacker of a type any existing weak fixture fields. Hence the one new synthetic
  body, `fix-colorless-weak-big` (200 HP, ×2 COLORLESS) — synthetic in a way no
  printed card is, and documented as such at the fixture.

### The suite
`multiCoinFlip.test.ts` (**30**) on a new `MULTI_COIN_FLIP_DECK` (Tandemaus `sv01-160`,
Meowth `sv06.5-048`, `fix-energy`, `fix-colorless-weak-big`, `fix-bigbody`). It sweeps
seeds to reach **all three** Tandemaus outcomes and **all four** Meowth ones —
measured: complete by seed 5 and seed 10 respectively, so D126's inherited `SEEDS =
24` is comfortably past both — and **asserts the observed outcome SET exactly**, so a
regression that stops reaching an outcome fails rather than silently under-testing.

Two cards and two different N is not redundancy: a suite on Tandemaus alone cannot
tell a `flips` READ from the sentence from a hardcoded 2, and the rngState account is
only an assertion when two values run through the same loop. 20 ≠ 30 for the same
reason — the two cards' total sets share only 0 and 60, and 60 needs a different heads
count on each, so no assertion can be passing for the other card's arithmetic.

It pins the **rngState account both ways** — the hand-folded state equals
`after.rngState` AND the folded FACES equal the emitted rows IN ORDER, plus explicit
`flips ± 1` non-equality. Either half alone is weak: a loop that flipped N times but
reported the first face N times passes the first. It also pins the four-reader
disjointness **empirically in both directions**, no `ATTACK_EFFECT_SKIPPED` on any
swept seed, and the pre-Weakness fold `(0 + 60) × 2 = 120` with **180** (leaked base)
and **60** (post-W/R fold) named as the wrong answers.

### Still unmapped after this slice
On the coin consequent, two shapes remain and they are refused at the LEADING
sentence, not at the consequent:
- **`Flip a coin until you get tails.`** — 9 printings, an UNBOUNDED fold. Genuinely
  different risk from this slice: the loop has no printed bound, so it must be written
  so a pathological seed cannot hang. Two sub-shapes: the multiply form (`…tails. This
  attack does D damage for each heads.` — Growlithe `sv01-030`, Rellor `sv02-026`,
  Forretress `sv01-139`, Chansey `sv01-144`) and a repeated EFFECT (`…tails. For each
  heads, <effect>.` — Masquerain `sv03-007`, Krookodile `sv01-117`, Gyarados
  `swsh10.5-022`), which is a program, not a fold. Plus Bouffalant `sv03-174`'s `more`
  variant.
- **`Flip a coin for each {R} Energy attached to this Pokémon.`** — 3 printings
  (Torkoal `sv01-035`, Ambipom `swsh10.5-057`, Bellossom `sv03-003`). A **BOARD-COUNTED
  number of flips**, and therefore the first shape in this family where the board
  vocabulary would finally earn its place: the `flips` count is a `DamageCountSource`-
  shaped question even though the DAMAGE count is not.
  → **Mapped by D128** (below). It turned out NOT to want a `DamageCountSource`
  member at all — see that section for why the widening landed on `flips` instead.

The three unmapped board-fact damage clauses (Lokix `sv02-021`, Lucario `sv01-114`,
Slither Wing `sv06.5-026`) and their four loud witnesses are untouched by this slice.

---

## P3-M5 — the BOARD-COUNTED FLIP COUNT (D128, engine 0.79.0)

*"Flip a coin for each [{X}] Energy attached to this Pokémon. This attack does D
damage for each heads."* (**3 printings**) now SIMULATES, on **ONE anchored regex
and ONE widened field.** No new event, no new op, no `BoardCondition` or
`DamageCountSource` member, no clause-table row, no state field, no registry row,
no log arm, no `MATCH_RECORD_VERSION` bump, no web/API/DB diff.

Fixtures: **Torkoal `sv01-035`** "Concentrated Fire" ({R}{C}{C}, `80×`) — the TYPED
`{R}` reading and the pool's ONLY coin effect carrying a brace token — and
**Bellossom `sv03-003`** "Powerful Dance" ({G}, `90×`) for the UNTYPED one.
**Ambipom `swsh10.5-057`** "Full Tilt Fling" ({C}, `60×`) is the untyped reading's
second printing and is covered at the deriver level only (its Ability
"Primate Dexterity" is irrelevant to an attacker and buys the suite nothing).

### The flip count is a board fact; the DAMAGE count still is not

This is the shape D126 and D127 both named as the one where the board vocabulary
would finally earn its place, and the interesting result is **how narrowly it does.**
`scaledAttackDamage` is untouched and gains **no `DamageCountSource` member**: the
damage still comes from the faces, exactly as D126 ruled. What the board answers is
**how many times to flip**, which is the one number a coin cannot answer.

So the value that moved is the flip COUNT, and it moved inside the member that
already owned it:

```ts
export type AttackFlipCount =
  | { kind: "printed"; count: number }
  | { kind: "attachedEnergy"; energy: BasicEnergyType | "special" | null };
// AttackCoinFlip's perHeads: flips: number  →  flips: AttackFlipCount
```

**Not a fourth `AttackCoinFlip` member.** `perHeads` still means "fold `per` × heads,
drop the printed `D×` base, emit one row per flip"; the consequent did not change at
all. A fourth member would have duplicated D127's whole fold to vary its bound.

### ⚠️ A bound is owed to the SOURCE of the number, not to the loop it feeds

D127's `MAX_PRINTED_FLIPS = 10` guards the `printed` member **alone**, and
deliberately does not travel to `attachedEnergy`. The two numbers have different
provenance:

| member | where the number comes from | what bounds it |
|---|---|---|
| `printed` | third-party INGESTED TEXT (`\d+`) | nothing but the constant |
| `attachedEnergy` | the engine's own state | the deck that produced the board |

A ceiling on the board read would refuse a **legal board** rather than a malformed
row — the opposite of what a refusal ceiling is for. The still-unbuilt
`Flip a coin until you get tails.` family is the third case and the reason to state
this as a rule: it has no bound from the text **and** none from the board, so it
needs a *termination argument*, not a ceiling. Do not reach for `MAX_PRINTED_FLIPS`
there; it answers a different question.

### ⚠️ The count is read at the FLIP SITE, not at declaration

`flipCount(state, seat, attacker, count)` is private to `attack.ts` and lives inside
the flip block, not up beside `scaled`. The count and the flips it bounds are **one
act**; splitting them would let a future gate between the two silently invalidate the
number. Nothing between declaration and the flip can change an attachment today —
but that is a fact about the current gates, not a property worth depending on. It
reads the attacker off `state` with the declaration-time Active as the unreachable
branch's answer, the same idiom `scaledAttackDamage`'s `opponentActiveRetreatCost`
arm uses.

### ⚠️ `energy: null` is a DIFFERENT TALLY, not a filter that matches everything

The design call the slice turns on, and the one place a plausible shortcut is wrong:

- A **FILTERED** count reads by **PROVISION** (`providesEnergyType`, the D118 rule):
  an Energy that can pay a `{R}` cost is exactly an Energy a `{R}` sentence counts,
  so a wildcard Luminous is a `{R}` Energy for as long as it provides every type, and
  stops being one the moment a second Special demotes it to {C}.
- An **UNFILTERED** count reads by **CARD**: "each Energy attached" counts attached
  Energy CARDS. A Special demoted to providing only {C} is still one. A wildcard
  providing eleven types is still exactly one.

Collapsing `null` into "the type filter that matches everything" quietly makes the
second question the first, and gets Ambipom wrong on any board holding a demoted
Special. `continuous.ts` gained `countAttachedEnergy(state, pokemon, energy | null)`
beside `hasAttachedEnergy`, so the two readings of the same printed noun cannot
drift; `hasAttachedEnergy` keeps its short-circuiting `.some` rather than being
reimplemented on the counter.

### Both notations, through D118's map

The token resolves through the existing `CLAUSE_ENERGY_TOKENS` — brace codes AND
spelled-out names — not a local `{R}` lookup. All three printings of this sentence
happen to need neither (Torkoal brace-codes, the other two carry no filter), but
reusing the map costs nothing and admits a swsh-era "for each Water Energy" reprint
by construction instead of silently skipping a whole set.

An **unresolvable** token is told apart from the UNFILTERED sentence **by the token's
presence, not by the lookup's null** — `if (token !== undefined)` — so `{C}`, `{N}`,
`Dragon` and junk all fall through to the loud `ATTACK_EFFECT_SKIPPED` path instead
of quietly counting every attached card. `{C}` is refused for `ENERGY_TYPE_BY_CODE`'s
own reason: Colorless is the conservative provision fallback for every unauthored
Special Energy, so a `{C}` filter would match cards nobody meant.

### ⚠️ A ZERO count means ZERO FLIPS, which is not zero HEADS

| | flip rows | rngState steps | DAMAGE_DEALT | ATTACK_FAILED | turn ends |
|---|---|---|---|---|---|
| D127 zero HEADS | N | N | no | no | yes |
| D128 zero COUNT | **0** | **0** | no | no | yes |

Same ending, different account. **No printing can reach the zero branch**: all three
have a cost floor of at least one Energy, and Torkoal's `{R}` cost IS the `{R}` its
filter counts. So it is defensive, and a **constructed** fixture pins it —
`fix-flip-filter`, a `{C}` cost against a `{W}` filter, holding one Fire.

### The case an unfiltered implementation passes everything else on

Torkoal holding **1 Fire + 2 Water** MEETS its `{R}{C}{C}` cost (Fire pays `{R}`, the
Waters pay `{C}{C}`) while its `{R}` count is **1**. Exactly one flip; damage ∈
{0, 80}; **never the 240** a card-count reading gives. Every other case in the suite
is satisfied by an implementation that ignores the filter — this one is not, and it
is the case to keep first if the suite is ever trimmed.

### The suite

`perEnergyFlip.test.ts` (**37**) on a new `PER_ENERGY_FLIP_DECK`. A Stage 2 **is**
fieldable by `setActiveFromDeck`, so the untyped case runs on the real Bellossom. It
sweeps seeds and asserts the observed outcome SET exactly, recomputes every board's
whole flip sequence by hand, pins byte-identical `rngState` on the zero board,
asserts no `ATTACK_EFFECT_SKIPPED` on any outcome including zero, `(0+80)×2 = 160`
pre-Weakness, and a `countAttachedEnergy` block where the three readings **disagree**.
Mutation-checked: ignoring the filter fails 9 tests, leaking the printed base 8,
hard-coding one flip 7. D127's witness case ("refuses a BOARD-COUNTED number of
flips") was **re-pointed, not deleted** — it now pins the disjointness of the two
`AttackFlipCount` arms.

`bun run check` GREEN exit 0: **170 → 171 files, 2634 → 2671 tests**, zero formatter
churn. ⚠️ The repo's real pre-existing `biome format` flagged count is **89**, not
the 57 D113 recorded — it has grown with the repo, so re-measure rather than quoting.

### Still unmapped in the coin family after D128

One shape, refused at the leading sentence: **`Flip a coin until you get tails.`** —
an UNBOUNDED fold with no bound from the text *or* the board (see the provenance table
above). D129 took its damaging half; see below.

The three unmapped board-fact damage clauses (Lokix `sv02-021`, Lucario `sv01-114`,
Slither Wing `sv06.5-026`) and their four loud witnesses are untouched by that slice.

## P3-M5 — the UNBOUNDED FOLD (D129, engine 0.80.0)

`Flip a coin until you get tails. This attack does D [more] damage for each heads.` —
**5 damaging printings on TWO regexes**, and with it the coin family's damaging shapes
are complete at **61 printings across five shapes, zero clause-table rows and zero
`BoardCondition` members**.

### The census (local D1, 2026-08-01)

809 cards carry attacks; **136 printings / 63 distinct clauses** open with "Flip".
**8** say "until you get tails":

| id | card | attack | printed damage | reading |
|---|---|---|---|---|
| `sv01-030` | Growlithe | Relentless Flames | `30×` | `perHeads` / `untilTails` |
| `sv02-026` | Rellor | Ball Roll | `30×` | `perHeads` / `untilTails` |
| `sv01-139` | Forretress | Continuous Spin | `50×` | `perHeads` / `untilTails` |
| `sv01-144` | Chansey | Egg Rolling | `60×` | `perHeads` / `untilTails` |
| `sv03-174` | Bouffalant | Damage Rush | `50+` | **`bonusOnHeads`** / `untilTails` |
| `sv01-117` | Krookodile | Chomp Chomp Bite | 50 | ✗ repeated `EffectOp` |
| `swsh10.5-022` | Gyarados | Wreak Havoc | — | ✗ repeated `EffectOp` |
| `sv03-007` | Masquerain | Panic-Prompting Pattern | — | ✗ repeated `EffectOp` |

⚠️ The pre-D129 planning note said **9**; the D1 says 8. Re-census, do not quote.

### The flip count is neither the text nor the board — it is the FACES

`AttackFlipCount` now has three members, and the third is the first that is **not a
number at any point**:

| member | count known at | bounded by |
|---|---|---|
| `printed` (D127) | derivation | `MAX_PRINTED_FLIPS`, an ingested-text refusal |
| `attachedEnergy` (D128) | the flip site | the deck that built the board |
| `untilTails` (D129) | **only once the coin is drawn** | the RNG — see below |

So D128's `flipCount` (a reader returning a COUNT for a `for` loop) could not express
it without flipping to find out how many times to flip. It became **`takeFlips`,
returning the SEQUENCE OF FACES** for all three members. The flip site has **no
per-member branch at all** — it announces one `ATTACK_EFFECT_COIN_FLIP` row per face
and tallies the heads, identically for every shape.

### ⚠️ The termination argument — a MEASUREMENT, not a ceiling and not a probability

This is the slice's real content and the rule to carry.

- A **refusal ceiling** (`MAX_PRINTED_FLIPS`) answers *"is this row malformed?"*. There
  is no malformed row here: the sentence is legal and fully specified.
- A **truncating cap chosen by feel** would silently lie about the game rather than
  loudly skip it — the opposite of what this engine does with everything it can't do.
- So the bound is owed to whatever **produces the values** (D128's provenance rule,
  third application). `MAX_UNTIL_TAILS_FLIPS = 64` lives in `rng.ts` beside `flipCoin`.

**Why 64 is provably unreachable.** mulberry32's pre-states advance by a fixed **odd**
stride (`state + 0x6d2b79f5`), so successive flips walk `n·K mod 2³²` and visit every
int32 exactly once. The face sequence is therefore **one closed cycle** whose worst
case is *computable*. Scanned over all **4 294 967 296** steps, plus the wrap (the
cycle ends `…HH` and begins `H…`, so no run straddles the seam):

> **THE LONGEST RUN OF CONSECUTIVE HEADS IS 31.**

64 is twice that. The cap cannot fire from any seed; every sequence ends in tails; the
guard is dead code by construction, which is what a guard of this kind should be. **To
re-derive after touching `nextU32`:** scan `n·K` for n in [0, 2³²) and take the longest
heads run — ~40 seconds of arithmetic in Bun, and it is an exact answer, not a bound.

**The cap is a PARAMETER, not a read of the constant.** `flipUntilTails(state, cap)`
takes its ceiling so the truncation branch stays reachable in a test at cap 1 and 2 —
a bound set above what the RNG can produce can never be observed by a test that only
drives the engine. And it returns **faces, not a count**, precisely so a caller can
detect a truncated sequence (all heads, no trailing tails).

### ⚠️ One flip count, BOTH damage members — the proof D126's split was load-bearing

4 printings are `D×` (`perHeads`, printed base **dropped**); Bouffalant is `50+`
(`bonusOnHeads`, printed base **kept**). Same opening sentence, two consequents, told
apart by the single word **"more"** — the same word that separates the whole additive
scaling family from the multiply one, and the same near-miss D127's regex was written
to refuse *by name*.

So **`bonusOnHeads` grew the same `flips` field D128 gave `perHeads`** (its D126
printings now derive `{ kind: "printed", count: 1 }` — what they always were
implicitly): only the SOURCE of the number moved, so D128's widen-don't-add rule
applies unchanged. **The union has stayed three members across four shapes** because
the flip COUNT and the flip CONSEQUENT are independent axes; a member per pair would
be six members and five copies of one fold.

### The suite

`untilTailsFlip.test.ts` (**39**) on a new `UNTIL_TAILS_FLIP_DECK` — both Actives are
`fix-titan` (340 HP, no Weakness) so no seed run ends in a KO and truncates an
assertion. It sweeps **32** seeds, asserts every announced sequence **ends in tails**,
recomputes each board's `rngState` against `flipUntilTails` itself with ±1 probes, and
pins the two members apart on ONE seed: first-flip-tails gives Bouffalant **50** damage
and Growlithe **nothing at all**. The termination block unit-tests `flipUntilTails`
directly — observable truncation at cap 1 and cap 2 with exact step accounting, the
`cap <= 0` no-op, face-for-face agreement with repeated `flipCoin`, the measured
constant (`=== 64`, `> 31`) with its re-derivation recipe, and a 400 000-state window
scan (labelled a *window*, not a proof).

⚠️ **An unbounded fold's outcome space is a GEOMETRIC TAIL.** 24 seeds reach heads
counts {0, 1, 3, 5} and **never 2** — so the coverage case asserts a **superset**
(contains 0, 1, 2 at SEEDS=32) rather than the exact set D127 and D128 could assert.
Do not copy their exact-set idiom into an unbounded shape.

Two loud-skip witnesses were **re-pointed, not deleted** (the family's standing rule):
`multiCoinFlip.test.ts`'s "two live *more* printings" keeps **Melmetal `swsh10.5-046`**
and promotes Bouffalant to a positive assertion; its "refuses the UNBOUNDED opening"
case moved from Growlithe to **Magikarp `sv02-042`**.

`bun run check` GREEN exit 0: **171 → 172 files, 2671 → 2710 tests**.

### Still unmapped in the coin family after D129 *(superseded by the D130 section below — read that first)*

- **`Flip 2 coins. This attack does 90 more damage for each heads.`** — Melmetal
  `swsh10.5-046` (`30+`), now the pool's ONLY unmapped printed-count ADDITIVE fold.
  Every part of it exists (`bonusOnHeads` carries `flips`, `takeFlips` answers
  `printed`, the member keeps the base), so it is one regex + one deriver arm. It is
  refused because it is **1 printing** — D121's warrant is unmet — and because it is a
  live witness. Mapping it is defensible; re-point the witnesses first.
- **`…tails. For each heads, <effect>.`** — Krookodile / Gyarados / Masquerain. A
  PROGRAM, not a fold: it runs an `EffectOp` N times, and D125's placement rule puts
  ops at `attack.ts`'s TAIL while the flips are taken in FRONT of §8.5, so the flip
  result must be **carried across the pipeline** — which nothing does today. That carry
  is the slice's content. `takeFlips` already returns the faces, so the flipping half
  is done. ⚠️ Its census is bigger than 3: Wugtrio `sv01-057` prints the PRINTED-count
  version (`Flip 3 coins. For each heads, …`) and Oinkologne `sv03-184` reads a heads
  COUNT into an op (`Put a number of cards up to the number of heads …`). Re-census
  `For each heads` and `number of heads` before assuming one slice.
- The multi-consequent long tail (Floette `sv01-092`, Dragonite ex `sv03-159`, Bisharp
  `sv03-149`, Magikarp `sv02-042`, Spiritomb `sv01-129`, Squawkabilly `sv01-162`) —
  refused by `$` and untouched by D126–D129.

The three unmapped board-fact damage clauses (Lokix `sv02-021`, Lucario `sv01-114`,
Slither Wing `sv06.5-026`) and their four loud witnesses are untouched by this slice.


## D130 — the PER-HEADS PROGRAM: `For each heads, discard the top N cards of your opponent's deck.` (engine 0.81.0)

The coin family's **first non-damaging consequent**. Two printings, mapped together
because they sit on two *different* flip counts:

| Card | Attack (index) | Text | `damage` |
|---|---|---|---|
| Wugtrio `sv01-057` | "Undersea Tunnel" (**1**) | `Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.` | **absent** |
| Gyarados `swsh10.5-022` | "Wreak Havoc" (0) | `Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.` | **absent** |

**The `For each heads` census is now CLOSED** (re-run 2026-08-01 over the WHOLE effect
string, 978 cards): 118 attack effects contain "heads" / 60 distinct; `For each heads`
is **4 printings / 4 distinct clauses**, of which these 2 are mills. `number of heads`
is a **1-printing hapax** (Oinkologne `sv03-184`). Do not re-run this census.

⚠️ **THE CARRY IS EXPANSION, NOT A CHANNEL — the generalisation to keep.** D125's
placement rule puts `EffectOp`s at `attack.ts`'s TAIL while the flips are taken in
FRONT of §8.5, and nothing carried a value between those points (`faces`/`heads` are
block-scoped in the flip block; the only escapee was `coinBonus`, a number). Every
"build a channel" answer — widen `EffectRecord` (§9.2's uid-array scratch), add a
`repeat` op, thread a per-resolution context object — is wrong for one reason:
**"For each heads, X" IS X repeated `heads` times, and the tail already runs an
`EffectOp[]`.** So the flip block splices `heads` copies of the member's ops into
`program`. No new channel, no new park state, no serialization question — the expansion
is a plain program that parks and resumes like any other. **Before building a channel
between two stages of one resolution, check whether the later stage's existing INPUT can
simply be rewritten.**

Two details of the expansion that are not incidental:
- it **APPENDS** (`[...(program ?? []), ...repeated]`) rather than replaces, so a
  registry row can never be silently dropped;
- it collapses an empty result back to `null`, so `heads === 0` takes the existing
  no-program ending unchanged rather than running `runProgram` with `[]`.

⚠️ **THE OPS LIVE ON THE COIN MEMBER, so ONE READER OWNS THE SENTENCE.**
`{ kind: "programPerHeads"; flips: AttackFlipCount; ops: EffectOp[] }` is
`AttackCoinFlip`'s 4th member. The split alternative (coin deriver returns the count,
`deriveAttackEffect` returns the op) would put two anchored readers on one string with
an invariant nobody enforces. `deriveAttackEffect` / `deriveAttackDamageBonus` /
`deriveAttackDamageMultiplier` / `deriveAttackRequirement` all still return `null` for
both sentences, asserted.

**`AttackFlipCount` was reused COMPLETELY UNCHANGED**, and the two printings landing on
two different members (`printed`, `untilTails`) is what turns D128's "count and
consequent are independent axes" from a claim into a demonstration.

### The new op — `{ op: "discardOpponentDeckTop"; count: number }`

Deterministic, **never parks**, consumes **no rng** — which is exactly what makes it
safe to repeat once per heads. Clamped by `slice`, so a shallow deck gives up what it
has and the event reports the SHORT list. Deliberately **no `whose:` and no filter**
(D104's minimal shape): both printings are opponent-side. Gyarados's *other* attack
"Wild Splash" is the own-deck reading — widen the field when that lands.

**No new event.** `DECK_TOP_DISCARDED` already says exactly the right thing — *these
uids went from the top of `seat`'s deck to `seat`'s discard* — with `seat` = the deck's
**OWNER**, which is the actor for Hydreigon's `attachFromTop discardRest` and the
**NON-actor** here. Naming uids leaks nothing (the discard pile is public), so
`redact.ts` still needs no arm. Its **log message was a lie the moment it had a second
producer** ("discarded N **looked-at** cards…") and was made provenance-neutral: the
D113 precedent exactly — reuse the event, fix the *message*.

⚠️ **DECK-OUT IS NOT THE OP'S BUSINESS, and the test cannot assert it naively.** §14.3
is checked at the DRAW (`flow.ts` `startTurn`), so milling to zero does not end the game
on the spot — but **attacking ends the turn**, so a clamped mill reaches the victim's
draw in the SAME event batch and `GAME_OVER reason:"deckOut"` always follows. The claim
is therefore pinned on **ORDER** (`DECK_TOP_DISCARDED` < `TURN_ENDED` < `TURN_STARTED`
< `GAME_OVER`, and no `CARDS_DRAWN`): a build that ended the game inside the op would
emit it a full turn early.

⚠️ **`modifierSimulated` grew its SECOND exception.** `programPerHeads` folds no damage,
so it explains no printed `+`/`×`; riding the existing `kind !== "cancelOnTails"` test
would suppress a loud row the engine has not earned. Neither printing carries a `damage`
field, so no board can reach the difference — written from the rule, not from what a
test would notice. `effectSimulated` needed **no** new term (`coinFlip !== null` already
covers it) and `scaledBase` **keeps** the base (this member owns no printed number for
it to duplicate).

### Fixture / witness work this slice forced

- `untilTailsFlip.test.ts`'s `For each heads` loud-skip block went from **three** to
  **two** printings (Masquerain `sv03-007`, Krookodile `sv01-117`); the end-to-end
  `ATTACK_EFFECT_SKIPPED` case moved from Gyarados onto **Krookodile** (fielded
  faithfully, `{F}` line added), and a new case asserts Gyarados is now POSITIVE.
- ⚠️ **`UNTIL_TAILS_FLIP_DECK` was re-pointed WITHOUT invalidating D129's measured seed
  table.** Setup's rng depends only on deck **length** and which **indices** hold a
  Basic, so the swap kept 60 cards and indices 12–29 as eighteen consecutive
  non-Basics (`3 Krookodile + 4 {R} + 3 {F} + 8 {C}` for `4 Gyarados + 6 {R} + 8 {C}`).
  The split is measured — only `(3,3,4,8)` and `(3,4,3,8)` leave every seed 0–31 enough
  copies to field, and `{C} = 8` is forced by seeds 20 and 29. **Every D129 pin passes
  unedited.** Reuse this reasoning before touching any measured deck.
- **A fixture lied and nothing caught it:** the Gyarados fixture claimed
  `resistances: [{ type: "Grass", value: "-30" }]` while its doc said "verbatim off the
  local D1"; the D1 row's `resistances_json` is `null`. No test asserted it, which is
  how it survived. Corrected.
- `perHeadsProgram.test.ts` — **36 tests**, `SEEDS = 12` chosen by **measurement** over
  seeds 0–199: Wugtrio's three-tails outcome first appears at **seed 10** and is the
  binding constraint (every "nothing happened" assertion rests on it); 12 also covers
  Wugtrio's full outcome space `{0,1,2,3}`. Gyarados's set is asserted as a **superset**
  only (contains 0, contains ≥2) — D129's rule for an unbounded count.

`bun run check` GREEN exit 0: **172 → 173 files, 2710 → 2747 tests**. No web/API/DB/
`@luminous/schema` diff; no `MATCH_RECORD_VERSION` bump.

### Still unmapped in the coin family after D130 *(the seven mills item is DONE — D131 below)*

- ~~**The seven UNCONDITIONAL opponent-side mills.**~~ **DONE in D131**, and bigger than
  forecast: the same anchor also reads the NINE own-deck printings, so the slice landed
  **16 printings** rather than 7. See the D131 section below.
- **Melmetal `swsh10.5-046`** — `Flip 2 coins. This attack does 90 more damage for each
  heads.` (`30+`), still the pool's ONLY unmapped printed-count additive fold, still
  refused for being **1 printing** and a live witness. Unchanged by D130.
- **Masquerain `sv03-007`** — `…tails. For each heads, discard a random card from your
  opponent's hand.` Would be the **first `EffectOp` in the engine to consume
  `state.rngState`**; it must do so deterministically and survive a park.
- **Krookodile `sv01-117`** — `…tails. For each heads, discard an Energy from your
  opponent's Active Pokémon.` The op exists but **PARKS**, so N heads is N sequential
  parks across a serialized continuation. D130's expansion carry is already correct for
  it; the open question is N parks versus collapsing them.
- **Oinkologne `sv03-184`** — `Flip 3 coins. Put a number of cards up to the number of
  heads from your discard pile into your hand.` A heads COUNT read as a **ceiling**, not
  a repeat: `discardPileRetrieval` already takes an "up to" `max`, so this wants a 5th
  `AttackCoinFlip` member handing a NUMBER to one op. Expansion does not answer it
  (running one op 3× is not "up to 3"). 1 printing — D121's warrant unmet.
- The multi-consequent long tail (Floette `sv01-092`, Dragonite ex `sv03-159`, Bisharp
  `sv03-149`, Magikarp `sv02-042`, Spiritomb `sv01-129`, Squawkabilly `sv01-162`) —
  refused by `$` and untouched by D126–D130.

The three unmapped board-fact damage clauses (Lokix `sv02-021`, Lucario `sv01-114`,
Slither Wing `sv06.5-026`) and their witnesses are untouched by this slice.


## D131 — the UNCONDITIONAL MILL, both directions: `Discard the top [N cards|card] of your [opponent's] deck.` (engine 0.82.0)

**16 printings / 7 distinct clauses on ONE anchored regex and ONE `deriveAttackEffect`
arm** — the largest single mapping this family has taken and the cheapest per printing.
Censused 2026-08-01 against the local D1 over the WHOLE effect string. Every one is a
STANDALONE single sentence, and **9 of the 16 carry printed damage**.

| Clause | Printings | Cards |
|---|---|---|
| `Discard the top card of your opponent's deck.` | 4 | Garganacl `sv02-123` + Diggersby `sv03-113` ("Knocking Hammer"), Paldean Clodsire `sv03-128` ("Muddy Hammer"), Skwovet `sv03-178` ("Nicked Nibble") |
| `Discard the top 2 cards of your opponent's deck.` | 3 | Chi-Yu ex `sv02-040`/`-234`/`-259` ("Jealously Singe") |
| `Discard the top card of your deck.` | 3 | Fraxure `sv06.5-045`/`-077` ("Dragon Pulse"), Diglett `sv03-103` |
| `Discard the top 2 cards of your deck.` | 2 | Tyranitar ex `sv03-066`/`-211` ("Mountain Hurl") |
| `Discard the top 3 cards of your deck.` | 1 | Haxorus `sv06.5-046` ("Dragon Pulse") |
| `Discard the top 4 cards of your deck.` | 2 | Tyranitar `sv02-135`/`-222` ("Dread Mountain") |
| `Discard the top 5 cards of your deck.` | 1 | Gyarados `swsh10.5-022` ("Wild Splash") |

**This census is CLOSED. Do not re-run it.**

⚠️ **THE SLICE'S SPEC WAS WRITTEN BY THE PREVIOUS SLICE — that is the lesson.** D130
shipped the mill op opponent-only (D104's minimal shape) and wrote into its own doc block
that the own-deck reading was live and unmapped, and that *"the first slice that maps it
widens this field then, with two readings in hand rather than one guessed at."* D131
executed that note verbatim with nothing re-derived: `discardOpponentDeckTop` →
**`discardDeckTop { whose: "self" | "opponent"; count }`**, and the interpreter arm grew
**one ternary**. **When you decline a widening, write down the condition that would
warrant it.** The note cost two sentences and bought a 16-printing slice for a regex.

⚠️ **WIDEN THE FIELD, DON'T ADD A MEMBER** (D128's provenance rule in the small). The
two sentences differ in exactly one word and everything downstream of picking the seat is
byte-identical. **Gyarados `swsh10.5-022` settles it alone: index 0 mills the OPPONENT
(D130, behind an until-tails coin), index 1 mills its OWN deck for 5.** One card, one
action, two directions — and the fixture already carried both sentences verbatim (D130
fielded "Wild Splash" as its refused near-miss), so the proof case cost zero new bytes
and one flipped assertion.

⚠️ **TWO CAPTURES IN ONE REGEX IS NOT A D119 VIOLATION.** D119 governs the clause
TABLE, where a row is a lookup KEY and a two-token row is N rows in disguise. Here both
tokens land in FIELDS of one op (`count`, `whose`), each has a closed reading, and the
sentence is a single printed action.

⚠️ **THE SINGULAR IS ITS OWN ALTERNATION BRANCH, NOT `(\d+)?`** — two printed
SPELLINGS, not one with an optional part: "the top card" never carries a digit, "the top
N cards" always does, "the top cards" is neither and reads as nothing. The branch does
**not** filter: "the top 1 cards" is unprinted but unambiguous and is accepted. (The
first draft's doc + test claimed it was refused; the test caught the claim and the CLAIM
was corrected, not the regex.)

⚠️ **THE SELF-MILL IS A PRINTED COST, AND §14.3 STAYS AT THE DRAW.** The op can now
empty the ATTACKER's deck. An OPPONENT mill-out loses in the SAME event batch
(`DECK_TOP_DISCARDED` < `TURN_ENDED` < `TURN_STARTED` < `GAME_OVER`); a SELF mill-out
emits **no `GAME_OVER` at all** in that batch and loses a FULL TURN LATER, after the
opponent passes. Both pinned. The asymmetry is in the rule, not in the op.

⚠️ **NOTHING DOWNSTREAM NEEDED A DIFF, and D113/D130 paid for that in advance.**
`DECK_TOP_DISCARDED` was already provenance-neutral and keyed to the deck's OWNER, so one
op emitting on both seats needed no log copy change, no new event and no redact arm.

⚠️ **A CONTROL BECAME A CASE.** `retreatLock.test.ts`'s "does not inherit down the
attack index" rides Paldean Clodsire `sv03-128`, whose index-1 "Muddy Hammer" was the
*unsimulated* half of a "one card, one derived attack" control. It now derives a
DIFFERENT op, which makes the case stronger, not weaker. The fixture doc says so.

⚠️ **THE FIVE REAL NEAR-MISSES the anchor refuses**, all pinned in
`deckTopMill.test.ts` as "stays LOUD" witnesses: Wiglett `sv01-056` (the same action
GATED behind a flip — **still unmapped by anything**), Wugtrio `sv01-057` / Gyarados
`swsh10.5-022` idx 0 (D130's programs — simulated, but by the OTHER reader), Whiscash
`sv03-109` (a BOARD-COUNTED mill amount — the shape D128 would answer), and **Camerupt
`sv03-032`** (`Discard the top card of each player's deck. This attack does 100 more
damage for each Energy card discarded in this way.` — two decks AND a bonus reading WHAT
was discarded; refused by the bonus reader too, so the whole row stays loud).

`bun run check` GREEN exit 0: **173 → 174 files, 2747 → 2768 tests**. `biome format`
churn re-measured on a clean tree: **20 files, unchanged**. No web/API/DB/
`@luminous/schema` diff; no `MATCH_RECORD_VERSION` bump.

### Still unmapped after D131 — the mill neighbourhood

- **Wiglett `sv01-056` "Dig a Little"** — `Flip a coin. If heads, discard the top card of
  your opponent's deck.` The op and the gate (`coinFlipGate`) both exist; nothing reads
  this sentence. **1 printing**, so D121's warrant is unmet — and it is a live witness in
  `deckTopMill.test.ts`. Re-point it before mapping it.
- **Whiscash `sv03-109` "Raging and Rocking"** — `For each {F} Energy attached to this
  Pokémon, discard the top card of your opponent's deck.` A board-counted repeat with no
  coin: D128's `attachedEnergy` count feeding D130's expansion, on a non-coin site that
  does not exist yet. **1 printing.**
- **Camerupt `sv03-032` "Eruption"** — two decks in one sentence AND a damage bonus that
  counts **what was discarded**. Needs a mill whose RESULT is readable by the bonus
  reader, which is a channel between two stages — exactly the thing D130 said to check
  for an existing input first. **1 printing.**

---

## D132 — the BARE SELF-HEAL: `Heal {N} damage from this Pokémon.` (engine 0.83.0)

**18 printings / 4 distinct clauses on ONE anchored regex and ONE `deriveAttackEffect`
arm, with NO interpreter diff at all.** The largest printings-per-byte slice this reader
has taken, and the cheapest — because the mechanism had already shipped.

### The census (local D1, 2026-08-01, whole effect string, 978 cards)

`Heal {N} damage from this Pokémon.` is the **entire printed effect** on all 18. Every one
is a standalone single sentence; none aims at a Pokémon other than "this", which is why the
`heal` op needed no target field.

| N | printings | cards |
|---|---|---|
| 30 | 8 | Horsea `sv06.5-010`/`-067` + Slowpoke `swsh10.5-019` "Hold Still" (no dmg); Slowbro `sv01-043` (60) + Azumarill `sv02-045` (50) "Bubble Drain"; Brambleghast `sv02-024` "Absorb Life" (30); Ceruledge `sv02-098` "Life Sucker" (50); Dolliv `sv03-020` "Sunny Wind" (30) |
| 20 | 5 | Natu `swsh10.5-032` "Nap" (no dmg); Tropius `sv02-007`/`-195` "Leaf Drain" (20); Marill `sv02-044`/`-204` "Bubble Drain" (20) |
| 10 | 4 | Shroomish `sv01-003` + Smoliv `sv03-019` "Absorb" (10); Bramblin `sv02-023`/`-198` "Blot" (10) |
| 50 | 1 | Ariados `swsh10.5-007` "Absorb" (50) — attack **index 1**, the family's only non-index-0 printing |

**12 of the 18 carry printed damage** (free under D125's tail placement — ops run after
the §8.5 pipeline, so "50 to the defender, then heal 30 on itself" resolves in printed
order); the other 6 print **no `damage` field at all**, so the heal is the entire visible
result of the declaration. The suite pins both, deliberately: **a build that folded the
heal into the damage pipeline would pass the first case and fail the second.**

The **wider heal census is now CLOSED — do not re-run it.** 42 heal-mentioning attack
printings / 18 distinct clauses pool-wide. 20 are mapped (these 18 + the 2 compound
`SELF_SLEEP_HEAL` printings). The remaining 22 printings / 16 clauses are itemised under
"Still unmapped after D132" below.

### ⚠️ The op had existed since 0.x — the READER was the whole gap

`{ op: "heal"; target: "self"; amount: number }` is one of the oldest members of
`EffectOp`. It shipped for the COMPOUND printing `This Pokémon is now Asleep. Heal {N}
damage from it.` (`SELF_SLEEP_HEAL`, Slowpoke `sv01-042`/`-204`, Cetoddle `sv02-054`) and
`interpreter.ts`'s `healSelf` has been correct ever since — it resolves "this Pokémon" at
`ctx.seat` (never a hardcoded seat), clamps with `Math.min(amount, active.damage)`, emits
one `HEALED` only when the clamp leaves something, and never parks.

So the slice was a regex, an arm and a guard. **The generalisation worth carrying:
before pricing a shape, ask what an EXISTING arm already emits. The compound form of a
sentence is the cheapest possible spec for its bare form** — it has already answered every
semantic question (who heals, how much, what happens on a whiff) and has end-to-end tests
proving the answers. This is D131's lesson pointing the other way: D131 executed a *note* a
previous slice left; D132 found a previous slice had already shipped the *machinery*.

The `heal` member was also **the only member of the entire `EffectOp` union with no doc
comment**. It has one now, including why `target` stays a one-value literal union: no pool
printing heals the DEFENDER, and the seat is resolved by the interpreter rather than
carried in the op.

### ⚠️ One anchored reader per printed string — proved, not asserted

```ts
const SELF_HEAL       = /^Heal (\d+) damage from this Pokémon\.$/;
const SELF_SLEEP_HEAL = /^This Pokémon is now Asleep\. Heal (\d+) damage from it\.$/;
```

The new anchor starts at `^Heal`; the compound never does. **Neither can claim the other's
string, so the family's one-reader-per-printed-string invariant holds by construction
rather than by arm ordering** — the new arm could sit anywhere in `deriveAttackEffect` and
behave identically. The suite makes that checkable rather than descriptive: it asserts the
compound's *second* op is **byte-identical** (`toEqual`) to the bare anchor's output for
the same N. No `/i` flag, per the family's standing rule — the capitalised first word plus
`^…$` is the whole guard, and it is what keeps Fuecoco `sv02-035`'s mid-sentence
`…, heal 30 damage from this Pokémon.` off this path and on the loud one.

### ⚠️ The guard is the family's; the clamp is the interpreter's

`amount >= 1` refuses a printed "Heal 0 damage" — the guard every arm here carries, because
**a silent no-op that reports a simulated effect is strictly worse than a loud unsimulated
one**. But there is deliberately **no ceiling and no clamp in the deriver**: `healSelf`
already takes `Math.min(amount, damage)`, so the printed number is a MAXIMUM and the board
decides the rest. A malformed large amount heals an Active to full and stops, which is a
legal board state.

And the two silences are different facts that must not share a log row:

- **a WHIFF** (undamaged Active) → no `HEALED` event, and the attack is still **SIMULATED**
  (no `ATTACK_EFFECT_SKIPPED`). The op ran and had nothing to do.
- **an UNREAD sentence** → `ATTACK_EFFECT_SKIPPED`, loud.

Both are asserted. The direction is asserted from the side that must **not** move: the
defender takes its printed damage and is never healed, so a `target` read the wrong way
round fails exactly there and passes every count assertion above it.

### Fixture / control work this slice forced

- **Ceruledge `sv02-098` was already in `FIXTURE_POOL`** with the exact printed text, and
  its doc block had called Life Sucker "UNBUILT … a standing marker for the bare-heal
  sentence family". Rewritten: the family is mapped, and Ceruledge is now the
  with-printed-damage end-to-end occupant. (Stage 1 from Charcadet, so it is only ever
  fielded by `setActiveFromDeck` surgery, never played.)
- **New fixture: Natu `swsh10.5-032`** (50 HP Psychic Basic, ×2 Darkness, −30 Fighting),
  verbatim off the D1 — "Nap" `{C}` heals 20 with **no `damage` key**, "Peck" `{P}{C}` deals
  20 with **no `effect` key**. It is the no-printed-damage half and the different-N half in
  one card. Its `{P}` is unpayable from `SELF_HEAL_DECK` (Colorless-only), so its index-1
  control is deriver-level rather than end-to-end — the same arrangement Wugtrio's
  "Headbutt" has in `PER_HEADS_PROGRAM_DECK`.
- **`SELF_HEAL_DECK`** — 4 Ceruledge / 4 Natu / 12 `fix-energy` / 40 `fix-titan`, both seats.
- ⚠️ **`setDamage(state, seat, 100)` on Natu is a corpse** (50 HP) and the epilogue KO sweep
  clears it, leaving `active` undefined. The suite uses a named `NATU_HURT = 40` — still
  above both 20 and 30, so the heal stays unclamped and the different-N claim holds.
- **A control became a stronger case, not a deletion.** `clauseTable.test.ts`'s "Ceruledge's
  index-0 heal is its own index-keyed negative" asserted `deriveAttackEffect(lifeSucker)`
  was `null`. It now asserts the exact `heal` op, so the two SCALING derivers staying silent
  on it is a statement about **which reader owns which sentence** rather than about an
  absence.

### The suite

`selfHeal.test.ts` — **17 tests, one board, no seed sweep** (the sentence takes no coin, and
the suite asserts that by pinning `rngState` unchanged). Five describes: the anchor (4
clauses, the zero guard, the five refused catalog rows, the compound handoff, the
rewrite/anchor/case/NBSP refusals); the fixtures' printed text char-for-char; Ceruledge end
to end (heal + printed damage, both seats, the clamp, the silent whiff); Natu end to end
(heal with no damage, a different N, the index-1 control); and what the slice costs the
rest of the engine (no rng, never parks, zero registry rows).

**Cost:** 1 regex, 1 deriver arm, 1 fixture, 1 deck, 1 test file, 1 doc block on the
undocumented member, 1 flipped assertion. ZERO new events, ops, `EffectOp` /
`AttackCoinFlip` / `AttackFlipCount` / `BoardCondition` / `DamageCountSource` members,
clause-table rows, state fields, prompts, error codes, registry rows, redact arms or log
arms. **No `interpreter.ts` diff.** No `rng.ts` / `continuous.ts` / `attack.ts` /
`events.ts` diff. No web/API/DB/`@luminous/schema` diff; no `MATCH_RECORD_VERSION` bump.
Full `bun run check` green exit 0: **174 → 175 files, 2768 → 2785 tests**.

### ⚠️ The `biome format` churn number was never a measurement

Four sessions recorded it as 89 (D128), 57 (D113) and 20 files (D131), each telling the next
to "re-measure rather than quote any of these". **The cause: `biome format` truncates its
diagnostics at `--max-diagnostics`, default 20.** Every figure was a cap, or a differently
capped count. Measured to convergence (identical output at `--max-diagnostics` 500 / 1000 /
3000): **88 files repo-wide, 83 excluding the gitignored `.claude/worktrees/` copies.**

Always pass an explicit high `--max-diagnostics` and exclude `.claude/worktrees/` before
quoting a churn number. `bun run check` does not run the formatter, so
`bunx biome format --write` any file you touch — that removes it from the set permanently,
which is why the count is a ceiling that only ever falls.

### Still unmapped after D132 — the heal neighbourhood, ranked by cost

All five are live "stays LOUD" witnesses in `selfHeal.test.ts`. **Re-point the witness
before mapping any of them; never delete the case.**

- **`Heal {N} damage from each of your Pokémon.` — 7 printings / 2 clauses, and the
  cheapest un-taken thing in the engine.** Skeledirge ex `sv02-037`/`-233`/`-258`/`-272`
  "Vitality Song" (30, with a printed 50) + Steenee `sv03-017` "Aromatherapy" (30, no dmg) +
  Cresselia `sv06.5-021`/`-071` "Healing Pirouette" (20, no dmg). **`healEach { amount }`
  already exists** (Garganacl "Blessed Salt") and is non-parking — this is D132 again.
  ⚠️ Verify first whether `healEach` covers the ACTIVE as well as the Bench: "each of your
  Pokémon" means all in-play, and its only existing consumer is a between-turns trigger, so
  the reading has never been exercised from an attack.
- **`Heal {N} damage from 1 of your Pokémon.` — 5 printings / 3 clauses.** Nacli
  `sv02-121`/`-220` (20), Vespiquen ex `sv03-096`/`-212` (60), Smoliv `sv01-021` (30).
  `healChosen { amount }` exists (Potion) but **PARKS on a choice**, so this would be the
  first parking op the *attack* deriver emits — check how the D125 tail placement interacts
  with a park before pricing it. Warrant met (3 clauses).
- **The BENCHED-only variants — 4 printings / 4 clauses, needing a filter `healChosen` does
  not have.** Tropius `sv01-007` (60), Chansey `swsh10.5-051` (30), Combee `sv03-008` (20)
  print `from 1 of your Benched Pokémon.`; Blissey `swsh10.5-052` + Arboliva `sv03-021`
  print `Heal all damage from 1 of your Benched Pokémon.` (`healChosen` already takes
  `amount: "all"`, so that half is free). Honour the printed zone word — "Bench" excludes
  the Active (D120).
- **Fuecoco `sv02-035`/`-201` "Spacing Out"** — `Flip a coin. If heads, heal 30 damage from
  this Pokémon.` **2 printings and both halves exist** (`coinFlipGate` + `heal`): one regex
  beside the `FLIP_OPPONENT_ACTIVE_DISCARD` twin it copies exactly, and unlike Wiglett
  `sv01-056` (the mill neighbourhood's gated twin) **D121's warrant IS met.** ⚠️ Floette
  `sv01-092`'s `Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage
  from this Pokémon.` is a compound of a damage BONUS and an OP on one flip — a different
  and harder shape. Do not let one regex reach for both.
- **Iron Moth `sv06.5-009` "Suction"** — `Heal from this Pokémon the same amount of damage
  you did to your opponent's Active Pokémon.` 1 printing, and it wants a channel from the
  §8.5 pipeline's RESULT back into an op that runs at the tail. **Structurally identical to
  Camerupt `sv03-032` (the mill neighbourhood's hardest)** and the one shape D130's "rewrite
  the later stage's existing input" rule does not answer. Do it last or not at all — and if
  you do, do it *with* Camerupt, since one channel would serve both.

---

## D133 — the OWN-BOARD HEAL: `Heal {N} damage from each of your Pokémon.` (engine 0.84.0)

**Read straight off D132's remainder list.** No new census was run and none was needed:
the section above had already ranked this "the cheapest un-taken thing in the engine",
named all seven printings, and flagged the one thing to verify. It cost exactly what
that note forecast — **one anchored regex, one deriver arm, and no interpreter diff**.
That is the second slice in a row where a *previous slice's written-down remainder* was
the whole spec. Keep writing them.

### The census (local D1, 2026-08-01, whole effect string, 978 cards)

`attacks_json LIKE '%from each of your%'` → **7 printings / 2 distinct clauses**, every
one a STANDALONE single sentence (no compounds):

| N | printings | cards |
|---|---|---|
| 30 | 5 | Skeledirge ex `sv02-037`/`-233`/`-258`/`-272` "Vitality Song" (**WITH a printed 50**); Steenee `sv03-017` "Aromatherapy" (no `damage`) |
| 20 | 2 | Cresselia `sv06.5-021`/`-071` "Healing Pirouette" (no `damage`) |

The same sweep also confirms the neighbourhood the anchor must *not* reach: Garganacl
`sv02-123`'s Ability (the existing `healEach` consumer), Picnic Basket `sv01-184`
(`healEachAll`), and Saguaro `sv02-187`/`-255`/`-270` (a mid-sentence "…and heal 50
damage from each of them." behind a choice).

```ts
const OWN_BOARD_HEAL = /^Heal (\d+) damage from each of your Pokémon\.$/;
// → [{ op: "healEach", amount }]   (guard: amount >= 1; no ceiling)
```

### ⚠️ The reading is the slice; the regex is not

**"Each of your Pokémon" is the ACTIVE *and* the whole Bench.** §1.1 — the Active is one
of your Pokémon, and only the printed word "Benched" excludes it (D120's zone rule).
`healEach` was *already* written that way (`side.active`, then `side.bench` in index
order), but it had only ever been reached from a **Checkup trigger**, where the Active is
nobody in particular. From an **attack** the Active is the ATTACKER — which is exactly
the case a build that healed "the rest of the board" gets wrong. So the reading is
asserted end to end rather than inherited from the op's doc comment, including the
degenerate **empty-Bench** board where the Active alone *is* "each".

Generalise: **when you reach an existing op from a new site, the op's semantics are not
automatically re-verified — only the ones the old site happened to exercise were ever
tested.** Ask which of its readings the *new* caller depends on that the old one did not.

### ⚠️ The clamp is PER POKÉMON, and the whiff is silent PER POKÉMON

A board of {100, 80, 10} damage against a printed 30 heals {30, 30, 10} and emits three
rows reporting exactly that. A shared clamp — or a clamp read once off the Active —
passes every one-body board and fails only here. And an **undamaged body sitting BETWEEN
two damaged ones** emits no row and does not truncate the sequence: the count of `HEALED`
rows is the count of Pokémon that MOVED, never the count on the board.

### ⚠️ The seat scope is the `healEachAll` boundary — assert it from BOTH sides

`healEach` is seat-scoped through `ctx.seat`; `healEachAll` (Picnic Basket) is not. The
difference is **invisible on an undamaged opponent**, which is why every earlier heal
board would have passed a seat-blind implementation. So the end-to-end case DAMAGES the
opponent's Active *and* Bench and asserts both come back unhealed, and the deriver case
refuses the Picnic Basket sentence in text form.

### ⚠️ The anchor's real job is Saguaro

`Choose up to 2 of your Pokémon and heal 50 damage from each of them.` is the mapped
words, mid-sentence, behind a choice. A reader without `^` takes its tail and heals the
whole board unconditionally. Saguaro is a **Supporter** and never routes through
`deriveAttackEffect` in production — the guard is asserted anyway, because **a guard that
depends on which reader a card happens to reach is not a guard.**

### ⚠️ `clearBench` — a new test surgery, and a trap that had been latent

`setActiveFromDeck` **DISPLACES** the Active it replaces onto the bench rather than
removing it. So a board built by two or three successive Active surgeries silently
carries one benched *stranger* per surgery. That is invisible to every suite that only
asserts the Active (which is most of them) and WRONG for any suite whose claim is about
the whole SIDE — a board heal, a spread, a bench count, a §1.1 "each of your Pokémon".
**The first three test failures of this slice were all that, not the engine.**

`clearBench(state, seat)` (testFixtures.ts) empties the bench and returns every card on
it — stack, attached Energy, attached Tools — to the bottom of that seat's deck, so the
board stays legal-shaped with every uid in exactly one zone. Call it after the LAST
Active surgery and before benching the bodies the case actually wants. **Any future
side-wide slice should reach for it first.**

### Fixture / deck work this slice forced

- **`sv02-037` Skeledirge ex** — 340 HP Stage 2 from Crocalor, Fire, retreat 3, ×2 Water.
  The WITH-PRINTED-DAMAGE half (heal 30 across the board AND a flat 50), and 4 of the 7
  printings on its own. Its `ex` suffix is kept faithful because `prizeValueOf` reads the
  rule box off the NAME — nothing in the heal family depends on it, which is exactly why
  a fixture that quietly renamed it would make a true thing false with no test noticing.
- **`sv06.5-021` Cresselia** — 120 HP Basic, Psychic, retreat 1, −30 Fighting Resistance.
  The NO-DAMAGE half and the second clause, on a different N so a hardcoded 30 downstream
  cannot satisfy both. Index-1 "Crescent Purge" ({P}{P}{P}) is the unmapped-neighbour
  control, unpayable from the deck.
- **`BOARD_HEAL_DECK`** — 4 Skeledirge ex / 4 Cresselia / 6 `fix-fire-energy` /
  6 `fix-psychic-energy` / 40 `fix-titan`, both seats. **Two TYPED Energy lines**, because
  both attacks print a typed single cost and Colorless pays neither. `fix-titan` does
  double duty: the pinned Active on both sides *and* every benched body (340 HP carries
  any damage figure a case wants without the KO sweep removing it mid-count).

### The suite

`boardHeal.test.ts` — **20 tests, ONE board, no seed sweep** (nothing here takes a coin;
`rngState` is asserted unchanged). Notable cases beyond the usual anchor/guard/rewrite
set: the Active-and-Bench reading, the per-Pokémon clamp on a {100, 80, 10} board, the
undamaged-body-in-the-middle whiff, the empty-Bench board, the damaged-opponent seat
boundary, both seats, and **`healEach { amount: 20 }` asserted byte-identical to the
program the Garganacl registry row carries** — which is what makes "one action, two
readers" a checkable claim rather than a description.

**Two witnesses re-pointed in `selfHeal.test.ts`, per the standing rule** (map one,
re-point it — never delete): `REAL_NEAR_MISSES[1]` moved from Steenee's now-mapped
sentence to Tropius `sv01-007` (`Heal 60 damage from 1 of your Benched Pokémon.`), and
the inline rewrite list swapped the same string for Chansey `swsh10.5-051`'s
(`Heal 30 damage from 1 of your Benched Pokémon.`).

### Still unmapped after D133 — the heal neighbourhood, ranked by cost

All live "stays LOUD" witnesses in `selfHeal.test.ts` and/or `boardHeal.test.ts`.
**Re-point the witness before mapping any of them; never delete the case.**

- **The FLIP-GATED OP family — 3 printings / 2 clauses across two workstreams, and the
  cheapest thing left.** Fuecoco `sv02-035`/`-201` "Spacing Out" (`Flip a coin. If heads,
  heal 30 damage from this Pokémon.`) and Wiglett `sv01-056` "Dig a Little" (`Flip a coin.
  If heads, discard the top card of your opponent's deck.`). **Both consequents already
  exist** (`heal` / `discardDeckTop`) and both copy `FLIP_OPPONENT_ACTIVE_DISCARD`
  exactly, so each is one anchored regex + one arm. Taking them TOGETHER is what makes
  Wiglett defensible on its own: alone it is 1 printing and D121's warrant is unmet;
  beside Fuecoco (2 printings, warrant met) it is a second member of a shape the engine
  already reads a third instance of. ⚠️ **Literal arms, NOT a template** — the varying
  token is the whole consequent, an OPEN vocabulary, so D120's precondition fails.
  ⚠️ Floette `sv01-092` (`…this attack does 30 more damage, and heal 30 damage from this
  Pokémon.`) is a bonus AND an op on one flip — a different, harder shape. Do not let one
  regex reach for both.
- **`Heal {N} damage from 1 of your Pokémon.` — 5 printings / 3 clauses.** Nacli
  `sv02-121`/`-220` (20), Vespiquen ex `sv03-096`/`-212` (60), Smoliv `sv01-021` (30).
  `healChosen { amount }` exists (Potion) but **PARKS on a choice**, so this would be the
  first parking op the *attack* deriver emits — check how the D125 tail placement
  interacts with a park before pricing it. Warrant met (3 clauses). This is the one that
  opens a real mechanism question rather than adding a reader.
- **The BENCHED-only variants — 4 printings / 4 clauses, needing a filter `healChosen`
  does not have.** Tropius `sv01-007` (60), Chansey `swsh10.5-051` (30), Combee
  `sv03-008` (20) print `from 1 of your Benched Pokémon.`; Blissey `swsh10.5-052` +
  Arboliva `sv03-021` print `Heal all damage from 1 of your Benched Pokémon.`
  (`healChosen` already takes `amount: "all"`, so that half is free). Honour the printed
  zone word — "Bench" excludes the Active (D120). Best taken *with* the chosen-heal above,
  since the park question is the same one twice.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132's note: a channel from the
  §8.5 pipeline's RESULT back into a tail op, structurally identical to Camerupt
  `sv03-032`. Do it last or not at all, and do it *with* Camerupt.

**The heal census stays CLOSED** — 42 heal-mentioning attack printings / 18 distinct
clauses pool-wide; 18 bare self-heal (D132), 2 compound `SELF_SLEEP_HEAL` (0.x), 7
own-board (D133). Do not re-run it.

---

## D134 — the FLIP-GATED OP family: `Flip a coin. If heads, <action>.` (engine 0.85.0)

Two more consequents of a shape the engine has read since 0.x now SIMULATE, on **TWO
anchored regexes and TWO `deriveAttackEffect` arms**, with **NO interpreter diff** —
the third slice running. Read straight off D133's remainder list, which had ranked it
"the cheapest thing left" and named all three printings.

### The census (local D1, 2026-08-01, whole effect string, 978 cards)

`attacks_json LIKE '%Flip a coin. If heads,%'` returns **76 printings / 29 distinct
clauses** — the whole gated neighbourhood in one query, and worth keeping because it
is the map for every future slice in this family. Counted through the derivers
themselves (not by eye): **45 mapped / 31 unmapped** after this slice.

| Clause | Printings | Status after D134 |
|---|---|---|
| `…your opponent's Active Pokémon is now Paralyzed.` / `…Burned.` / `…Poisoned.` | 16 / 1 / 1 | ✅ `FLIP_DEFENDER_NOW` (0.x) |
| `…this attack does {N} more damage.` (N ∈ {10,20,30,50,60,80,90}) | 20 | ✅ `deriveAttackCoinFlip` (D126) |
| `…discard an Energy from your opponent's Active Pokémon.` | 4 | ✅ `FLIP_OPPONENT_ACTIVE_DISCARD` (0.x) |
| **`…heal {N} damage from this Pokémon.`** | **2** | ✅ **`FLIP_SELF_HEAL` (D134)** |
| **`…discard the top card of your opponent's deck.`** | **1** | ✅ **`FLIP_DECK_TOP_MILL` (D134)** |
| `…during your opponent's next turn, prevent all damage…` (two spellings) | 11 + 2 | ❌ a §11 block with a DURATION — the biggest un-taken count |
| `…this attack does 90 more damage, and …is now Confused.` | 3 | ❌ a bonus AND an op on one flip |
| `…this attack does 30 more damage, and heal 30 damage from this Pokémon.` | 1 | ❌ same shape (Floette `sv01-092`) |
| `…this attack does 140 more damage. If tails, …can't attack.` | 1 | ❌ has an `otherwise` |
| `…is now Paralyzed and Poisoned.` | 2 | ❌ a COMPOUND status, not a `StatusName` |
| `…search your deck for up to 5 Grass Energy cards…` | 2 | ❌ a deck search behind a gate |
| `…switch in 1 of your opponent's Benched Pokémon…` / `…switch this Pokémon with 1 of your Benched…` | 1 + 1 | ❌ a gust / a self-switch |
| `…choose a Special Condition…` / `…choose an attack from 1 of your opponent's Pokémon…` / `…choose 1 of your opponent's Benched Pokémon. Shuffle…` | 3 | ❌ three parks |
| `…put your opponent's Active Pokémon and all attached cards into your opponent's hand.` | 1 | ❌ a scoop |
| `…they can't play any Item cards…` | 1 | ❌ an Item lock |
| `…this attack does 10 damage to 1 of your opponent's Pokémon.` | 1 | ❌ a gated snipe |
| `…search your deck for a card… If tails, discard a card from your hand.` | 1 | ❌ has an `otherwise` |

**The two mapped clauses are the only ones whose consequent this reader already had
an op for.** That is the whole selection criterion, and it is D132's inventory rule.

### ⚠️ The one judgement call: shipping the two together

Fuecoco `sv02-035`/`-201` "Spacing Out" is **2 printings** and clears D121's warrant
alone. Wiglett `sv01-056` "Dig a Little" is **ONE** and does not. Taken together the
SHAPE is 3 printings / 2 clauses, and the engine already reads two other instances of
it — so Wiglett is a **fourth member of a family** rather than a bespoke row for one
card.

**THE RULE: when a one-printing sentence is an INSTANCE of a shape the engine already
reads, the warrant is owed by the SHAPE, not by the printing. Count members of the
family, not copies of the card.** The converse still holds unchanged: a one-printing
sentence that *introduces* a shape still owes D121's two.

### ⚠️ Literal arms, not a D120 template — the precondition FAILING

The token that varies between the two anchors is the **whole consequent**: an
open-ended vocabulary of everything an `EffectOp` can express. D120 licenses a
template only when the varying token has a **closed** reading (the five status words,
the nine energy codes). It does not here, and the suite asserts it as a **set
intersection** — the two consequents share not one word after `"If heads, "`.

So the gate prefix is spelled out once per consequent. `effects.ts` now carries FOUR
copies of `Flip a coin\. If heads, ` on purpose; that duplication is the shape of the
argument, not an oversight to be refactored away.

### ⚠️ The mill arm is deliberately narrower than `DECK_TOP_MILL`

The bare anchor reads both a plural count and either deck (D131). Exactly ONE gated
printing exists and it is the **singular, opponent-side** one, so widening the gated
body would invent three readings the ingest has never produced. Widen it when a
printing appears, with the readings in hand — D130→D131 is the precedent for how.

### ⚠️ The tails face is the half that needed testing

This is the first heal-or-mill suite that takes a **seed sweep** (8 seeds per case,
collecting both faces, asserting both were seen so no pair passes vacuously). Three
states are distinguishable and all three are real:

1. **tails** — the branch never ran;
2. **heads with nothing to do** — it ran and whiffed (an undamaged attacker heals
   nothing, silently);
3. **skipped** — the sentence was never read.

Only (3) deserves a loud `ATTACK_EFFECT_SKIPPED`. **A tails is not a skipped effect**,
and **the coin is TAKEN on both faces** — `rngState` advances even when nothing
happens, because `coinFlipGate` flips first and splices second (interpreter.ts). A
build that checked the face before flipping would desynchronise the next coin in an
online match, which is invisible in a local suite that only asserts board deltas.

### ⚠️ A fixture HP trap — the attacker carries its damage BEFORE it declares

The slice's only three failures were all this. Fuecoco is **90 HP**; the first draft
used a 100-damage board (copied from the heal suites, where 100 sits on a 340 HP
fix-titan). A self-damage figure at or above the attacker's printed HP is a body the
attack epilogue sweeps off the board **mid-case**, so every later assertion is about a
promoted stranger — and it fails as `active?.damage === undefined` or as a stray
`ko:takePrizes` phase, neither of which reads like an HP problem.

**Own-board damage figures must be read against the FIXTURE's printed HP.** Every
other suite's figures land on the DEFENDER, which is always a 340 HP titan chosen
precisely so this never came up.

### Fixture / witness work this slice forced

- **Two new fixtures** — Fuecoco `sv02-035` (90 HP, Fire, Basic; "Spacing Out" idx 0,
  "Flare" {R}{C}/30 idx 1) and Wiglett `sv01-056` (60 HP, Water, Basic; "Dig a Little"
  idx 0, "Ram" {C}{C}/20 idx 1). Both controls print real damage and no effect text;
  Wiglett's is the sharper one, since "Ram" comes off the same Colorless line as the
  gated attack and only the INDEX tells them apart.
- **`FLIP_GATED_OP_DECK`** — dedicated for a mechanical reason, not a stylistic one:
  this family takes a coin, so sharing a deck with the seed-free heal/mill suites
  would make their determinism a coincidence rather than a property.
- **THREE witnesses re-pointed, none deleted**, and every one now makes a STRONGER
  claim than its null did:
  - `selfHeal.test.ts` — Fuecoco was its sharpest near-miss from 0.83.0. The claim
    was never "unmapped"; it was "THIS anchor does not reach it". It is now asserted
    as `[{ op: "coinFlipGate", then: deriveAttackEffect("Heal 30 damage from this
    Pokémon.") }]` — the gated program's branch is this anchor's own output, byte for
    byte.
  - `deckTopMill.test.ts` — same move for Wiglett: a SHAPE claim (the derived op is a
    gate, not a bare mill) instead of a null. A build where the bare body claimed the
    gated string would return the inner op **unwrapped**, which is what the assertion
    catches.
  - `boardHeal.test.ts` — Fuecoco is refused there for TWO reasons at once (wrong
    target, wrong anchor), so its row moved out of the null loop into a
    `not.toContainEqual({ op: "healEach" })`.

### The suite

`flipGatedOp.test.ts` — **24 tests**, every end-to-end case a seed sweep over
`[1..8]`. Full `bun run check` green exit 0, **177 files / 2831 tests** (was 176 /
2805).

### Still unmapped after D134 — ranked by cost

The heal census stays CLOSED (D133); the gated census above is now the live map.

- **`Heal {N} damage from 1 of your Pokémon.` — 5 printings / 3 clauses.** Nacli
  `sv02-121`/`-220` (20), Vespiquen ex `sv03-096`/`-212` (60), Smoliv `sv01-021` (30).
  `healChosen { amount }` exists (Potion) but **PARKS on a choice**, so this would be
  the first parking op the *attack* deriver emits — check how D125's tail placement
  interacts with a park before pricing it. Warrant met. **This is now the top of the
  list**, and it is the one that opens a real mechanism question rather than adding a
  reader.
- **The BENCHED-only heal variants — 4 printings / 4 clauses**, needing a zone filter
  `healChosen` does not have. Tropius `sv01-007` (60), Chansey `swsh10.5-051` (30),
  Combee `sv03-008` (20); Blissey `swsh10.5-052` + Arboliva `sv03-021` print "all"
  (`healChosen` already takes `amount: "all"`, so that half is free). Honour the
  printed zone word (D120). Best taken *with* the chosen-heal above — the park
  question is the same one twice.
- **The gated PREVENT clause — 13 printings / 2 spellings**, and the biggest single
  un-taken count in the gated census. "…during your opponent's next turn, prevent all
  damage from and effects of attacks done to this Pokémon." It is a §11 block with a
  DURATION, not an instant action, so the cost is a continuous-effect mechanism rather
  than a reader — a genuinely different slice from this one, and the reason it is
  listed here rather than taken.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132/D133: a channel from the
  §8.5 pipeline's RESULT into a tail op, structurally identical to Camerupt
  `sv03-032`. Do it last or not at all, and do it *with* Camerupt.

## D135 — the CHOSEN HEAL: `Heal {N|all} damage from 1 of your [Benched] Pokémon.` (engine 0.86.0)

The heal family's third and last printed shape now SIMULATES on **ONE anchored regex,
ONE `deriveAttackEffect` arm and ONE NEW FIELD** — **10 printings across 7 distinct
clauses**, the family's largest single mapping. Taken as the top item of D134's
remainder list, which had ranked it first *and priced it wrong* (see below).

After this slice, every `Heal …` sentence the pool prints as an attack has a reader
except two: Iron Moth `sv06.5-009`'s damage-echo and Floette `sv01-092`'s compound
gate. **The heal neighbourhood is closed.**

### The census (local D1, 2026-08-01, whole effect string, 978 cards)

`json_extract(attacks_json, '$[*].effect') LIKE '%Heal%'` over `json_each`, read in
full rather than sampled. Ten printings match this sentence, and **not one of them
carries a printed `damage` field** — the heal is the entire visible result every time,
which is why this slice needed no D125 tail-order reasoning at all.

| Clause | Printings | Cards |
|---|---|---|
| `Heal 20 damage from 1 of your Pokémon.` | 2 | Nacli `sv02-121`/`-220` "Salt Coating" |
| `Heal 30 damage from 1 of your Pokémon.` | 1 | Smoliv `sv01-021` "Nutrients" |
| `Heal 60 damage from 1 of your Pokémon.` | 2 | Vespiquen ex `sv03-096`/`-212` "Healing Pheromone" |
| `Heal 20 damage from 1 of your Benched Pokémon.` | 1 | Combee `sv03-008` "Share" |
| `Heal 30 damage from 1 of your Benched Pokémon.` | 1 | Chansey `swsh10.5-051` "Delicious Egg" |
| `Heal 60 damage from 1 of your Benched Pokémon.` | 1 | Tropius `sv01-007` "Fresh-Picked Fruit" |
| `Heal all damage from 1 of your Benched Pokémon.` | 2 | Blissey `swsh10.5-052` "Enriching Egg", Arboliva `sv03-021` "Healing Fruit" |

**A correction to D134's remainder list**, which had the Bench half at *4 printings /
4 clauses*: it is **5 / 4**. Arboliva `sv03-021` prints the "all" clause as its
**attack** ("Healing Fruit"), and it had no registry row.

**⚠️ AND THE `ARBOLIVA` REGISTRY ROW IS A DIFFERENT CARD, NOT A DIFFERENT PRINTING.**
This was mis-stated while authoring and corrected against the D1: that row is keyed
**`sv01-023`** — a 150 HP Arboliva from another set, whose only attack is "Solar Beam"
and whose `onEvolve` Ability "Enriching Oil" heals "1 of your Pokémon" with **no zone
word**. The printing mapped here is **`sv03-021`**, 140 HP, with **no Ability at all**.
So `programFor("sv03-021")` is undefined *entirely*, and `sv01-023`'s row is untouched.
**Two cards, one name.** The lesson is small and general: a shared card NAME is not a
shared card — key every registry claim by id and check it, because the wrong reading
here would have had a registry row shadowing a deriver that in fact never meets it.

### ⚠️ The mechanism question this slice was priced on does not exist

D132, D133 and D134 each carried this item forward with the same note: *"`healChosen`
exists but PARKS on a choice, so this would be **the first parking op the ATTACK
deriver emits** — check how D125's tail placement interacts with a park before pricing
it."* That note made it the expensive item on three consecutive lists.

**It is false, and had been for many slices.** `damageChosen` (the derived snipes) and
`discardEnergy` (the derived self-discard cost) already park from an attack tail. The
tail runs through the *same* `runProgram` + `settleProgram` a Trainer does, differing
only by `{ resumeTail: true }`; a park writes an `effect:choose` phase, emits
`EFFECT_PENDING`, and **leaves `attackEpilogue` on `state.pending`** — so the KO sweep,
the prizes and §5.3's turn end all wait for the choice and then run in printed order.
**ZERO `attack.ts` / `flow.ts` / `cardplay.ts` diff.**

**THE GENERALISATION IS ABOUT THE NOTE, NOT THE CODE: A FORECAST OF COST IS NOT A
MEASUREMENT OF IT.** The note was written by a slice that never looked, was copied
forward verbatim three times, and gained authority from repetition alone. Checking it
took one read of `attack.ts`'s tail. **Verify a forecast before you let it re-rank a
list** — a wrong one is worse than no estimate, because it *moves* work rather than
merely leaving it unsized.

### ⚠️ The only new vocabulary is `healChosen.zone?: "bench"`

The printed word "Benched" and nothing else (D120). Absent — the unmarked printing —
the candidates are ALL the controller's Pokémon, Active included, because §1.1 says the
Active is one of your Pokémon. Present, the Active is dropped. That is the entire
content of the word.

**A FIELD, NOT A SECOND OP MEMBER** (D131's widen-don't-add rule, applied to the op
that already carries `upTo` the same way): everything downstream of picking the
candidate set is byte-identical — same park, same choice shape, same heal, same
`HEALED` event. The interpreter diff is **one ternary** over `ownBenchRefs`, a helper
`switchActive` and `gust` have used since 0.x.

**The zone is applied to BOTH arms from one place**, including `upTo`, which no
printing combines with it today. A field that silently meant nothing on one arm is a
trap for the first author who combines them; and `healUpToNote` takes the zone word for
the same reason — a heading that disagreed with its candidates would lie about what it
is offering. (`healUpToNote`'s existing callers pass `""`, so Saguaro's heading is
byte-identical.)

### ⚠️ One regex, two captures, one op — and why that is not a D120 template

`/^Heal (\d+|all) damage from 1 of your (Benched )?Pokémon\.$/`. Both varying tokens
land in **fields of a single op** (`amount`, `zone`) rather than rows of a lookup
table, so D119 does not govern — that is D131's `discardDeckTop { whose, count }` shape
exactly. And it is **not** a D120 template, because a template needs a varying token
with a CLOSED reading *and a table to look it up in*; here there is no table, and
`Benched ` is a one-bit presence.

**"all" is a spelling of the amount, not a separate sentence.** `healChosen.amount` has
taken `number | "all"` since 0.x, so the two Blissey/Arboliva printings cost one
alternation branch and nothing else.

**The cross product is deliberately UNFILTERED.** `Heal all damage from 1 of your
Pokémon.` is unprinted today and this anchor accepts it — the same call D131 made for
the unprinted "the top 1 cards". It is unambiguous and the op expresses it exactly; a
refusal would be a claim about the *ingest*, not about the game.

### ⚠️ An empty Bench is a WHIFF, not a SKIP

`parkOrForce` has three endings and every one of them is reachable from these ten
printings:

1. **zero candidates** — resolves SILENTLY, no prompt, no event (a lone-Active Tropius:
   there is nobody benched to heal);
2. **exactly one** — applied INLINE, no prompt at all (the M1 no-choice doctrine);
3. **two or more** — parks on a `choosePokemon`.

None of the three emits `ATTACK_EFFECT_SKIPPED`, and that is not an accident of the
code: `attack.ts`'s `effectSimulated` is `program !== null || …`, so a derived program
means the sentence WAS read whatever it then did. This is D134's three-state
distinction on a different axis — **read-and-whiffed is not unread** — and the
empty-Bench case is the one a build that treated "no candidates" as a parse failure
would get wrong.

### ⚠️ The witnesses this slice re-pointed

`selfHeal.test.ts` and `boardHeal.test.ts` each listed all three chosen-heal clauses as
"stays LOUD" near-misses. All three are now mapped, so per the standing note they were
**re-pointed, never deleted**, and each now makes a stronger claim than its null did:
`not.toContainEqual({ op: "heal" })` / `not.toContainEqual({ op: "healEach" })` plus a
positive assertion of the `healChosen` shape the neighbouring anchor must NOT produce.

**Five of `selfHeal`'s seven near-misses now land on a neighbouring anchor** — which is
what a family being finished looks like from the inside. The suite's claim needs a live
unmapped witness to keep being about anything, so **Floette `sv01-092` "Magical Leaf"
was ADDED**: *"Flip a coin. If heads, this attack does 30 more damage, and heal 30
damage from this Pokémon."* — this anchor's exact action, lowercase, at the tail of a
gated sentence that also carries a pre-damage bonus the same op cannot ride. Genuinely
unmapped, and the sharpest live guard on `^` the file has left.

### The suite

`chosenHeal.test.ts` — **25 tests**, seed-free (this family takes no coin, pinned by an
unchanged `rngState` across a whole resolution). Full `bun run check` green exit 0,
**178 files / 2857 tests** (was 177 / 2831).

Derivation: all seven clauses table-driven; the `zone` key asserted **ABSENT** rather
than `undefined` on the any-zone derivations (an explicit-undefined key is not
`toEqual`-identical to an absent one against a hand-authored registry row); op identity
against Potion's authored `{ op: "healChosen", amount: 30 }`; zero registry rows for all
eight cards (Arboliva keeps its `triggered` Ability row); whitespace tolerance and an
NBSP case spelled as an escape; the mid-sentence refusals (Saguaro, Floette) and the
neighbouring-anchor shape claims.

End to end: all three `parkOrForce` endings, a **damaged Active excluded** from a
bench-only `prompt.candidates`, the `resumeTail` park→`resolveEffect`→epilogue round
trip with `TURN_ENDED` strictly after `HEALED`, the per-target clamp, the silent whiff,
and the illegal-choice rejection.

Fixtures: Nacli `sv02-121` (70 HP Fighting Basic — "Salt Coating" idx 0, "Tackle"
`{F}{F}`/30 idx 1), Tropius `sv01-007` (100 HP Grass Basic — "Fresh-Picked Fruit" idx 0,
"Razor Leaf" `{G}{C}`/50 idx 1) and **`fix-allheal`**, an INVENTED Basic carrying
Blissey/Arboliva's real "all" sentence — invented because both real printings are
evolutions and an evolution chain is not what that case is about. Own deck
(`CHOSEN_HEAL_DECK`), per the house convention.

Two traps that did not bite because they were carried forward: `setActiveFromDeck`
**displaces** the Active it replaces onto the Bench (use `clearBench` — D133), and
own-board damage figures must be read against the FIXTURE's printed HP rather than
copied from the heal suites' 340 HP defender boards (D134).

### Still unmapped after D135 — ranked by cost

The heal census is CLOSED (D133, extended by D135); the gated census in the D134
section above is still the live map for anything in the "Flip a coin. If heads, …"
neighbourhood — do not re-run it.

- **`Move all damage counters from 1 of your Benched Pokémon to your opponent's Active
  Pokémon.` — 2 printings**, Dedenne ex `sv02-093`/`-239` "Dedechange". Found while
  censusing this slice. D121's warrant met. **The CHOICE half is now free** —
  `healChosen`'s bench-filtered park is exactly this candidate set — but the move half
  is new: it is a heal on your side AND a counter placement on theirs, in one op, and
  the amount is "however many were there". Read D135's zone field before pricing it.
- **The gated PREVENT clause — 13 printings / 2 spellings**, still the biggest single
  un-taken count in the gated census. "…during your opponent's next turn, prevent all
  damage from and effects of attacks done to this Pokémon." A §11 block with a
  DURATION, so the cost is a CONTINUOUS-EFFECT mechanism rather than a reader.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132/D133/D134: a channel from
  the §8.5 pipeline's RESULT into a tail op, structurally identical to Camerupt
  `sv03-032`. Do it last or not at all, and do it *with* Camerupt.

## D136 — the FIRST code review of D96–D135 (engine unchanged, 0.86.0)

Not a slice. `/code-review` over `git diff origin/backend...HEAD` — **25 commits, 50
files, ~33k lines, D112–D135** — the first review this branch has had since D96, run at
the user's trigger. It is **user-triggered**: no session can launch it, which is why all
24 autoloop sessions ended by flagging it and none could clear it.

**Three findings: one medium, two low. Nothing structural.**

### What the review CLEARED — the more informative half

Chased and came back clean, so a future slice can stop re-deriving these:

- the retreat-block lifetime in `runCheckup` (the `endedSeat`-only paralysis clear gives
  the printed duration on **all four** turn orderings, D112);
- all three bench→Active routes stamping `promotedTurn`, with no stale-flag path —
  `clearOnLeavingActive`, `switchInto` and `placeEvolution` are the only three
  `noConditions()` sites and all clear `retreatBlocked` (D124);
- `gust` / `switchOwn` both routing through `switchInto`;
- the deliberately-inverted polarity of `ATTACK_REQUIREMENT_CLAUSES` against the
  `!conditionHolds` gate (D125) — documented and correct;
- the `phaseViewOf` import in `interpreter.ts`: **no runtime cycle**, `phaseView.ts`
  imports the interpreter type-only (D123);
- disjointness of the four effect-text readers;
- `MATCH_RECORD_VERSION = 2` correctly retiring pre-`promotedTurn` records.

It also **re-derived D129's termination argument independently**, scanning the full 2³²
mulberry32 cycle: the longest run of consecutive heads is **31**, so
`MAX_UNTIL_TAILS_FLIPS = 64` is genuinely unreachable. D129's claim now has a second,
outside measurement behind it.

### ⚠️ Finding 1 (medium) — the mill log row credited the VICTIM

`DECK_TOP_DISCARDED` is filed under `event.seat` = **the deck's OWNER**, which is correct
and deliberate (D131 leaned on it so one op could emit on both seats with no log diff).
But the message read in the **active voice**, and every row in `log.ts` renders after its
seat's name — so P1 attacking with Chi-Yu ex produced:

> **P2** discarded 2 cards from the top of their deck

crediting the milling to the player who *lost* the cards.

**D130 saw half of this and fixed the wrong half.** Its doc block says the line "was a
lie the moment it had a second producer", drops the false word "looked-at", and calls the
result provenance-neutral. That is a true fix to a different problem: **neutral wording
addresses PROVENANCE; the VOICE is what carries the ACTOR.** Necessary, not sufficient.

Fixed by making the verb **passive** — `had {n} cards discarded from the top of their
deck` — with the seat untouched. Passive over `ENERGY_DISCARDED`'s separate `actor` field
(the file's other solution to exactly this shape) because it costs no event field and
this row never names the actor anyway: the producing `ATTACK_DECLARED` /
`ABILITY_TRIGGERED` row sits directly above it. Hydreigon's own-deck Tri Howl row also
reads passive now, which is mildly stilted for a self-discard and is the right trade —
the alternative is **wrong** on the mill.

### ⚠️ Finding 2 (low) — three regexes missed the `['’]` class, and two suites had pinned that gap as INTENDED

`ATTACK_COIN_MILL_PRINTED`, `ATTACK_COIN_MILL_UNTIL_TAILS` (D130) and
`OPPONENT_ACTIVE_TYPE_CLAUSE` (D120) spelled `opponent's` with a straight-only
apostrophe, while every sibling regex reading the **same noun phrase** — `DECK_TOP_MILL`,
`FLIP_DECK_TOP_MILL`, `DEFENDER_NOW` — carries `['’]`, a class `effects.ts` documents as
existing precisely *"so a re-ingest changing only punctuation cannot silently un-derive"*
the sentence.

**The ASYMMETRY is the defect, not the spelling.** A catalog re-ingest normalising to
U+2019 would leave D131's unconditional mills deriving while D130's two dropped to the
loud-skip path — a regression that reads as "two cards broke", with the punctuation
nowhere in sight. Same noun phrase, same slice: it is one rule or it is nothing.

**And the tests asserted the bug.** Both suites named the hazard and then pinned the
wrong side of it:

- `perHeadsProgram.test.ts` listed both curly variants as near-misses that must be
  REFUSED, commenting that they "would silently drop both cards onto the loud path with
  no number to notice it by";
- `typeNameClause.test.ts` pinned Wonder Flash's BYTES and observed that a curly
  apostrophe "would silently un-map the clause".

Both strings moved out of the refusal lists into **positive assertions of equality with
the straight form** — not merely non-null, because the apostrophe carries no meaning and
the two spellings must yield the *same* member. The byte-pins **stay**: they say what the
catalog holds today, and the new tests say the reader does not depend on it. Pinning only
the first mistakes a property of the current ingest for a property of the engine.

### ⚠️ Finding 3 (low, latent) — the truncation guard had no reader, and closing it cost the engine's first `throw`

`rng.ts` returns **faces** rather than a count *"precisely so a caller can detect the
truncation"*, and no caller did: every consumer just tallies heads, so a truncated
all-heads sequence would quietly score **64 heads** — of damage on one printing, of mill
iterations on the other. That is the exact lie the constant's own docblock says the bound
exists to prevent, and it is silent.

The guard went in **`takeFlips`**, the single choke point for the `untilTails` arm
(covering both consumers and any future one), rather than at the flip site the review
named.

**This is the engine's only `throw`, and the engine is total by design** — there are zero
others in engine source. The exception is earned by there being **no honest value to
return**: a "flip until tails" that has not seen tails has no heads count, the sequence
is not over. Refusing the attack would invent game semantics the rules do not describe;
scoring the truncation would corrupt the match record. It is unreachable by construction
(31 < 64), so it cannot fire today — it fires only if someone replaces `nextU32` with
something degenerate, and a crash at the flip site is how they should find out rather
than through a match that paid 64 heads.

**Deliberately untested.** Driving it needs `vi.mock` on the RNG, which the engine suite
has never used and which breaks a stronger convention than the throw does; `rng.ts`'s own
truncation branch stays reachable through its `cap` parameter and is covered there.

### ⚠️ Not done — the literal clause-table keys have the same exposure

~8 rows of the literal clause table (`"your opponent's Active Pokémon is Poisoned"` and
its neighbours) are exact `Map` lookups with straight-only apostrophes, so the same
re-ingest drops them too. **A `Map` key cannot carry a character class**, so the fix is
not the one applied above — it is a normalisation pass at lookup (fold U+2019 → U+0027 on
the clause string before the table hit; the template pass is already covered). That is a
small design call rather than a patch, and it was left out rather than expanded into
silently. It is now **item 1 of the resume point**.

### The generalisation — and it is about the loop, not the code

**A test suite written by the same session that wrote the code inherits its blind spot.**
Both low findings are places where the author *saw* the hazard, *wrote it down*, and then
asserted the wrong side of it. The suites passed for 40 decisions because they encoded
the author's belief rather than the requirement — which is exactly the class of error a
fresh reader catches and an authoring session structurally cannot.

The operational consequence: **run `/code-review` on a cadence, not at the end.** It is
user-triggered, so a session cannot do it; what a session *can* do is state in its
handoff how many decisions have accrued since the last review. This one covered
D96–D135; anything from D136 on is again unreviewed.

### Verification

`bun run check` green, exit 0 — **178 files / 2859 tests** (was 178 / 2857: two new `it`
blocks, and two entries removed from near-miss loops that were never separate tests).
**Engine version UNCHANGED** — no behaviour a card can reach moved. No
`MATCH_RECORD_VERSION` bump, no web/API/DB/`@luminous/schema` diff.

## D137 — the APOSTROPHE FOLD: the literal clause-table half of D136's hardening (engine unchanged, 0.86.0)

D136's one deliberate leftover, and the cheapest item on its resume point. That review
gave three regexes the `['’]` class every sibling on the same noun phrase already
carried, and wrote down that the LITERAL clause tables have the identical exposure: a
catalog re-ingest normalising straight apostrophes to U+2019 would silently un-derive
them. It stopped there because **a `Map` key cannot carry a character class** — it is one
exact string of bytes or it is nothing — so the hardening had to move off the KEY and
onto the LOOKUP, which is a design call rather than a patch.

### The census — four tables, five call sites, SEVEN exposed rows

Run over every literal `Map`/`Record` lookup on printed text in `packages/engine/src`,
not just the two the resume point named (which estimated "~8 rows" and named symbols that
do not exist — `ATTACK_CONDITION_CLAUSES`/`conditionFor`; the real ones are below).
`conventions.md`'s rule applies to its own resume points: **verify a doc reference against
the code before relying on it.**

| Table | Rows | With an apostrophe | Read from |
|---|---|---|---|
| `CONDITIONAL_DAMAGE_CLAUSES` (D115+) | 19 | **5** | `boardConditionForClause` |
| `ATTACK_REQUIREMENT_CLAUSES` (D125) | 2 | **2 — the whole table** | `deriveAttackRequirement` |
| `CLAUSE_ENERGY_TOKENS` (D118) | 19 | 0 — closed vocabulary | `boardConditionForClause`, `deriveAttackCoinFlip` |
| `CLAUSE_POKEMON_TYPES` (D120) | 11 | 0 — closed vocabulary | `boardConditionForClause` |

The five conditional rows are the `your opponent's Active Pokémon …` family — "already
has any damage counters on it" (Gyarados ex `sv01-045`/`-225`), "is an Evolution Pokémon"
(Seviper `sv02-137`), "is Poisoned" (Seviper `sv01-128`), "is affected by a Special
Condition" (Sableye `sv02-136`), "is a Pokémon ex or Pokémon V" (Ceruledge `sv02-098`).
The requirement table is exposed on **both** rows and on **both grammatical uses the pool
prints**: a CONTRACTION (Palafin `sv03-062`/`-200`, "didn't") and a POSSESSIVE (Lycanroc
`sv03-117`).

The one exact lookup on printed text deliberately left outside the fold is
`deriveAttackEffect`'s `ENERGY_TYPE_BY_CODE` / `ENERGY_TYPE_BY_NAME` pair: they are
`Record`s rather than `Map`s and are indexed with a capture from `TYPED_SELF_DISCARD`, a
regex whose alternation **is** those two key sets — an apostrophe cannot reach them by
construction. Documented in place so the exception is not mistaken for an oversight.

### ⚠️ The census found TWO MORE straight-only regexes D136 had missed

`RETREAT_COST_SCALE` and `RETREAT_COST_MULTIPLY` spell *"your opponent's Active Pokémon's
Retreat Cost"* — Heracross `sv01-002`, Spidops ex `sv01-019`, Sharpedo `sv03-047`
(additive) and Stoutland `sv03-172` (multiply). They are **the pool's only sentence
carrying two possessives**, and D136 found neither: its search was for `opponent's`-shaped
siblings and these two matched the shape, so they read as already-handled. Both slots now
carry `['’]`; a fix that classed one and not the other would read exactly like a whole fix
until a re-ingest landed.

**The lesson: "find every X" is only as good as the QUERY, and a census run for one
purpose is the cheapest place to re-run the previous one's.** This slice was scoped to Map
keys and found regexes, because it looked at every apostrophe in the file rather than at
every table.

After D137 there are **no straight-only apostrophes left in any regex in `effects.ts`**,
and no exact lookup on printed text outside `literalClauseRow` except the one noted above.

### ⚠️ Where the fold lives, and why not at the clause split

`literalClauseRow(table, clause)` — a seven-line helper that takes the TABLE AS AN
ARGUMENT and is the single site every exact lookup on printed text goes through.

There is deliberately **no choke point above** the two lookup helpers, and that is not an
accident to route around: D125 made `boardConditionForClause` and `deriveAttackRequirement`
share no lookup, because a clause meaning *"the attack does 120 more damage if X"* must
never be reachable from a sentence meaning *"the attack does nothing if X"*. Two
consequents, two vocabularies, no crossover. Folding at "the clause split" would have
meant either one merged table (destroying that) or the same three lines copied into each
helper (which the next table added would have to remember).

Passing the table keeps both properties at once — **two vocabularies, one fold, written
once** — and it is the placement a THIRD consequent inherits for free. The two token maps
are routed through it as well although their closed, schema-derived vocabularies can never
hold an apostrophe: **the rule is the SITE, not the need** ("every exact lookup on printed
text", not "every one that needs it today"). That is exactly how a table added by a later
slice gets the hardening without anyone thinking about it, and it is the one thing a future
session must not undo: **a bare `.get()` on printed text is the regression.**

### ⚠️ A FALLBACK, not a normalisation pass

The clause AS PRINTED is tried first and always wins. Only on a MISS is U+2019 folded to
U+0027 and the table asked again, behind an `includes` guard that states the same thing in
code (a clause missing for any other reason misses exactly once and stays LOUD).

That ordering is the whole safety argument:

- it can turn a **miss into a hit** and can **never** turn a hit into a *different* hit, so
  no clause any row already owns is re-interpreted — the same property D118 bought by
  consulting literals before templates;
- a future row keyed with a curly apostrophe stays reachable by its own bytes rather than
  being shadowed by the fold.

### ⚠️ Apostrophe only — and the scope-out is part of the decision

No lowercasing, no trimming beyond what the readers already do, and no Unicode
normalisation of the é in `Pokémon`. The tables commit to a real U+00E9 and to a matcher
with no `/i`, and both commitments are load-bearing: `Poisoned`, `Special Condition`,
`Benched`, `Active` and `Evolution` are capitalised as printed and told from ordinary words
by nothing else.

A wider fold would owe a **row-by-row argument that no two distinct printed clauses COLLIDE
under it**, and nobody has made one. The apostrophe needs no such survey: U+2019 and U+0027
are the same punctuation mark in two encodings, and no printed clause in the pool is
distinguished from another by which one it uses. `clauseApostrophe.test.ts`'s negative
block exists to stop a later session "improving" this into a general normaliser — widening
it is a separate decision, not a tidy-up.

### ⚠️ The template/regex pass is deliberately NOT routed through the fold

Every anchored pattern carries `['’]` in its own source and matches the RAW clause.
Folding before them would be harmless but redundant; folding *instead* of the class would
move a documented, greppable property of each regex into a caller the regex cannot see.
**Two mechanisms, one per pass, each visible at the site where it applies.** The suite pins
the separation, so a session that deletes a class on the grounds that "the fold handles it"
goes red rather than shipping.

What reaches `literalClauseRow` out of a template is the CAPTURE — an energy token, a type
name — which is why the token maps are routed through it even though they need nothing.

### The pool claim, re-verified

`effects.ts` asserts in two doc blocks that the pool holds zero U+2019. Re-checked against
the local D1 (`apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`, 978
cards):

- `effect`, `attacks_json`, `abilities_json`, `name` — **0 rows containing U+2019**;
- `attacks_json` — **359 rows containing U+0027**.

So the claim holds and the KEYS stay ASCII on purpose: they record what the catalog prints,
not what the lookup will tolerate. Re-verify this cheaply rather than re-deriving it.

### The suite — `clauseApostrophe.test.ts` (13 tests)

Reader-level on purpose: the fold is a property of five pure functions, and every row it
protects is already driven end-to-end by the slice suite that bought it. Re-driving a match
here would re-assert those slices, not this one.

**The census is DISCOVERED, not listed**, and that is the shape worth copying. The suite
sweeps `FIXTURE_POOL` for every distinct printed effect carrying an apostrophe that ANY of
the five readers resolves (**32 sentences at D137**, pinned), rewrites each to U+2019 and
asserts **equality with the straight form on all five readers** — D136's shape, never
merely "the curly one is non-null", because a non-null check passes on a reader that folded
the clause into some other row. A row, regex or template added by a later slice is therefore
swept the day its FIXTURE lands rather than the day somebody remembers this file. **The
pinned 32 moves with the fixtures**: a slice adding an apostrophe-bearing printing has to
look here once and confirm the new sentence folds. That is the point, not a chore.

On top of the sweep: the seven literal rows listed explicitly and asserted individually;
the two consequents' disjointness re-asserted **in the curly spelling** (a fold written as
one merged table instead of one function taking a table would have quietly joined them);
three apostrophe-free rows asserted unchanged; the scope guards (é not folded, case not
folded, inner whitespace not collapsed, an unmapped clause still LOUD in both spellings);
and the template pass asserted still reading through its own class.

Mutation-checked both ways: disabling the retry fails **3** tests, reverting the
retreat-cost class fails **2**.

### Verification

`bun run check` green, exit 0 — **179 files / 2872 tests** (was 178 / 2859).
**Engine version UNCHANGED and no `MATCH_RECORD_VERSION` bump** — no behaviour a card in
today's catalog can reach moved, because today's catalog has no U+2019 to fold. This is a
property of the READER, bought against an ingest that has not happened yet, which is
exactly the case where a version bump would be noise. No web/API/DB/`@luminous/schema`
diff; no interpreter, `attack.ts`, `rng.ts` or `continuous.ts` diff.

Cost: **1 helper (7 lines) + 2 constants, 5 call sites re-pointed, 2 regexes classed, 3
doc blocks amended, 1 new test file.**

## D138 — the COUNTER MOVE: `Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.` (engine 0.87.0)

The first derived attack op that touches **both boards in one action**. **2 printings
/ 1 clause** — Dedenne ex `sv02-093`/`-239` **"Tail Swap"** ({P}{P}, attack index 0) —
now SIMULATE on **ONE anchored regex with NO CAPTURE, ONE `deriveAttackEffect` arm and
ONE NEW `EffectOp` MEMBER WITH NO FIELDS**. Neither printing carries a `damage` field,
so the move (and the park in front of it) is the entire visible result of the
declaration. Taken as the top item of D135's remainder list, which D137 carried forward
verbatim.

### ⚠️ The resume point's three claims, checked before anything was designed

D135's own lesson, applied to D135's own note. Two held and one did not:

| Claim | Verdict |
|---|---|
| "The CHOICE half is free — `healChosen`'s bench-filtered park is exactly this candidate set" | **TRUE, exactly.** `ownBenchRefs` through `parkOrForce` is byte-for-byte D135's `zone: "bench"` candidate set. The park, its three endings and the illegal-pick refusal all cost nothing. |
| "The move half is new" | **TRUE.** No op in the union moves a counter — `damageActive` PLACES on the defender, `healChosen` REMOVES on your side, and nothing did both. |
| "Dedenne ex … **Dedechange**" | **FALSE.** The attack is **"Tail Swap"**, and the local D1 prints no attack named "Dedechange" anywhere in its 978 cards. |

The wrong name rode **three consecutive remainder lists** unchecked, exactly as D135's
cost forecast did and exactly as D137's resume point named two symbols that do not
exist. It never reaches the engine — the reader keys on the EFFECT, not the name —
which is precisely why nothing would ever have caught it. **A doc reference gains
authority from repetition alone, and checking one costs a single query**
(`conventions.md`'s own rule, third slice running). Pinned in the suite as
`expect(tailSwap?.name).not.toBe("Dedechange")`.

### The census (local D1, 2026-08-02, whole effect string, 978 cards)

`json_extract(attacks_json, '$[*].effect') LIKE '%damage counter%'` over `json_each`,
read in full, then the same sweep over `abilities_json` and the trainer `effect` column
for the neighbourhood.

| Slice of the census | Printings | Distinct clauses |
|---|---|---|
| Attack effects containing "damage counter" | **56** | **31** |
| …of those, ones that MOVE rather than PUT | **2** | **1** |
| The whole counter-MOVE neighbourhood (attacks + Abilities) | **4** | **3** |

The one mapped clause and its two live neighbours:

| Clause | Printings | Card / where |
|---|---|---|
| `Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.` | **2** | Dedenne ex `sv02-093` (Double rare) / `sv02-239` (Ultra Rare) "Tail Swap" — ATTACK |
| `…you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.` | 1 | Munkidori `sv06.5-072` "Adrena-Brain" — ABILITY |
| `…you may move 1 damage counter from 1 of your other Pokémon to this Pokémon.` | 1 | Slowbro `sv01-043` "Strange Behavior" — ABILITY |

The two neighbours differ from the mapped anchor on **three axes at once** — a bounded
amount ("up to 3" / "1"), a source zone that includes the Active, and a destination that
is either CHOSEN or is your own side — and both are ABILITIES, which reach a different
reader entirely. That is the whole argument for a field-less op.

Also censused and refused, because they share the destination noun phrase and PUT
counters rather than moving them: Mimikyu `sv02-097` and Polteageist `sv03-098` ("Put
{7|5} damage counters on your opponent's Active Pokémon."), Alolan Raticate
`swsh10.5-042` and Claydol `sv03-095` ("…until its remaining HP is 10."), Drifblim
`sv01-090` ("in any way you like") and Ting-Lu ex `sv02-127` (the opponent's Bench —
the one on the list the engine already reads, as a `damageChosen` snipe).

### ⚠️ A new op member, with D131's widen-don't-add rule APPLIED AND FAILING

`{ op: "moveCountersToDefender" }` — no fields.

D131's rule licenses a FIELD when everything downstream of picking the candidate set is
byte-identical. Here **the pick is the only thing the two share**: this op emits a
SECOND event, on the OTHER seat's board, which can end the game. An op named `heal` that
placed damage would be the misnaming D128's provenance rule exists to prevent. So the
rule was applied and it FAILED, which is a different thing from not consulting it.

**And it takes no fields at all** (D104's minimal shape, with D130's
`discardOpponentDeckTop` as the precedent for putting the direction in the NAME). Every
token that varies among the neighbouring sentences is FIXED in this one — the amount is
the printed word "all", the source zone is the printed word "Benched", the destination
is spelled out — so there is no capture in the regex and nothing for a field to carry.
Fielding `amount` / `from` / `to` now would be a **three-axis guess made from one
printing**.

**THE CONDITION THAT WARRANTS THE WIDENING IS WRITTEN DOWN** (D131's rule — when you
decline a widening, record what would earn it): a second **ATTACK** printing of a counter
move, at which point the two readings are in hand and this op gains the field they
actually differ on, exactly as D131 turned `discardOpponentDeckTop` into
`discardDeckTop { whose, count }`.

### ⚠️ The two rows carry ONE number, and that equality is the word "move"

`HEALED` for what came off the Bench — the body lands at exactly 0, since the printed
word is "all" — and `COUNTERS_PLACED` for what went on, in the printed "from … to …"
order. That order is also the only one that reads correctly in a log, because the second
row is the one that can Knock the defender Out.

A build that healed one amount and placed another produces **both rows** and the wrong
game, which no single-row assertion catches. Every end-to-end case asserts the pair.

**THE PLACEMENT IS FLAT — `damageActive`'s rule verbatim.** A moved counter is not
attack damage, so §8.5's Weakness and the `damageReductionAfterWR` passive both skip it.
Driven against a **×2 Psychic** defender under a **Psychic** attacker: **80, not 160**,
and **no `DAMAGE_DEALT` row at all** (the event type is as much the claim as the number
is — `DAMAGE_DEALT` carries `weakness`/`resistance` fields precisely because it went
through the pipeline).

### ⚠️ `COUNTERS_PLACED.source` grew a sixth member, `"moved"` — D136's finding 1, refused at the source

Reusing `"ability"` was the cheap option and it was wrong twice over. That event's `seat`
OWNS the damaged Pokémon, which here is the attacker's **opponent**, and log rows render
after their seat's name; and the existing arm prints the literal word **Ability** on an
**attack**. So the new member gets a **SYSTEM** row ("Moved: 80 damage onto …"), and the
suite asserts the pair renders as controller-voice removal + system placement carrying
the same number, with the removal row FIRST.

The enum widening is a **widening, not a shape change** — the `ATTACK_FAILED.reason`
precedent stated in `events.ts` itself — so **no `MATCH_RECORD_VERSION` bump**. The same
goes for the new `EffectOp` member: D130 added a whole op and did not bump either.

`HEALED`'s doc block was also corrected in passing — it said "`seat`'s **Active**", which
has been wrong since D133/D135 taught `healEach` and `healChosen` to reach the Bench.

### ⚠️ The KO pipeline was verified rather than assumed, from BOTH endings

The op only RAISES damage. The sweep that catches the Knock Out is the attack EPILOGUE's
two-seat one (`flow.ts finishAttack`), reading the POST-effect board — after a park just
as much as inline, because `settleProgram(..., { resumeTail: true })` keeps
`attackEpilogue` on `state.pending` until the choice lands (D135).

Both endings are driven end to end and produce the same event order:

`HEALED` → `COUNTERS_PLACED` → `KNOCKED_OUT` → `PRIZES_OWED` **to the ATTACKER**

…and the resolution stops at `{ kind: "ko:takePrizes", seat: "p1", count: 1 }` with **no
`TURN_ENDED` yet**: which prize card is a decision, and the opponent's promotion is
behind it, both still in front of §5.3's tail. A build that only wired the sweep into the
resumed path passes the parked case and loses every forced KO, which is why the forced
one is driven separately.

### ⚠️ An empty Bench is a WHIFF and so is a clean pick — neither is a SKIP

D135's ending, one slice on, and all three of `parkOrForce`'s endings mean here what they
mean there:

1. **zero candidates** (a lone-Active Dedenne ex) — resolves SILENTLY, no prompt, no
   event, and **the defender is untouched**: an empty Bench must not be read as "move
   nothing, but place something anyway";
2. **exactly one** — applied INLINE, both halves in one action;
3. **two or more** — parks on a `choosePokemon`.

The candidates are **every benched body, damaged or not**: the printed sentence carries
no damaged restriction, so filtering would be a rule the card does not print (the Potion
doctrine `healChosen` follows for the same reason). An undamaged pick moves nothing and
announces **neither** row — a `COUNTERS_PLACED` of 0 would read as a hit. No
`ATTACK_EFFECT_SKIPPED` fires on any of it, because a derived program means the sentence
WAS read.

A missing DEFENDER moves nothing at all — half a move would launder counters off the
controller's board — and is unreachable from a §8 attack (the attack gate guarantees a
Defending Pokémon). Written down because a total helper must still answer it.

### Witnesses

**Nothing needed re-pointing.** No suite had ever listed this sentence as a stays-LOUD
near-miss, so nothing was deleted and no file was left without a live witness. The new
suite's six near-misses are all still-live catalog rows (the two counter-move Abilities
plus four PUT sentences).

`clauseApostrophe.test.ts`'s DISCOVERED census moved **32 → 33** the moment the Dedenne ex
fixture landed, because "your opponent's Active Pokémon" carries an apostrophe and the
sweep reads `FIXTURE_POOL`. That is the D137 design working, not a chore.

### The suite — `counterMove.test.ts` (21 tests)

Seed-free: this sentence takes no coin, pinned by an unchanged `rngState` across a whole
park-and-resolve. Full `bun run check` green exit 0, **180 files / 2893 tests** (was
179 / 2872).

Derivation: the one clause to the field-less op, with `Object.keys(op)` asserted to be
exactly `["op"]`; the disjointness from `healChosen` in BOTH directions; the six real
near-misses; fourteen anchor/punctuation/case/token rewrites including the two that
would silently invent a reading (a numeric amount, and the dropped word "Benched"); the
curly-apostrophe EQUALITY.

Fixtures: **Dedenne ex `sv02-093`** (170 HP Psychic Basic, retreat 1, ×2 Metal, no
Ability) — and its **index-1 "Wondrous Shot"** ({P}{P}{P}, 170, "Discard an Energy from
this Pokémon.") is a sharper control than the family's usual effect-less second attack,
because its sentence is read by a DIFFERENT arm of the SAME deriver: one card, two
attacks, two ops, asserted. Plus a synthetic **`fix-psychic-weak-big`** (200 HP, ×2
Psychic, no attacks) for the flat-placement claim. Own deck (`COUNTER_MOVE_DECK`), per
the house convention.

End to end: the park (candidates BENCH-ONLY with the two-Energy attacker excluded, the
prompt heading, nothing moved on EITHER board, `attackEpilogue` still queued); the move
itself with the two amounts asserted EQUAL; the forced single-candidate ending; the empty
Bench; the undamaged pick; five illegal picks; the rngState pin; the JSON round trip; the
flat placement; the same declaration driven **from p2** so both `seat` fields are claims
rather than coincidences; both KO endings; and the log pair.

Mutation-checked three ways: not zeroing the source fails **4** tests, reusing
`source: "ability"` fails **5**, ignoring the printed word "Benched" fails **8**.

### Still unmapped after D138 — ranked by cost

The heal census is CLOSED (D133/D135), the counter-move neighbourhood is now closed for
ATTACKS (this section's table is its map — do not re-run it), and the gated census in the
D134 section is still the live map for the "Flip a coin. If heads, …" neighbourhood.

- **The gated PREVENT clause — 13 printings / 2 spellings**, still the biggest single
  un-taken count in the gated census. "…during your opponent's next turn, prevent all
  damage from and effects of attacks done to this Pokémon." A §11 block with a DURATION,
  so the cost is a CONTINUOUS-EFFECT mechanism rather than a reader.
- **`Put {N} damage counters on your opponent's Active Pokémon.` — 2 printings / 2
  clauses**, Mimikyu `sv02-097` "Ghost Eye" (7) and Polteageist `sv03-098` "Pour Tea" (5).
  **Turned up by THIS slice's census, and it is the cheapest thing left.** `damageActive`
  has shipped since 0.x behind Trevenant's between-turns Ability and is the exact op —
  D132's inventory rule again, a reader and one capture, with the flat-placement reading
  already pinned by this slice. NEITHER carries a printed `damage` field (checked, not
  assumed — the placement is the whole visible result), so there is no D125 tail-order
  question either.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132–D135: a channel from the
  §8.5 pipeline's RESULT into a tail op, structurally identical to Camerupt `sv03-032`.
  Do it last or not at all, and do it *with* Camerupt.

## D139 — the PUT on the defender: `Put {N} damage counters on your opponent's Active Pokémon.` (engine 0.88.0)

**2 printings / 2 distinct clauses** — Mimikyu `sv02-097` **"Ghost Eye"** ({P}{C}, **7**
counters, attack index **0**) and Polteageist `sv03-098` **"Pour Tea"** ({P}, **5**
counters, attack index **1**) — now SIMULATE on **ONE anchored regex with ONE `(\d+)`
capture and ONE `deriveAttackEffect` arm**. Two DIFFERENT cards from two sets, which is
the stronger form of D121's second-printing warrant than D138's one-card-two-rarities.
Neither carries a printed `damage` field, so the placement is the entire visible result
of the declaration and there is no D125 tail-order question. Taken as the top item of
D138's remainder list, which D138's own census had turned up.

### The resume point's claims, checked before anything was designed

Every catalog claim held; the one structural claim did not.

| Claim | Verdict |
|---|---|
| Card ids `sv02-097` / `sv03-098` | **TRUE.** |
| Attack names "Ghost Eye" / "Pour Tea" | **TRUE** (the D138 correction did not need making twice). |
| Amounts 7 / 5 and costs {P}{C} / {P} | **TRUE**, all four. |
| "Neither printing carries a printed `damage` field" | **TRUE** of both — re-verified rather than trusting the date on it. |
| "`damageActive` is the EXACT op, `amount` is HP, `{N}` counters is `N * 10`" | **TRUE**, and pinned so a factor of ten in either direction fails. |
| "…so the whole slice is one regex and one arm, **with no interpreter diff**" | **FALSE.** See below — the op's PROVENANCE moved even though its ACTION did not. |

Also newly checked and worth recording: **Pour Tea is at attack INDEX 1**, not 0. That
is the kind of detail a remainder list carries wrongly, and it would have failed
silently by simulating "Antique Collecting" instead.

### ⚠️ "No interpreter diff" was false, and finding out why is the slice

`damageActive { amount }` really had shipped since 0.x behind Trevenant `sv03-012`'s
between-turns "Forest Miasma", and really is the exact op — **D132's inventory rule for
the fourth time**: no new op, no new mechanism, no new park, and zero
`attack.ts`/`flow.ts`/`continuous.ts`/`rng.ts` diff.

But it **hardcoded `COUNTERS_PLACED` source `"ability"`**. That was true while it had
exactly one producer and becomes a **lie on an attack**:

- the event's `seat` OWNS the DAMAGED Pokémon — for an attack, the attacker's OPPONENT —
  and log rows render after their seat's name;
- the `"ability"` log arm prints the literal word **Ability**.

This is **D136's finding 1**, and **D138 already refused it once** for the counter MOVE
and wrote the obligation into its carried-forward notes: *any future producer on the
opponent's board owes the same question*. This slice is that producer, and it inherited
the refusal rather than re-deriving it. **That is what a written-down obligation is for**
— the same shape as D130 declining a widening and naming the condition that would earn
it, which D131 then executed verbatim.

### ⚠️ `source` is a FIELD — D131's widen-don't-add rule applied and PASSING

`{ op: "damageActive"; amount: number; source: "ability" | "attack" }`.

The rule licenses a FIELD when everything downstream of the varying token is
byte-identical. Here that is **literally everything**: same target, same flat placement,
same raise-only contract, same event type, same `seat`. The whole difference is one enum
value in what the row may honestly say. A second op would have been two copies of five
lines told apart by a log label.

**The contrast with D138 is the point.** There the same rule was applied and FAILED,
because the counter move emits a second event on the other seat's board and can end the
game. Two consecutive slices, one rule, opposite answers: **it is a TEST, not a default**,
and D138's own carried-forward note said so.

The field rides the OP rather than `EffectContext` because the context is WHO a program
runs for (seat + the source body), deliberately not WHAT invoked it — and `ctx` is
serialized into every park's `EffectContinuation`, so a provenance field there would cost
a wire-shape change for the benefit of one op that never parks.

`COUNTERS_PLACED.source` is now **seven members**, and `log.ts` gained a SYSTEM row in
the PRINTED verb — **"Put: 70 damage onto …"**, the parallel of D138's "Moved:". The
actor is named by the `ATTACK_DECLARED` row directly above, which is the same argument
D136 used to make the mill row passive rather than give it an `actor` field.

### ⚠️ The counters are HP × 10, and the conversion lives at the PRODUCER

`damageActive.amount` is HP; every printed sentence that reaches it counts COUNTERS
(§12: one counter = 10 HP). So the deriver multiplies **once, at the site that reads the
number** — the same placement Trevenant's registry row uses when it writes `amount: 10`
for its printed **1** counter, and the same one `DEFENDER_POISON_N` uses for
`poisonDamage`. The interpreter never sees the printed unit and therefore cannot convert
twice.

Pinned so that **a factor of ten in either direction fails**:

- the derivation table asserts `counters * 10` and explicitly refuses both `counters`
  and `counters * 100` — `toEqual` on the right answer alone would still pass a suite
  whose expected value was copied from the bug;
- two different printed counts derive two different amounts in the same ratio, so it is
  a **conversion rather than a constant**;
- both printings are driven end to end on real boards, at **70** and **50**.

Mutation-checked: dropping the × 10 fails **17** tests.

### The census (local D1, 2026-08-02, whole effect string, 978 cards)

D138's sweep **re-read for the PUT half rather than re-run** — the counter-damage
neighbourhood is one census and this is the other half of it.

| Slice of the census | Printings | Distinct clauses |
|---|---|---|
| Attack effects containing "damage counter" | **56** | **31** |
| …of those, ones whose ACTION is PUTTING counters | **24** | **15** |
| …of those, ones aimed at "your opponent's Active Pokémon" | **4** | **4** |
| …of those, **mapped by this slice** | **2** | **2** |
| …of those, ones that MOVE rather than PUT (D138) | 2 | 1 |
| …the remainder: clauses that READ counters (scaling / conditions) | 30 | 15 |

The four aimed at the defender's Active — the whole set a slightly wider reader would
touch:

| Clause | Printings | Card | After D139 |
|---|---|---|---|
| `Put 7 damage counters on your opponent's Active Pokémon.` | **1** | Mimikyu `sv02-097` "Ghost Eye" | **MAPPED** |
| `Put 5 damage counters on your opponent's Active Pokémon.` | **1** | Polteageist `sv03-098` "Pour Tea" (index 1) | **MAPPED** |
| `Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.` | 1 | Alolan Raticate `swsh10.5-042` "Super Fang" | loud |
| `…until its remaining HP is 10. If you placed any damage counters in this way, this attack also does 120 damage to this Pokémon.` | 1 | Claydol `sv03-095` "Kaboom Doll" | loud |

The two that stay loud read their amount off the **TARGET** rather than off the text,
which no capture can express — and that is exactly why this anchor CAPTURES the count
instead of making it optional. A reader that did the latter would map both to a
placement of nothing at all, silently.

The other PUT targets, none of them near enough to be a hazard: `1 of your opponent's
Benched Pokémon` (Ting-Lu ex `sv02-127`, 4 — already a `damageChosen` snipe), `1 of your
opponent's Pokémon` (Ninetales `sv03-029`/`-199`, 2, plus a rider sentence), `your
opponent's Pokémon in any way you like` (Drifblim `sv01-090`, 1), `each of your
opponent's Pokémon` (Maushold `sv02-168`/`-226`, 2 — scaled by a board count; Yveltal
`sv06.5-035`, 1 — filtered), `each of your opponent's Benched Pokémon that has any damage
counters` (Vespiquen ex `sv03-096`/`-212`, 2), `this Pokémon` (Annihilape ex `sv02-242`,
1), `the Attacking Pokémon` (Lycanroc ex `sv02-117`/`-241`, 2; Mabosstiff `sv02-143`, 1),
and the Poison-checkup riders (4).

**Two quantity findings, both negative and both worth having:** **ZERO** printings in the
whole PUT family are coin-scaled or coin-gated, and exactly **one** carries "up to"
(Annihilape ex `sv02-242`, aimed at **itself**). So neither of the two neighbours a wider
reader might have been designed against actually exists on this target.

### ⚠️ A bare `(\d+)` is not a D120 template, and the cross product is unfiltered

D120 licenses a lookup TABLE only when the varying token has a **CLOSED vocabulary to be
rejected against** — the five status words, the nine energy codes. A count has none, so
the number lands in a FIELD of one op, exactly as D131's two captures and D135's amount
do. There is no table, so there is nothing for a template to look a token up in.

The cross product the capture accepts is deliberately **unfiltered above zero**: "Put 1
damage counters …" is unprinted and ungrammatical, but it is unambiguous and the op
expresses it exactly, so refusing it would be **a claim about the INGEST, not about the
GAME** — D131's call for the unprinted "the top 1 cards" and D135's for "Heal all damage
from 1 of your Pokémon.", the same line for the third time. A printed **0** stays LOUD,
the `>= 1` guard every arm in this deriver carries.

**And the SINGULAR is not a branch, which is where this differs from D131.** There the
pool printed BOTH spellings ("the top card" / "the top N cards"), so the singular earned
its own alternation. Here every ATTACK printing is the plural; the pool's only singular
is **Trevenant's ABILITY** — lowercase, mid-sentence, behind a Checkup clause, and
already carrying a registry row producing this very op. A singular branch would invent a
reading nothing prints.

### ⚠️ The placement is FLAT, pinned from BOTH sides of §8.5

D138 pinned only the doubling direction. Under a **Psychic** attacker (Mimikyu):

- a **×2 Psychic** defender takes **70, not 140**;
- a **Psychic −30** defender takes **70, not 40**.

A build that special-cased Weakness alone passes the first and fails the second, which is
why the second fixture (`fix-psychic-resist-big`) exists. No `DAMAGE_DEALT` row is emitted
at all — the event TYPE is as much the claim as the number, since `DAMAGE_DEALT` carries
`weakness`/`resistance` fields precisely because it went through the pipeline.

**Being PRINTED on an attack does not make a placed counter attack damage.** That is the
one thing this producer could have got wrong that D138's could not, since D138's op only
ever moved counters that were already flat.

### ⚠️ The Knock Out lands INLINE, with no park in front of it

"your opponent's Active Pokémon" is not a choice, so unlike D138 there is no park
anywhere and the whole declaration is ONE event batch:

`ATTACK_DECLARED` → `COUNTERS_PLACED` → `KNOCKED_OUT` → `PRIZES_OWED` **to the ATTACKER**

…stopping at `{ kind: "ko:takePrizes", seat: "p1", count: 1 }` with **no `TURN_ENDED`
yet**. The complement is driven too — one point short does **not** KO — which catches a
counters-vs-HP confusion in the KO check rather than in the reader.

### Witnesses and fixtures

**One witness re-pointed, none deleted.** `counterMove.test.ts` listed Mimikyu's sentence
as a stays-LOUD near-miss and it now derives; the slot moved to **Ninetales
`sv03-029`/`-199` "Nine-Tailed Dance"** (the same verb and a bare count, behind an
any-zone target and a second sentence). That is what a family growing into its
neighbour's witness list looks like from the inside.

`clauseApostrophe.test.ts`'s DISCOVERED census moved **33 → 35** — two distinct sentences
at once — the moment the fixtures landed.

Fixtures:

- **Mimikyu `sv02-097`** gained its printed attack (it was already in the pool as the
  Safeguard defender, D107). It is a **sharper zero-registry-row witness than a card with
  no row at all**: `programFor("sv02-097")` is DEFINED (the Safeguard passive) while
  `.attack` is not. **A row on the CARD is not a row on the ATTACK** — the distinction
  D135 got wrong in the other direction when it read an Arboliva registry row as
  shadowing a deriver it never met.
- **Polteageist `sv03-098`** is new to the pool. A Stage 1, surgeried into the Active
  Spot — D135 invented a Basic only because BOTH of its printings were evolutions; here
  Mimikyu is the Basic and carries every end-to-end board. Its **index-0 "Antique
  Collecting" opens with the SAME WORD ("Put …") and stays LOUD**, so one card proves the
  anchor is a whole sentence rather than a prefix.
- **`fix-psychic-resist-big`** (200 HP, Psychic −30, no attacks) — the low side of the
  flat-placement claim.

Own deck (`COUNTER_PUT_DECK`), per the house convention.

### The suite — `counterPut.test.ts` (23 tests)

Seed-free: neither sentence takes a coin, pinned by an unchanged `rngState` across a
whole declaration. Full `bun run check` green exit 0, **181 files / 2916 tests** (was
180 / 2893).

Derivation: both clauses table-driven to HP; the × 10 refused in both directions; the
derived op asserted to be Trevenant's authored op with ONE key flipped; nine real
catalog near-misses; the sibling anchor's disjointness in BOTH directions; seventeen
anchor/punctuation/case/token rewrites including the singular noun, the missing count,
"up to", a signed count and a fractional one; the printed-0 refusal beside the
ungrammatical-singular acceptance; the curly-apostrophe EQUALITY on both clauses.

End to end: 70 for Mimikyu's 7 and 50 for Polteageist's 5; the addition onto existing
damage; the same declaration from p2; the rngState pin; both flat-placement bodies; the
inline KO and the one-point-short complement; and the log pair — the `"attack"` row as
SYSTEM voice in the printed verb, and **Trevenant's `"ability"` row still rendering as an
Ability**, because a field is only meaningful if both values reach the log.

Mutation-checked four ways: dropping the × 10 fails **17** tests, reusing
`source: "ability"` fails **13**, accepting a printed 0 fails 1, accepting the singular
noun fails 1.

### ⚠️ Found and written down rather than fixed — `placeSnipe`'s guard is an accident

`interpreter.ts`'s `placeSnipe` pushes `COUNTERS_PLACED` source `"ability"` on its
non-`deals` path, exactly as `damageActive` did before this slice.

**⚠️ Checked rather than assumed, and the first draft of this section was WRONG.** It
called the label a live defect — "Ting-Lu ex `sv02-127` 'Land Scoop' derives to a
`damageChosen`, so the engine prints Ability: on an attack today" — and the new suite's
own near-miss list disproved it in one assertion: that sentence derives to **null**.
Ting-Lu ex's only registry row is the `CURSED_LAND` passive, and its attack is unmapped.

What is actually true:

- the non-`deals` path is reached TODAY only by **Abilities and triggers** — Hawlucha
  `sv01-118` "Flying Entry" (`onPlayToBench`), Meowscarada ex `sv02-015` "Bouquet Magic",
  Radiant Blastoise `swsh10.5-018` "Pump Shot";
- every **derived attack snipe** sets `deals: true` and routes to `DAMAGE_DEALT` instead;
- so the label is **correct today**, and the exposure is **LATENT — guarded by a flag
  chosen for an unrelated reason, which nothing asserts.**

The printing that would trip it is on this slice's own census and is loud today:
**Ting-Lu ex `sv02-127`/`-243`/`-263`/`-275` "Land Scoop"** — "Put 2 damage counters on 1
of your opponent's Benched Pokémon.", **4 printings**, beside a printed 150. The slice
that maps it inherits the question, and D139's `"attack"` member is the answer already
built.

**The generalisation: a slice that writes down a defect it did not fix owes the same
check as one that fixes it.** This note nearly shipped an unverified claim into three
docs — in the very slice whose headline is that unverified claims propagate by repetition.
D136's leftover (the literal-table apostrophe exposure) was correct because somebody
censused it; this one was corrected because a test happened to cover it. Only one of
those is a process.

### Still unmapped after D139 — ranked by cost

The heal census is CLOSED (D133/D135), the gated census in the D134 section is the live
map for "Flip a coin. If heads, …", and the counter-damage neighbourhood is now closed on
BOTH halves — the D138 section's table for MOVE, this section's for PUT. Do not re-run
any of the three.

- **`Put {N} damage counters on 1 of your opponent's Benched Pokémon.` — Ting-Lu ex
  `sv02-127`/`-243`/`-263`/`-275` "Land Scoop", 4 printings / 1 clause.** Turned up by
  this slice's census and **the cheapest thing left**. `damageChosen { target:
  "opponentBench", amount, count: 1 }` is already AUTHORED at a different amount by
  Meowscarada ex `sv02-015`'s "Bouquet Magic" registry row, so this is D132's inventory
  rule a fifth time — a regex, one capture and an arm. All four printings also carry a
  printed **150**, which D125's tail placement resolves for free. ⚠️ **And it is the
  producer that resolves `placeSnipe`'s latent label** (above): the snipe must NOT set
  `deals: true` (these are placed counters, not attack damage — the `damageActive` rule),
  which is exactly what routes it onto the `"ability"` string. D139's `"attack"` member is
  the answer; the work is deciding whether `placeSnipe` takes the same FIELD or reads it
  from `deals`.
- **The gated PREVENT clause — 13 printings / 2 spellings**, still the biggest single
  un-taken count in the gated census. "…during your opponent's next turn, prevent all
  damage from and effects of attacks done to this Pokémon." A §11 block with a DURATION,
  so the cost is a CONTINUOUS-EFFECT mechanism rather than a reader.
- **`Put {N} damage counters on 1 of your opponent's Pokémon. During your next turn, this
  Pokémon can't attack.` — Ninetales `sv03-029`/`-199`, 2 printings / 1 clause.** Turned
  up by this slice's census. A COMPOUND: the first sentence is an any-zone `damageChosen`
  the engine can already express, the second is a §11-style self-lock with a DURATION
  that nothing in the vocabulary carries — so it is priced by its SECOND clause, not its
  first, and it is not the cheap item its first half makes it look.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132–D138: a channel from the
  §8.5 pipeline's RESULT into a tail op, structurally identical to Camerupt `sv03-032`.
  Do it last or not at all, and do it *with* Camerupt.

## D140 — the PUT on the opponent's BENCH: `Put {N} damage counters on 1 of your opponent's Benched Pokémon.` (engine 0.89.0, MATCH_RECORD_VERSION 2 → 3)

**4 printings / 1 distinct clause** — Ting-Lu ex `sv02-127`/`-243`/`-263`/`-275`
**"Land Scoop"** ({F}{F}{F}, attack index **0**, **2** counters, beside a printed
**150**) — now SIMULATE on **ONE anchored regex with ONE `(\d+)` capture and ONE
`deriveAttackEffect` arm**. The BENCH half of the action D139 mapped on the Active,
taken as the top item of D139's remainder list, and the counter-PUT census is now
closed on every target a single-Pokémon reader can reach.

This is also **the slice that resolved `placeSnipe`'s latent log label** — the defect
D139 found, checked, and deliberately wrote down rather than fixed.

### The resume point's claims, checked before anything was designed

Every CATALOG claim held. The STRUCTURAL ones did not all hold, which is exactly the
pattern the list itself had just named.

| Claim | Verdict |
|---|---|
| Ids `sv02-127`/`-243`/`-263`/`-275`, 4 printings / 1 clause | **TRUE.** |
| Attack name "Land Scoop" | **TRUE** (no D138-style correction needed). |
| Attack INDEX | **TRUE at 0** — and non-trivially so: the card has exactly ONE attack, which is what makes the index a fact rather than a guess. D139 found Pour Tea at index 1. |
| 2 counters, printed `damage` **150**, cost {F}{F}{F} | **TRUE**, all three, on all four printings. |
| "`damageChosen { target: "opponentBench", amount, count: 1 }` is already AUTHORED by Meowscarada ex `sv02-015`" | **TRUE**, at amount 30, and asserted as an op identity rather than by eye. |
| "`programFor("sv02-127")?.attack` is undefined and the sentence derives to null today" | **TRUE**, and `counterPut.test.ts` had already pinned it. The `.attack` half is STILL true after this slice. |
| "`placeSnipe` hardcodes `"ability"`; the guard is that every derived attack snipe sets `deals: true`; nothing asserts it" | **TRUE, all three parts.** |
| "the work is deciding whether `placeSnipe` takes the same FIELD **or reads it off `deals`**" | **⚠️ FALSE — the second option does not exist.** See below. |
| "two possessives-worth of apostrophe risk" | **⚠️ HALF TRUE.** Two possessives, **ONE apostrophe**. |
| *(unstated)* the `MATCH_RECORD_VERSION` question | **⚠️ MISSING, and the answer is a BUMP.** See below. |

### ⚠️ The derivation off `deals` is NOT TOTAL, which is why `source` is a field

`deals` picks the **EVENT**, not the provenance:

- `deals: true` → `DAMAGE_DEALT`, an event with **no provenance enum at all**;
- `deals` absent → `COUNTERS_PLACED`, and that arm is taken by **three Abilities**
  (Hawlucha `sv01-118`, Meowscarada ex `sv02-015`, Radiant Blastoise
  `swsh10.5-018`) **and, since this slice, by an ATTACK**.

One flag value, two honest labels. So there is nothing to read the answer off, and
`source: "ability" | "attack"` became a **REQUIRED field** on `damageChosen` — the
same field, with the same members, `damageActive` grew at D139 — with `placeSnipe`
taking it as a parameter.

**REQUIRED rather than optional-with-a-default is the whole answer to "an explicit
field a producer must remember": the compiler remembers.** All six existing
producers (three registry rows + three deriver arms) were updated because they had
to be, and three neighbouring suites went red until they were. On the `deals` arm
the value is UNREAD but still TRUE — attack damage can only come from an attack — so
it is a fact about the op rather than D135's field-that-means-nothing-on-one-arm
trap.

It cannot ride `EffectContext`, and that argument is **stronger** here than at D139:
the context is WHO a program runs for rather than WHAT invoked it, and unlike
`damageActive` this op **PARKS**, so a provenance field there would be a wire-shape
change on every serialized `EffectContinuation`.

### ⚠️ The guard is ASSERTED now, not relied on

D139 could only write the guard down. The old safety was *"every derived attack
snipe happens to set `deals: true`"* — a flag chosen for an unrelated reason that
nothing tested.

`counterBenchPut.test.ts` sweeps **every attack effect in the whole `FIXTURE_POOL`
through the real reader** and refuses `"ability"` on every op it produces. Total
over the pool rather than a hand-kept list, so an arm added by a later slice is
swept the day its fixture lands (the `clauseApostrophe.test.ts` design, reused). The
other side is pinned too — the three registry rows still say `"ability"` — because a
field is only meaningful if both of its values reach the log.

### ⚠️ `spreadDamage` and `damageSelf` do NOT share the exposure — with evidence

The question the item explicitly left open, answered structurally rather than by
inspection of a call site:

| Op | Emits | Exposed? | Why |
|---|---|---|---|
| `damageChosen` (counter path) | `COUNTERS_PLACED` | **YES — this slice** | `seat` owns the DAMAGED Pokémon, and its producer set grew past the hardcoded label. |
| `spreadDamage` | `DAMAGE_DEALT` only | **NO** | That event carries **no provenance enum at all**. There is no label to be false, at any number of producers. |
| `damageSelf` | `COUNTERS_PLACED` source `"self"` | **NO** | `seat` **IS** `ctx.seat` — the actor's own — so D136's voice defect (a row rendering under the non-actor's name) is impossible by construction. And `"self"` names the **DIRECTION**, not the invoker, so it does not go false when a producer appears. |

**⚠️ A FOURTH SITE, FOUND AND NOT FIXED, ON A DIFFERENT AXIS.** `attack.ts`'s §9
reactive recoil pushes `COUNTERS_PLACED` source `"ability"` for the `damageAttacker`
passive — and **Rocky Helmet, a TOOL, also produces that passive**, so the row prints
"Ability:" for a Tool. Pre-existing, **LIVE rather than latent**, and **pinned as
intended by `rockyHelmet.test.ts:95`** — the D136 "the suite asserts the bug" pattern
for a third time. It is a Tool-vs-Ability question rather than the attack-vs-Ability
one this slice closes, so it is written down and ranked rather than folded in.

### ⚠️ `MATCH_RECORD_VERSION` 2 → 3 — the first bump since D124

The claim this slice most nearly got wrong, by copying D139's note.

D139 added the identical field to `damageActive` and correctly bumped nothing:
**that op never parks**, so no `EffectContinuation` has ever carried one.
`damageChosen` **does** park — it sits in `GameState.phase.cont.pendingOp` whenever a
snipe waits on its pick, which is a live, reachable, **persisted** position.

A record written by the previous deploy mid-park comes back with the REQUIRED field
**ABSENT**; `undefined` reaches `placeSnipe`; the emitted `COUNTERS_PLACED` falls off
every labelled log arm onto the active-voice **default**, rendering under the DAMAGED
player's name. **A missing required field that reads back "fine" is D124's case
verbatim.**

The test is never *"did a type change"* but *"can the PREVIOUS deploy's record hold
the old shape"* — which for an `EffectOp` turns entirely on **whether it can be
sitting in `phase.cont` at write time**. Two slices, one field, opposite answers, the
same way D131's widen-don't-add rule is a TEST rather than a default. The absolute
value is now PINNED in `match.test.ts`, so a bump can never happen as a side effect
of an edit (it retires every open match).

### The census (local D1, 2026-08-02, whole effect string, 978 cards)

D139's PUT census **re-read for this target rather than re-run** — it is CLOSED.

| Slice of the census | Printings | Distinct clauses |
|---|---|---|
| Attack effects containing "damage counter" | 56 | 31 |
| …of those, ones whose ACTION is PUTTING counters | 24 | 15 |
| …of those, aimed at **"1 of your opponent's Benched Pokémon"** | **4** | **1** |
| …of those, **mapped by this slice** | **4** | **1** |

Every other printing of that noun phrase in the pool is an **ABILITY**, and all are
refused on **CASE alone**:

| Printed text | Printings | Card | Fate |
|---|---|---|---|
| `Put 2 damage counters on 1 of your opponent's Benched Pokémon.` | **4** | Ting-Lu ex `sv02-127`/`-243`/`-263`/`-275` "Land Scoop" | **MAPPED** |
| `…you may put 3 damage counters on 1 of your opponent's Benched Pokémon.` | 4 | Meowscarada ex `sv02-015`/`-231`/`-256`/`-271` "Bouquet Magic" | REGISTRY (already) |
| `…you may put 2 damage counters on 1 of your opponent's Benched Pokémon.` | 1 | Radiant Blastoise `swsh10.5-018` "Pump Shot" | REGISTRY (already) |

The two Ability rows are **the sharpest refusals available to this anchor**: they
already produce this very op through the registry, so a reader that swallowed them
would double-author the same card.

### ⚠️ The printed 150 — the counter family's first D125 tail board

D138's and D139's six printings carried **no `damage` field at all**, so a placement
was their entire visible result and there was no ordering question. Here ONE
declaration produces a real §8.5 hit AND a flat placement, verified end to end:

`ATTACK_DECLARED` → `DAMAGE_DEALT` (150, full pipeline) → `EFFECT_PENDING`
…then the pick → `COUNTERS_PLACED` (20, flat) → `KNOCKED_OUT` → `PRIZES_OWED` **to
the ATTACKER**.

Both Knock Outs can land at once (the Defender's from the 150, the pick's from the
counters) and they land in **ONE sweep** — but the prizes queue **one `takePrizes`
stage per KO** rather than one summed row, so the batch carries a single
`PRIZES_OWED` of 1 and the second stage waits behind it. Pinned, because "2 KOs"
reads like a 2.

### ⚠️ The flat claim is pinned by PASSIVES, not by Weakness

Where D138/D139 pinned Weakness and Resistance, §8.5 already flattens Weakness **on
the Bench for both readings** — so a ×2 body only pins the ROUTE. The assertions that
actually separate a placement from a `deals: true` hit are the ones a `deals` build
would consult:

| Benched target | Placement (correct) | What a `deals: true` build reads |
|---|---|---|
| `fix-fighting-weak` (×2 Fighting, inert) | **20** | 20 (route-pinning only) |
| Bouffalant `sv03-174` (`damageReductionAfterWR: 20`) | **20** | **0** |
| Mimikyu `sv02-097` (`preventDamageFromExV`) | **20** | **0**, with a `prevented: true` row |

The Safeguard case is the sharpest assertion in the slice and **D139 could not buy
it**: it needs an attacker with a rule box, and Ting-Lu **ex** has one. Both
Ability-carrying bench bodies are left UNDAMAGED in the cases that read their
passives — Ting-Lu's own **Cursed Land** aura strips Abilities from the opponent's
DAMAGED non-ex Pokémon, so a pre-damaged target would pass for the wrong reason.

### Witnesses and fixtures

**TWO witnesses re-pointed, none deleted.** `counterMove.test.ts` AND
`counterPut.test.ts` both listed this sentence as a stays-LOUD near-miss; both slots
moved to **Vespiquen ex `sv03-096`/`-212` "Phantom Queen"** (same Bench, same verb, a
per-target FILTER nothing in the vocabulary expresses). D139's dedicated *"Ting-Lu is
UNSIMULATED"* case was **KEPT and inverted** rather than removed, so one file now
records the note being wrong, then right, then closed.

`clauseApostrophe.test.ts`'s DISCOVERED census moved **35 → 36** — one row, four
printings, because it is a *sentence* census.

Fixture: **Ting-Lu ex `sv02-127`** gained its printed attack (it was already in the
pool as D100's ability-lock aura). It is the same kind of witness Mimikyu was at
D139 — `programFor` is DEFINED (the `CURSED_LAND` passive) while `.attack` is not,
and all four printings share one program. Own deck (`COUNTER_BENCH_PUT_DECK`).

### The suite — `counterBenchPut.test.ts` (28 tests)

Seed-free, pinned by an unchanged `rngState` across a whole **park-and-resolve**
(the park is where a reshuffle would hide). Full `bun run check` green exit 0,
**182 files / 2944 tests** (was 181 / 2916).

Derivation: the clause to HP; the × 10 refused in both directions; `deals`/`ignoreWR`/
`perTakenPrize`/`optional` asserted **ABSENT**; op identity against Meowscarada's
authored row rebuilt key-by-key; eight real catalog near-misses; the sibling anchor's
disjointness in BOTH directions; seventeen anchor/punctuation/case/token rewrites
including the **seat flip** ("1 of **your** Benched Pokémon" — the catastrophic miss,
since the op has no seat field to be wrong in); the printed-0 refusal beside the
ungrammatical-singular acceptance; the curly-apostrophe EQUALITY plus the **one-slot**
assertion.

The guard: the whole-pool sweep; the three registry rows from the other side; and the
`spreadDamage`/`damageSelf` non-exposure driven rather than argued.

End to end: the 150-then-park order; the prompt's `min`/`max`/`declinable`/candidates
/note; the resume; the addition onto existing damage; the forced single-candidate
auto-take; the empty-Bench **silent whiff** (not an `ATTACK_EFFECT_SKIPPED` — a
derived program means the sentence was read); the other seat; the rngState pin; seven
illegal picks including the empty set and the Defender; the three flat-placement
bodies; the benched KO behind the park, the one-point-short complement, and the
both-boards sweep; and the log pair — the SYSTEM `"Put:"` row that never says
**Ability**, and Meowscarada's `"ability"` row that still does.

Mutation-checked **five ways**: dropping the × 10 fails **20** tests, restoring the
hardcoded `"ability"` fails **6**, setting `deals: true` fails **17**, accepting a
printed 0 fails 1, dropping the word "opponent's" from the anchor fails 1.

### Still unmapped after D140 — ranked by cost

The heal census is CLOSED (D133/D135), the gated census in the D134 section is the
live map for "Flip a coin. If heads, …", and the counter-damage neighbourhood is
CLOSED on both halves (the D138 section for MOVE, the D139 + this section for PUT).
Do not re-run any of them.

- **The gated PREVENT clause — 13 printings / 2 spellings**, still the biggest
  un-taken count in the gated census. "…during your opponent's next turn, prevent all
  damage from and effects of attacks done to this Pokémon." A §11 block with a
  DURATION, so the cost is a CONTINUOUS-EFFECT mechanism rather than a reader.
  ⚠️ **This forecast has never been verified** and it is exactly the shape of claim
  that has now been wrong on five consecutive lists. Read `continuous.ts` for what a
  duration-scoped defender-side prevention already costs BEFORE ranking it.
- **`attack.ts`'s §9 recoil row calls a TOOL an Ability** — found by this slice, not
  fixed (above). Live, one-line, and it needs the same judgement D136's finding 1
  made: a new `COUNTERS_PLACED.source` member (`"tool"`? `"recoil"`?) or a passive
  wording, plus a decision about whether Counterattack Quills (a real Ability) and
  Rocky Helmet (a Tool) should render differently at all. `rockyHelmet.test.ts:95`
  pins the current label as intended, so that assertion moves with it.
- **`Put {N} damage counters on 1 of your opponent's Pokémon. During your next turn,
  this Pokémon can't attack.` — Ninetales `sv03-029`/`-199`, 2 printings / 1 clause.**
  ⚠️ Priced by its SECOND clause: sentence one is now a **one-token** widening of
  D140's anchor (an any-zone `damageChosen`, `target: "opponentAny"`, which already
  exists), so the first half is cheaper than it was before this slice; sentence two
  is a §11-style SELF-lock with a DURATION that nothing in the vocabulary carries.
  It shares the gated PREVENT item's mechanism, which is the argument for doing them
  together or neither.
- **Iron Moth `sv06.5-009` "Suction"** — unchanged from D132–D139: a channel from the
  §8.5 pipeline's RESULT into a tail op, structurally identical to Camerupt
  `sv03-032`. Do it last or not at all, and do it *with* Camerupt.

## D141 — the §9 recoil LABEL: `attack.ts` called a TOOL an Ability (engine 0.90.0, MATCH_RECORD_VERSION unchanged at 3)

**Not a card slice — a defect fix**, taken as item 2 of D140's remainder list on
that list's own instruction (*"do this WITH item 1 or before it — it is the only
LIVE defect on it"*). `attack.ts`'s §9 reactive recoil pushed `COUNTERS_PLACED`
source `"ability"` as a **string literal** for the `damageAttacker` passive, so
**every Rocky Helmet `sv01-193` — a Pokémon TOOL — has rendered "Ability: 20 damage
to …" in every match since 0.57.0**. Live rather than latent: no card has to be
added and no clause derived for a player to see it.

D136's finding 1 on a **third axis** — not the row's VOICE (D136), not
attack-vs-Ability (D138 → D139 → D140), but **Ability-vs-Tool**.

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| The row pushes `"ability"` for `damageAttacker`, and Rocky Helmet (a Tool) produces it | **TRUE.** |
| The row is reachable in any match with a Rocky Helmet | **TRUE** — driven end to end, no card additions. |
| `rockyHelmet.test.ts:95` pins the current label as INTENDED | **TRUE**, comment and all ("ability-sourced"). |
| "…produced by an Ability, a Tool and **an attack-installed trap (Stunfisk's Custom Trap)**" | **⚠️ FALSE.** Custom Trap is a printed **ABILITY** with a `requiresTool` gate. The genuinely attack-installed printings exist — Lycanroc ex `sv02-117`/`-241` "Scary Fangs", Mabosstiff `sv02-143` "Comeuppance" — and are **unsimulated**. |
| The producer set is "those three" | **⚠️ INCOMPLETE.** The catalog prints this mechanism on **8 printings / 5 sentences / three kinds of card**, including a **SECOND Tool** (Vengeful Punch `sv03-197`) the list did not name. |
| `rockyHelmet.test.ts:95` is the assertion that moves | **⚠️ INCOMPLETE.** `damageAttacker.test.ts` carried **two more** pins; a fix that moved only the named one goes red. |

Six consecutive lists, six with a wrong or missing structural claim — and this
time all three misses were **omissions**, which is exactly the failure mode the
standing note calls the most dangerous.

### ⚠️ The judgement: the SUM makes every provenance label false

`passivesOf` aggregates `damageAttacker` over the holder's **own passive AND every
attached Tool** into one seat-free number, and `attack.ts` emits **one** event
carrying it. So a single row can be an **Ability's 50 plus a Tool's 20** — and that
board is the card's own rather than a contrivance:

> **Stunfisk `sv03-112` "Custom Trap" does not fire at all unless a Tool is
> attached, and Rocky Helmet is a Tool.** 50 + 20 = **70, in ONE row, with ONE
> `source` slot**.

| Candidate | What it names | Verdict |
|---|---|---|
| keep `"ability"` | provenance | **False for a Tool** — the defect. |
| add `"tool"` beside it | provenance | **False for the sum**: the number has two provenances and the row has one label. Wrong before it shipped, since the pool already prints the mechanism on three kinds of card. |
| re-word the shared `"ability"` arm | mechanism, on the wrong arm | Degrades the **five** honest Ability producers (Trevenant, Gardevoir ex, Hawlucha, Meowscarada ex, Radiant Blastoise) to fix one dishonest site. |
| **add `"counterattack"`** | **mechanism** | **TAKEN.** True of an Ability, a Tool, and the sum of both. |

`COUNTERS_PLACED.source` is now **eight members**, and this is the enum's first
member on the **MECHANISM** axis since `"confusion"` — `poison`/`burn`/`confusion`
name mechanisms, `ability`/`moved`/`attack` name provenances, `self` names a
direction. The enum was always mixed; the §9 recoil joins the older group, where
"the game did this to you" is the whole content of the row.

**NOT `"recoil"`**: `events.ts` already uses that word for `"self"` — an attacker
damaging ITSELF with its own printed attack (Skeledirge "Blazing Shout"), the
opposite direction, rendered in the attacker's own voice. The two are pinned apart
in the suite rather than left to collide.

### ⚠️ Should a real Ability and a Tool render differently at all? — NO

Answered structurally rather than on cost. **The engine cannot tell them apart at
the read site by construction**: `passivesOf` hands `attack.ts` a bare `number`,
and no provenance survives the addition — asserted, not argued (every authored
`damageAttacker` record is checked to carry nothing but `amount`/`requiresTool`, so
the day someone adds a `kind` field this test says why that is not the answer).

And the product question separately lands in the same place: what a reader needs
from this row is **why their attacker suddenly has damage on it**, which is the
mechanism. *Which slot on which card granted it* is not even well-defined once two
cards contribute — and the log names no card here in any case, because the recoil
emits **no `ABILITY_TRIGGERED` row** (it is a passive; a Tool has no Ability to
trigger). **This row is the entire explanation a player gets**, which raises the bar
on the label being true rather than lowering it.

### The census (local D1, 2026-08-02, whole effect string, 978 cards)

A **new** census. The counter-PUT one is CLOSED and was not re-run.

| Printed on | Printings | Cards | Fate |
|---|---|---|---|
| an **Ability** | 3 | Cacnea `sv01-005`, Cacturne `sv01-006` (Counterattack Quills, 30), Stunfisk `sv03-112` (Custom Trap, 50, `requiresTool`) | **AUTHORED** |
| a **Pokémon Tool** | 2 | Rocky Helmet `sv01-193` (20) — **AUTHORED**; **Vengeful Punch `sv03-197`** (4 counters, on a **KO** condition rather than a damaged one) — **loud** | 1 of 2 |
| an **attack** | 3 | Lycanroc ex `sv02-117`/`-241` "Scary Fangs" (10 counters), Mabosstiff `sv02-143` "Comeuppance" (counters **equal to the damage done**) | **loud** — §11 blocks with a DURATION |

**Three kinds of card, one mechanism, one row.** A `"tool"` member would have been
wrong before it shipped; each of the five unmapped printings joins this label with
**no new member** when it lands, which is the test of whether the axis was right.
All five are pinned LOUD in the suite so the day one derives, this file notices.

### ⚠️ The guard is SWEPT, not listed — and its absence is why this lived 3 versions

The old "guard" was the **accident** that whoever wrote the literal was thinking of
Cacnea, and the suite then pinned the **wrong side** of it as intended — the D136
"the suite asserts the bug" pattern for a **third** time, in **three** places
(`rockyHelmet.test.ts:95`, `damageAttacker.test.ts` ×2). All three moved with the
fix and are POSITIVE about the new intent.

`counterattack.test.ts` reuses D140's shape:
- it **DISCOVERS** the family by sweeping `FIXTURE_POOL` for the printed sentence
  "…damage counters on the Attacking Pokémon" (across `effect` **and**
  `abilities[].effect`) rather than listing ids;
- it asserts the **text census equals the authored-program census** in both
  directions (a printing with no program would make the sweep drive nothing; a
  program with no printing would make it miss a producer);
- it asserts the family **SPANS both `Pokemon` and `Trainer`** — the fact the
  hardcoded label denied, and a pool of only Pokémon *could* honestly say
  "Ability";
- and it then **DRIVES every member it found**, each wearing Rocky Helmet so a
  `requiresTool` producer actually fires instead of passing vacuously.

A fifth producer is swept the day its fixture lands.

### ⚠️ The fifth site: swept for, and NOT found

D136 → D139 → D140 found this defect in four places, so the sweep assumed a fifth.
Every hardcoded `COUNTERS_PLACED` provenance left in the engine:

| Site | Label | Exposed? |
|---|---|---|
| `flow.ts` Checkup ticks | `"poison"` / `"burn"` | **NO** — mechanism names, one producer each. |
| `attack.ts` §8 step 3 | `"confusion"` | **NO** — same. |
| `interpreter.ts` counter MOVE | `"moved"` | **NO** — mechanism name (D138). |
| `interpreter.ts` `damageSelf` | `"self"` | **NO** — `seat` IS `ctx.seat`, and it names a DIRECTION (D140). |
| `damageActive` / `damageChosen` | parameterised | **NO** — D139/D140 made `source` a required field. |
| **`attachEnergyFrom.bonusCounters`** (Gardevoir ex "Psychic Embrace") | `"ability"`, hardcoded | **NO, today** — ONE producer and it really is an Ability; and its `seat` **IS** `ctx.seat`, so D136's voice defect is impossible by construction. It becomes a question only if a non-Ability ever reaches that op. |

So the answer is *no fifth live site*, with the reasoning written down rather than
the sweep merely reported — the two triage tests D140 named (does the event carry a
provenance enum at all; is its `seat` the actor's own) did all the work.

### The four structural questions

1. **Does it PARK?** **No — and it is not an `EffectOp` at all**: an inline event
   push in `attack.ts`. Nothing is persisted; `source` never reaches `GameState`.
2. **Whose VOICE?** `seat` is the **ATTACKER's** — it owns the DAMAGED Pokémon, per
   the event's contract — while the **CAUSER is the DEFENDER**. So an active-voice
   row would credit the attacker with damaging itself: **the mirror image** of
   D136's finding 1. The row is SYSTEM-voiced, and the suite fails if it is not.
3. **Is the guard ASSERTED?** It is now — see above. It was not, which is the
   whole reason the defect survived 0.57.0 → 0.89.0.
4. **Does the mechanism exist?** Read, not forecast: `passivesOf`'s summation is
   the fact the whole judgement turns on, and neither the resume point nor D140
   had it.

### `MATCH_RECORD_VERSION` — asked, and the answer is NO

D140's obligation, discharged in the negative. Nothing parks on this site, and
`MatchRecord` persists the **RENDERED** `SeatLogEntry[]` rather than the events —
so a match in flight keeps its already written "Ability:" rows as TEXT, the record
stays fully readable, and the enum widening is the `ATTACK_FAILED.reason`
precedent. Stays at **3**.

### The suite — `counterattack.test.ts` (16 tests)

Seed-free. Own deck (`COUNTERATTACK_DECK` — all four authored producers on ONE
deck, precisely so the discovery sweep can drive every member it finds).
Full `bun run check` green exit 0, **183 files / 2960 tests** (was 182 / 2944).

The label on all three shapes (Tool alone, Ability alone, and the **70** sum); the
sum's arithmetic read off the two registry rows rather than written as a constant;
the provenance-free passive record; the discovery census + both-categories claim +
the drive-them-all sweep; the voice and the event order; four log cases (the system
row that never says "Ability", the one-row sum that cannot name either card, a
genuine Ability placement still saying "Ability" so both values reach the log, and
the `"self"` row pinned APART from this one); and the three unmapped printings held
LOUD.

**Mutation-checked four ways**: restoring the hardcoded `"ability"` fails **9**
tests across 3 files, wording the new arm "Ability: " fails **3**, turning
`passivesOf`'s SUM into a MAX fails **3**, rendering the row in ACTIVE voice fails
**3**.

### Still unmapped after D141 — ranked by cost

Unchanged from D140 apart from this item leaving the list. The heal census
(D133/D135), the gated census (§D134) and the counter-damage census (§D138/§D139/
§D140) are all CLOSED — do not re-run any of them.

- **The gated PREVENT clause — 13 printings / 2 spellings.** Still the biggest
  un-taken count in the gated census, and still the **only unverified cost
  estimate on the list**. Read `continuous.ts` for what a duration-scoped
  defender-side prevention actually costs BEFORE ranking it.
- **`Put {N} damage counters on 1 of your opponent's Pokémon. During your next
  turn, this Pokémon can't attack.`** — Ninetales `sv03-029`/`-199`, 2 printings /
  1 clause. Priced by its SECOND clause; shares the PREVENT item's mechanism.
- **The §9 recoil FAMILY, now mapped and priced by this slice** — 5 printings the
  label already covers and no reader does: Vengeful Punch `sv03-197` (a
  KO-conditioned Tool — a new read site, not a new label), and Lycanroc ex ×2 +
  Mabosstiff (attack-installed, §11 DURATION, so they share the PREVENT item's
  mechanism and Mabosstiff additionally needs the damage-dealt amount threaded
  into the block).
- **Iron Moth `sv06.5-009` "Suction"** — unchanged: a channel from the §8.5
  pipeline's RESULT into a tail op, structurally identical to Camerupt `sv03-032`.
  Do it last or not at all, and do it *with* Camerupt.

## D142 — the GATED PREVENT clause: `Flip a coin. If heads, during your opponent's next turn, prevent all damage [from and effects of] attacks done to this Pokémon.` (engine 0.91.0, MATCH_RECORD_VERSION 3 → 4)

The biggest un-taken count in the §D134 gated census now SIMULATES on **TWO anchored
regexes, TWO `deriveAttackEffect` arms, ONE new `EffectOp`, ONE new turn-stamped
`InPlayPokemon` field and ONE new `EffectContext` field**. Every previous slice in this
tail bought a SENTENCE; this one buys a **LIFETIME**, and three other printed shapes
become rows on top of it rather than second mechanisms.

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| "13 printings / 2 spellings" | **TRUE as a count** — 11 + 2 against the local D1 (2026-08-02, 978 cards, whole effect string) |
| …and they are two spellings of one sentence | **FALSE.** They are two **READINGS**. Eleven say "prevent all damage FROM AND EFFECTS OF attacks done to this Pokémon"; two say "prevent all damage done to this Pokémon **by attacks**", which stops damage and nothing else. |
| "the biggest un-taken count in the gated census" | **TRUE**, and still true after the six extra printings below, which are not gated |
| "a §11 block with a DURATION, so the cost is a CONTINUOUS-EFFECT mechanism" | **TRUE**, and the only forecast on six lists that was right about cost |
| "`preventDamageFromExV` is the closest thing that exists" | **TRUE**, and it is exactly the right comparison: the two sit on the same `||` at all four damage sites |
| "the question is precisely what a DURATION costs" | **TRUE** — and the answer is one turn-stamped field, three early clears and a `MATCH_RECORD_VERSION` bump |
| (ABSENT) the count is a FLOOR, not a total | The §D134 census was `LIKE '%Flip a coin. If heads,%'`, so it **structurally could not see** the ungated printings. The family is **19**, not 13. |
| (ABSENT) "effects of attacks" needs a PROVENANCE channel the engine does not have | The block must not refuse a Trainer or an Ability, and no op knows what invoked it. This is the fact the slice actually turned on, and it appeared on no list. |

**The pattern holds for a seventh list: the CATALOG claim was right and the STRUCTURAL
gap was an OMISSION.** And a new one: **a census run for one purpose is a FLOOR for
every other purpose** — D134's query was written to map the gated neighbourhood and is
perfectly correct for that, which is exactly why re-reading it as "the size of the
PREVENT family" understates it by six.

### The census (local D1, 2026-08-02, 978 cards, whole attack effect string)

`attacks_json LIKE '%prevent all damage%'` — the whole family in one query, and it is
**19 printings across 6 sentences**:

| Sentence | Printings | Status after D142 |
|---|---|---|
| `Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.` | **11** | ✅ `FLIP_PREVENT_DAMAGE_AND_EFFECTS` → `preventDamage { effects: true }` |
| `Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.` | **2** | ✅ `FLIP_PREVENT_DAMAGE` → `preventDamage` |
| `During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.` | 3 | ❌ an attacker-CLASS filter — a field and a predicate this op has not got |
| `During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.` | 1 | ❌ the same filter on a different class (Iron Moth `sv06.5-009`, **index 1**) |
| `If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.` | 1 | ❌ gated on the attack's own RESULT — the §9.2 channel Iron Moth "Suction" and Camerupt want |
| `Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.` | 1 | ❌ a SECOND consequent on the same flip |

The eleven mapped WIDE printings: Joltik `sv06.5-001` + Hoppip `sv02-001` "Splashing
Dodge", Wiglett `sv01-055`/`-206` "Twisting Strike", Aipom `swsh10.5-056` "Bustle",
Nymble `sv02-019` "Slight Splash", Sudowoodo `sv02-109`/`-219` "Hit and Hide", Scyther
`sv03-004` "Agility", Dugtrio `sv03-104` "Dig", Barboach `sv03-108` "Hide". The two
NARROW: Glimmet `sv03-121` "Iron Defense", Togedemaru `sv03-151` "Defense Curl".

**A SEVENTH SENTENCE was found in the same sweep and is NOT in this family's shape** —
Palafin `sv03-145` "Oracle Press": *"During your opponent's next turn, prevent all
effects of attacks used by your opponent's Pokémon done to this Pokémon. **(Damage is
not an effect.)**"* — effects WITHOUT damage. One printing, a different sentence, and
its parenthetical is this slice's SPEC (below).

**The whole `During your opponent's next turn, …` neighbourhood is 76 printings across
29 sentences** (same query, the duration rather than the action). Of those, 16 are
D112's retreat lock, 13 are this slice, and the remaining 47 are the map for every
future durated slice: a `takes N less damage` family (14 printings across 4 amounts),
attacker-side damage reductions (4), the §9 installed counterattack (3 — items below),
Item / Special-Energy / Stadium locks (5), an attack lock (4 + 1), an attack-cost
surcharge, an evolution lock and an attach-ends-your-turn rider. **THIS IS NOW THE LIVE
MAP FOR THE DURATION NEIGHBOURHOOD — do not re-run it.**

### ⚠️ The §11 reading, and the CATALOG prints it rather than the rulebook

`ptcg-rules.md` has this family only as §8 step 5's *"prevent all damage"* damage
modifier and §15.B's *"Prevent all / reduce damage; 'no effect of attacks (including
damage)'"*. What actually settles the split is printed on a card in the pool — Palafin
`sv03-145`'s **"(Damage is not an effect.)"** — which is a catalog fact rather than an
intuition, and is the sort of thing this project keeps finding by censusing before
designing.

**IN — the DAMAGE half, both readings.** The §8.5 main hit and every attack-dealt
damage op, at the four sites Mimikyu "Safeguard" is honoured at (`attack.ts` main hit,
`spreadDamage`, `placeSnipe`'s `deals` arm, `snipeActive`). The pipeline still RUNS —
Weakness is computed and reported on the row — and the block nulls the RESULT, so it
SUPERSEDES rather than stacks, exactly like the aura beside it.

**IN — the EFFECTS half, the wider reading only.** §12 Special Conditions applied to
the body (`applyStatus`), the §11 retreat rider (`preventRetreat`), an Energy discarded
off it (`discardEnergy` opponent-side), the destination half of a counter MOVE
(`moveCountersToDefender`), and — the sharpest one — damage **COUNTERS PUT** on it
(`damageActive`, `damageChosen`'s put-counter arm). A placed counter is not attack
damage in this engine and has not been since D138/D139 (it skips Weakness, Resistance
and every reduction passive), so it falls **entirely** on the effects side: **a NARROW
block does not stop it, and that is the family's most observable difference.**

**OUT.**
- Anything an attack does to a **different** Pokémon. The block is per-body ("done to
  THIS Pokémon"), pinned by one Spread Shot declaration: prevented on the shielded
  Active, 20 landing on every benched body in the same events array.
- Anything done to the **player** rather than to a Pokémon — a mill, a hand
  disruption, an Item lock. Not a Pokémon, not blocked.
- The attacker's own recoil and self-damage, and the §9 reactive counterattack: those
  are done to the ATTACKER, which is not "this Pokémon".
- **Everything that is not an ATTACK.** A Trainer, an activated Ability, a triggered
  Ability and a §13 Checkup tick can all land inside the window, and the printed
  sentence mentions none of them.
- Weakness/Resistance and the reduction passives are not "skipped" — they are computed
  and then superseded, which is what keeps the `DAMAGE_DEALT` row honest.
- The attack itself. It is declared, it resolves everything else it does, and the turn
  still ends.

### ⚠️ The state is a TURN STAMP, and the reason is NOT D124's

D124 chose a stamp over a flag to avoid a turn-boundary clear a future slice could
forget. Here **the boundary clear that already exists is actively WRONG**, which is a
stronger argument and the slice's headline.

D112's `retreatBlocked` reuses §13.4's paralysis clock — cleared in `runCheckup` for
`endedSeat` only — and that works because the retreat block sits on the **DEFENDER's**
body: it is installed during the attacker's turn, survives the Checkup that ends it
(`endedSeat` is then the attacker), holds through the locked player's whole next turn
and lifts at the Checkup ending it.

**This block sits on the INSTALLER's OWN body.** So the very first Checkup after the
attack has `endedSeat` = the holder's seat, and the same clear lifts the block **a full
turn early — before its window has opened at all.** The two shapes look identical in a
doc and are mirror images in the code.

`InPlayPokemon.attackBlock: { turn: number; effects: boolean } | null` therefore stamps
**`state.turn + 1`**. Declaring an attack ENDS the turn (§5.3), so the turn after the
installing one is the opponent's *by construction* — no seat is stored and none needs
to be. The lifetime table:

| Moment | `state.turn` | Live? | Why |
|---|---|---|---|
| The install resolves (attack tail, turn N) | N | **no** | the printed word is "NEXT" |
| Checkup ending turn N (`endedSeat` = holder) | N | **no** | …and nothing clears it here, which is the whole point |
| The opponent's whole turn N+1 | N+1 | **YES** | the printed window |
| Checkup ending turn N+1 (`endedSeat` = opponent) | N+1 | **YES** | still the window; a Trevenant tick lands here and is NOT an attack |
| The holder's turn N+2 onward | ≥ N+2 | **no** | expired by arithmetic; the stale stamp stays on the card and answers nothing |
| The holder leaves the Active Spot at any point | — | **no** | §10/§11 — an effect of an attack ends (`switchInto`, `clearOnLeavingActive`) |
| The holder evolves | — | **no** | §10 — written, and **unreachable by construction** |
| The holder is Knocked Out | — | — | the stack leaves play with everything on it |
| Installed twice | — | the later stamp | idempotent within one turn (merged by OR, never downgraded); across turns the new window replaces the old |

**Measured: reusing D112's clock fails 12 tests; stamping the installing turn instead
of the next one fails the same 12.**

### ⚠️ "Effects of ATTACKS" is a provenance the TARGET cannot answer — and it refines D139

The block covers effects of **attacks**, and the opponent may well play a Trainer or use
an Ability during the very turn the window is open. No op knows what invoked it, so the
fact rides `EffectContext.invokedBy?: "attack"` — set by `attack.ts`'s one `runProgram`
call and by nothing else.

**This REFINES D139 rather than reversing it, and the distinction is the point.** D139
was choosing where a **LOG LABEL** for ONE op should live and answered "on the op";
`damageActive`/`damageChosen` still carry `source: "ability" | "attack"` and still
should, because a label is a property of the row that op emits. What rides on the
CONTEXT is a **RULE that six ops must answer identically**: written per op it would be
one fact in six places with six chances to go stale. D139's second objection — that
`ctx` is serialized into every park — is exactly what makes it right here: an attack
effect that PARKS and resolves three actions later is still an attack's effect, and the
continuation carries that across the wire for free. An old continuation lacking the
field reads as "not an attack", which is byte-identically the pre-slice behaviour.

**The two provenances are pinned to agree** on every producer in the pool (the suite
walks the deriver's output for `"attack"` and every registry Ability/trigger for
`"ability"`), so a divergence shows up as a failure rather than as a wrong answer.

The turn stamp kills the largest class of false positives on its own — **a block is
live only during the holder's OPPONENT's turn, so nothing the holder does can ever be
refused by it** — which is why the "self" arm of `applyStatus` is inert. What the stamp
cannot do is tell a Trainer from an attack **inside** the window, and the sharpest
witness is Trevenant's between-turns "Forest Miasma": the SAME `damageActive` op an
attack reaches, firing at the Checkup that ends the window turn, where `state.turn` is
still the block's own number. Only `invokedBy` saves it. **Dropping the check fails 2
tests** — Crushing Hammer inside the window, and Trevenant.

### ⚠️ `effects` is a FIELD — D131 applied and PASSING (the D139 case, not D138's)

Same install site, same holder, same stamp, same event, same expiry, same three early
clears; the whole difference is one boolean consulted by one extra set of read sites.
The suite asserts it directly: **strip the one field from the wide program and it is
byte-identical to the narrow one.** Two op members would have been two copies of one
installation told apart by how much they refuse.

**OPTIONAL, and the polarity is deliberate** (D135's `zone?: "bench"` read from the
other end): the printed words WIDEN the block, so the field is present exactly when
they are printed, and a producer that forgets it blocks **LESS** rather than more. An
over-blocking default would silently make an opponent's whole attack do nothing; an
under-blocking one loses a rider on one body.

**NOT widened to a `damage` flag**, with the warranting condition written into the op's
doc block (D130 → D131's precedent): Palafin `sv03-145`'s effects-WITHOUT-damage
reading, on ONE printing and a different sentence. Mapping it is what turns
`effects?: true` into a two-flag cover, with two readings in hand rather than one
guessed at.

### ⚠️ The early clears are §10's, and which one is REACHABLE is inverted from D112's

Both endings null the field, in the three places `retreatBlocked` is already nulled.

- **EVOLVE — unreachable by construction, written anyway.** Installing ends the turn,
  the window is the opponent's, and nobody evolves on someone else's turn, so no legal
  sequence puts an evolution between the install and the expiry. §10 sheds the effects
  of ATTACKS and this is one; a surgery pins the rule rather than a sequence.
- **LEAVING THE ACTIVE SPOT — reachable in the sharpest possible way.** A Boss's Orders
  played **inside** the window drags the shielded body off the spot and the protection
  goes with it. Pinned by a following Spread Shot landing **20 on the very body that was
  immune a moment earlier** — the assertion a build that skipped the clear fails even
  though nothing else in the game would notice. **Skipping it fails 1 test.**
- Silent on both paths: the `POKEMON_SWITCHED` / `POKEMON_EVOLVED` row already tells the
  story, which is D112's own call for the same endings.

### ⚠️ Two new events, and the VOICE is the mirror of D141's

`ATTACK_BLOCK_APPLIED { seat, uid, effects }` renders in the **ACTIVE** voice, and it is
the first block row that honestly can: `seat` owns the shielded Pokémon (the event
family's contract) **and** that Pokémon is the ACTOR's own. `RETREAT_BLOCKED`'s seat
owns the victim; D141's causer is the other player; this one is the straightforward
case, and saying so is what keeps the other two arguments load-bearing. **System-voicing
it fails 1 test.** The two printed readings get two phrasings, because a reader told
only "protected" cannot work out whether their Poison is about to land.

There is deliberately **no `…_ENDED` twin**. A stamp expires with nothing to announce
and no boundary walk to announce it from — manufacturing one would reintroduce exactly
the per-turn scan the stamp exists to avoid — and the early endings are already told by
their own row.

`ATTACK_EFFECT_PREVENTED { seat, uid }` fires **once per refused op** (Poison Ring's two
clauses would produce two). A silently-skipped attack clause reads to a player exactly
like a bug, which is the same instinct behind the family's "unrecognised text stays
LOUD" rule pointed at a legitimate refusal.

The DAMAGE half needs **no event**: `DAMAGE_DEALT.prevented?: true` has named that FACT
since Safeguard (0.58.0), and the fact is identical whichever prevention did it.

### ⚠️ The only way to Knock Out a shielded Pokémon

The wide reading refuses the placement and the damage half refuses every hit, so the
**only** lethal route to a shielded body is a counter PUT through the **narrow** reading
— which is how the "KO'd while blocked" ordering is driven end to end:
`COUNTERS_PLACED` < `KNOCKED_OUT` < `PRIZES_OWED` to the attacker, stopping at
`ko:takePrizes`.

### The four structural questions

1. **Does the op PARK?** No — `preventDamage` is deterministic, consumes no rng and asks
   nothing. **But the slice bumps `MATCH_RECORD_VERSION` anyway, and for D124's reason
   rather than D140's**: the new REQUIRED field is on `InPlayPokemon`, so every Pokémon
   in play in an old record lacks it. It would read back **benignly** (`undefined.turn`
   is never `state.turn`, and no such block could have been installed by a deploy with
   no op to install one) — which is exactly the soft landing that constant exists to
   refuse, and the reason D124 bumped on the identical shape. `EffectContext.invokedBy`
   is OPTIONAL and therefore a WIDENING (D125's distinction), asked about explicitly.
2. **Whose VOICE?** `ATTACK_BLOCK_APPLIED` and `ATTACK_EFFECT_PREVENTED` both file under
   the seat owning the affected Pokémon, and in both cases that Pokémon is also the
   causer's — so both are ACTIVE-voiced, the mirror of D136's finding 1 and of D141's
   mirror of it.
3. **Is the guard ASSERTED?** Yes, and SWEPT rather than listed (D140's move). The suite
   DISCOVERS every op kind any attack in `FIXTURE_POOL` can produce — walking
   `coinFlipGate` bodies, since this whole family hides inside one — and asserts the §11
   classification is TOTAL over the discovered set **in both directions**, so a slice
   that teaches the deriver a new op fails here until it has said which side of the
   reading that op falls on, and the table cannot rot into a list of ops nothing emits.
4. **Does the mechanism exist?** It did not, and this slice is it. `preventDamageFromExV`
   was read first, as the list asked: an UNDURATED catalog aura on the holder, gated on
   the ATTACKER's rule box, read at four sites. What a DURATION costs on top of that is
   one turn-stamped state field, one `continuous.ts` reader, three early clears, a
   provenance channel and a `MATCH_RECORD_VERSION` bump — and the two now sit on the
   same `||` at all four of those sites.

### The suite — `preventBlock.test.ts` (32 tests)

Its own `PREVENT_BLOCK_DECK`, because this family takes a coin and sharing a deck with a
seed-free suite would make that suite's determinism a coincidence. Every board is
reached through real actions across at least one turn boundary. Two new fixtures:
**Scyther `sv03-004`** (the wide reading, `{C}` cost, printed **10** alongside the
install — a D125 tail board — with "Cut" at index 1 as the same-cost control) and
**Togedemaru `sv03-151`** (the narrow one, no printed `damage` at all, ×2 Fire weakness
AND a −30 Grass resistance so a blocked hit is shown to be 0 rather than 0 by
coincidence). The heads/tails seed tables are **measured and pinned by their own case**,
so a deck edit that reshuffles the suite fails loudly instead of turning every
cross-turn assertion vacuous.

**Mutation-checked seven ways:** reusing D112's paralysis clock fails **12**, stamping
the installing turn fails **12**, dropping the main-hit block fails **5**, ignoring
`effects` fails **5**, dropping `invokedBy` fails **2**, skipping the leaves-the-Active
clear fails **1**, system-voicing the install row fails **1**.

`clauseApostrophe.test.ts`'s DISCOVERED census moved **36 → 38** the moment the fixtures
landed — two apostrophe-bearing sentences, swept by a suite neither regex was written
with open. **No witness needed re-pointing**: nothing had listed either sentence as a
stays-LOUD near-miss, and the two that name neighbours (`coinFlipDamage`'s Squawkabilly
case, `publicCount`'s Palafin "Oracle Press") are both still correctly LOUD.

### Verification

`bun run check` **GREEN exit 0 — 184 files / 2993 tests** (was 183 / 2960).
engineVersion 0.90.0 → **0.91.0**; `MATCH_RECORD_VERSION` **3 → 4**. ZERO new prompts,
parks, clause-table rows, `BoardCondition` members, error codes, registry rows or redact
arms; no `rng.ts`/`cardplay.ts`/`registry.ts` diff and no web/DB/`@luminous/schema` diff
beyond the one constant.

### Still unmapped after D142 — ranked by cost

The heal census (D133/D135), the gated census (§D134), the counter-damage censuses
(§D138/§D139/§D140), the §9 recoil census (§D141) and now **the PREVENT + DURATION
census above** are all CLOSED. Do not re-run any of them.

- **Ninetales `sv03-029`/`-199` "Nine-Tailed Dance" — 2 printings / 1 clause.**
  `Put {N} damage counters on 1 of your opponent's Pokémon. During your next turn, this
  Pokémon can't attack.` **Now the cheapest real item on the list.** Sentence one is a
  one-token widening of D140's anchor (`damageChosen { target: "opponentAny" }`, which
  exists and already carries `source`); sentence two is a SELF-lock with a duration, and
  **the whole duration mechanism is now built** — it costs a second stamped field
  (`state.turn + 2`, its own window, which is why it cannot share `attackBlock`'s
  `turn`), one read at the §8 attack gate, one clear site set and one event. **No new
  concept.**
- **The §9 recoil FAMILY — 5 printings, mapped and priced by §D141.**
  - **Vengeful Punch `sv03-197`** (Tool, 4 counters, KO-conditioned) — a new READ SITE
    (the §8.1 sweep) and a `damageAttacker` sibling field. The only one needing no
    duration; cheapest of the three.
  - **Lycanroc ex `sv02-117`/`-241` "Scary Fangs"** (10 counters, attack-installed) —
    **now a row on D142's mechanism**: a third stamped field read at `attack.ts`'s
    existing §9 recoil site, SUMMED into the number `passivesOf` already returns, and
    reusing D141's `"counterattack"` label with **no new `COUNTERS_PLACED` member** —
    which is the test D141 set for its own axis.
  - **Mabosstiff `sv02-143` "Comeuppance"** — the same, **plus** the amount read off the
    damage done to the holder, which is the §9.2 channel below.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged: a channel from
  the §8.5 pipeline's RESULT into a tail op. Mabosstiff and Grimmsnarl `sv02-148`
  ("Accelerate", the KO-conditioned PREVENT printing) want the same channel, so **four
  cards may be one mechanism rather than four**. Note Iron Moth's index-1 "Anachronism
  Repulsor" is ALSO a PREVENT printing, on the attacker-class filter.
- **The attacker-CLASS filter — 4 printings / 2 clauses.** `…prevent all damage done to
  this Pokémon by attacks from [Basic|Ancient] Pokémon.` UNGATED, so no coin; one
  optional field on `preventDamage` plus a predicate over the ATTACKER's card. `Basic` is
  `isBasicPokemon` verbatim; `Ancient` has no reader at all. The cheapest widening of
  this slice's own op.
- **The `takes {N} less damage` family — 14 printings / 4 amounts** (`During your
  opponent's next turn, this Pokémon takes {20|30|50|100} less damage from attacks (after
  applying Weakness and Resistance).`). A DURATED `damageReductionAfterWR`, i.e. this
  slice's stamp carrying a NUMBER instead of a boolean, read at the same four sites one
  line below the block. **The largest un-taken count left in the whole tail**, and the
  first item that would justify generalising `attackBlock` into a record with several
  installed effects rather than a fourth parallel field.

## D143 — the SELF-LOCK: `During your next turn, this Pokémon can't attack.` (engine 0.92.0, MATCH_RECORD_VERSION 4 → 5)

Item 1 of D142's remainder list, and the slice that shows what that list was FOR:
the duration mechanism D142 bought is reused here with **no new concept at all**,
and the only genuinely new thinking is **one number**. It is also the slice whose
item was wrong in the most useful direction yet — it was priced at 2 printings and
it is **22**.

### The resume point's claims, checked before anything was designed

Every CATALOG claim held, exactly. The count did not, and the one STRUCTURAL claim
the item made about cost was false.

| Claim | Verdict |
|---|---|
| Ids `sv03-029`/`-199`, 2 printings / 1 clause | **TRUE** (Uncommon + Illustration rare, one attack in two rarities — D121's second-printing warrant met by the card) |
| Attack name "Nine-Tailed Dance" | **TRUE** |
| Attack INDEX | **TRUE at 1** — checked rather than assumed. Index 0 is "Will-O-Wisp" ({R}, 20, no effect), and a suite that assumed 0 would have simulated the wrong attack (D139's Pour Tea, again) |
| 9 counters, `{R}{R}`, no printed `damage`, the printed string verbatim | **TRUE**, all four |
| "sentence two is a SELF-lock with a duration, and D142 built the duration" | **TRUE**, and the only forecast on two lists running that was right about cost |
| "`state.turn + 2` … which is exactly why it cannot share `attackBlock.turn`" | **TRUE**, and the list was right to flag it. **Verified by a real drive rather than on paper**, as the item demanded |
| "one read at the §8 attack gate, the same three early-clear sites and one event" | **TRUE**, and complete for the LOCK half |
| "sentence one is a ONE-TOKEN WIDENING of D140's anchor … which exists" | **⚠️ HALF TRUE, and the half that is false is real work.** The OP exists; the interpreter path does not. See below |
| *(ABSENT)* the count | **⚠️ 2 → 22.** The bare sentence is 20 more printings |
| *(ABSENT)* the `MATCH_RECORD_VERSION` question | **⚠️ MISSING, and the answer is a BUMP** — 4 → 5, D142's own case on a second field |
| *(ABSENT)* the two PROJECTIONS | **⚠️ MISSING, and both are load-bearing.** A §8 gate that refuses a DECLARATION owes `redactedAttacksOf` and GameHud, or a locked player gets a button the server rejects |

**Eight consecutive lists, and this is the first whose miss makes the item TEN
TIMES BIGGER.** The pattern is otherwise unchanged: the catalog claims are
reliably right, the structural ones are not, and the most dangerous is the absent
one.

### The census (local D1, 2026-08-02, 978 cards) — run for THIS question

**D142's rule applied to D142's own census.** The duration table in §D142 was
built from `attacks_json LIKE '%During your opponent's next turn%'` and is
perfectly correct for that — which is exactly why it **structurally cannot see
this sentence**, whose duration says *your*. It lists "an attack lock (4 + 1)" for
this neighbourhood; that is the OPPONENT-side printing and the Seismitoad buff.
The self-lock is not on it at all.

`attacks_json LIKE '%can''t attack%'` plus the same query over `abilities_json`
and `effect` — **38 printings in all**: 33 on attacks, 2 on an Ability (Slaking V
`swsh10.5-058`/`-077` "Kinda Lazy", a Prize-count CONDITION with **no duration**),
3 on a Trainer (Geeta `sv03-188`/`-218`/`-226`, *"During THIS turn, YOUR POKÉMON
can't attack"* — a different turn and a whole board).

Inside the attacks, the **SELF-lock family is 29 printings across FIVE sentences**:

| Sentence | Printings | Status after D143 |
|---|---|---|
| `During your next turn, this Pokémon can't attack.` | **20** | ✅ `SELF_CANT_ATTACK_NEXT_TURN` → `preventAttack` |
| `Put {N} damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.` | **2** | ✅ `COUNTER_PUT_ANY_THEN_SELF_LOCK` → `damageChosen` + `preventAttack` |
| `Flip a coin. If tails, during your next turn, this Pokémon can't attack.` | 5 | ❌ a **TAILS** gate — `coinFlipGate` runs its body on HEADS only. **The cheapest widening of this slice** |
| `You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack.` | 1 | ❌ an OPTIONAL damage bonus whose acceptance installs the lock — a player decision in FRONT of the §8.5 pipeline (Copperajah `sv06.5-042`) |
| `Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.` | 1 | ❌ TWO consequents on ONE flip (Dragonite ex `sv03-159`) — D142's Squawkabilly refusal in another family |

The twenty mapped BARE printings: Miraidon ex `sv01-081`/`-227`/`-244`/`-253`
"Photon Blaster", Koraidon ex `sv01-125`/`-231`/`-247`/`-254` "Wild Impact",
Dragonite VSTAR `swsh10.5-050`/`-081` "Giga Impact", Alomomola `sv01-048` "Aqua
Slash", Clawitzer `sv01-050` "Aqua Cannon", Steelix `swsh10.5-044` "Iron Buster",
Kilowattrel `sv02-082` "Jet Wing", Tinkatuff `sv02-103` "Boundless Power", Victini
ex `sv03-033` "Victory Flame", Crabominable `sv03-115` "Knuckle Impact", Umbreon
`sv03-130` "Pitch-Black Blade", Probopass `sv03-146` "Iron Buster", Golbat
`sv06.5-028` "Pitch-Black Blade". **Every one carries a printed `damage`** (80 to
250) — the sentence is the DRAWBACK half of a big-damage attack, which is why the
compound printing (no `damage` at all) is the family's odd one out rather than its
model.

**Two neighbourhoods refused, and each is a FIELD WARRANT written down:**

| Neighbour | Printings / sentences | What it would cost |
|---|---|---|
| The OPPONENT-side lock — `…the Defending Pokémon can't attack.` (Eiscue ex `sv03-042`/`-210`/`-222` "Scalding Block") and `If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.` (Houndoom ex `sv03-134`) | **4 / 2** | a `target` field — **and NOT a one-token one**: the defender-side window is `state.turn + 1` where this is `+ 2`, so it is TWO axes |
| The PER-ATTACK lock — `During your next turn, this Pokémon can't use {AttackName}.` (Munkidori ex `sv06.5-037`/`-083`/`-091`, Lucario `sv01-114`, Radiant Charizard `swsh10.5-011`, Radiant Blastoise `swsh10.5-018`, Skarmory `sv03-142`, Greedent ex `sv03-179`) | **8 / 6** | a per-ATTACK lock this field cannot express — it names ONE attack and leaves the card's other one legal |

One more sentence shares the duration and is neither: Seismitoad `sv03-052`
"Echoed Voice", a durated BUFF on one named attack. All 13 refusals are LOUD, each
written beside the property that refuses it.

### ⚠️ The "+2", verified by DRIVING it

The item flagged this and it was right to. Declaring an attack ENDS the turn
(§5.3), so the turn after the installing one belongs to the OPPONENT and the one
after that is the installer's own. D142's block prints *"during your OPPONENT's
next turn"* and stamps `+ 1`; this prints *"during YOUR next turn"* and stamps
`+ 2`.

**Every other durated printing in the pool says the opponent's**, which is exactly
why `+ 1` is the shape a session copying the neighbour writes — and the failure is
QUIET IN PLAY rather than loud: a `+ 1` lock is live only on a turn its holder
could not have acted on anyway, so the card's entire printed drawback silently
disappears and nothing on the board looks wrong.

| Moment | `state.turn` | Locked? | Why |
|---|---|---|---|
| The install resolves (attack tail, turn N) | N | **no** | the printed word is "NEXT" |
| Checkup ending turn N (`endedSeat` = holder) | N | **no** | …and nothing clears it here, exactly as D142 |
| The opponent's whole turn N+1 | N+1 | **no** | not the holder's turn; the OPPONENT attacks normally |
| The holder's turn N+2 | N+2 | **YES** | the printed window — **BOTH** of the holder's attacks are refused |
| The holder's turn N+4 onward | ≥ N+4 | **no** | expired by arithmetic; the stale stamp stays and answers nothing |
| The holder leaves the Active Spot | — | **no** | §10 — and here BOTH halves are reachable |
| The holder evolves | — | **no** | §10 — **and this one is a LINE OF PLAY**, not an unreachable rule |
| The holder is Knocked Out | — | — | the stack leaves play; the promoted body carries no lock |
| Installed twice | — | the later stamp | two installs are always ≥ 2 turns apart by construction |

Driven, not asserted: install on turn 2 → stamp **4** → turn 3 untouched → turn 4
refuses index 1 AND index 0 → turn 6 attacks again and stamps 8.
**`+ 1` fails 14 tests.**

### ⚠️ A SECOND stamped field, not a widening of the first

`InPlayPokemon.attackLockedTurn: number | null`, beside `attackBlock` rather than
inside it, **because the two windows are different NUMBERS on the same body** —
one `turn` could hold at most one of them. Asserted on a real board rather than in
prose: a case installs the lock for real, surgeries D142's block onto the same
Pokémon, and drives turn 3 (damage prevented, lock inert) and turn 4 (block
expired by arithmetic, holder refused). **Folding the lock into `attackBlock.turn`
fails 8 tests.**

Everything else is INHERITED unchanged: the stamp convention, the
read-through-`continuous.ts` shape (`attackLocked`), the three §10 early clears,
and D124's no-defensive-`undefined` rule at the reader.

**⚠️ IT NEEDS NO PROVENANCE CHANNEL, AND THAT GENERALISES.** D142 had to invent
`EffectContext.invokedBy` because *"effects of ATTACKS"* is a claim about what
INVOKED an effect and the target cannot answer it. This field is read at
`attack.ts`'s §8 gate and at the two payability projections — **all three by
construction about declaring an ATTACK** — so there is exactly one kind of thing
it can refuse and nothing to disambiguate. **A durated effect does not
automatically owe a provenance; only one that gates an OP does.**

### ⚠️ It gates a DECLARATION, so it is a rejection — and that makes the projections load-bearing

New error code `ATTACK_PREVENTED`, `RETREAT_PREVENTED`'s exact mirror. §12's
Asleep gate refuses the declaration while §12's Confusion flips at resolution, and
*"can't attack"* is the first kind: **nothing is spent and the turn does NOT
end**. An `ATTACK_FAILED` here would burn the player's whole turn on a button the
server had already decided to refuse.

Which means **two projections owe the same line**, and this is the ABSENT claim
that cost the slice its "no web diff":

- `redactedAttacksOf`'s `banned` (redact.ts) — the online HUD's `playable`;
- `GameHud.tsx`'s `disabled` — the local /play path, which computes the same
  thing off raw `GameState`.

Both are the only thing between a locked player and a rejected button. **Dropping
the redact line fails 1 test; dropping the §8 gate fails 9.** The suite sweeps
BOTH attacks in both directions rather than sampling.

The REFUSAL needs no event (the rejection carries a code and a message, and the
action never happened); the INSTALL gets one — `ATTACK_LOCKED { seat, uid }`, in
the **ACTIVE** voice for `ATTACK_BLOCK_APPLIED`'s reason (`seat` owns the locked
Pokémon and that Pokémon is the actor's own). Its WORDING is pinned as tightly as
its voice, because it is **the only durated row in the engine that reports a cost
the player paid rather than a protection they bought**. No `…_ENDED` twin, for
D142's reasons verbatim. **System-voicing it fails 1 test.**

### ⚠️ The §10 early clears are D142's with the REACHABILITY INVERTED

D142's evolve clear was unreachable by construction — its window is the opponent's
turn, and nobody evolves on someone else's. **This window is the HOLDER's own**,
so all three routes are lines of play:

- **EVOLVING** frees a locked Pokémon to attack the SAME turn (§10 sheds the
  effects of attacks). Driven end to end with **no surgery** — which is what the
  slice's one invented fixture, `fix-mola-stage1`, exists for. D142 could only
  pin its equivalent with a state surgery.
- **RETREATING**, then **Switching back in**, then attacking: three legal actions
  on one turn, and the drawback is gone.
- **A Boss's Orders** from the opponent un-locks a body they were trying to keep
  off the board — the gift they did not mean to give.

Each fails **2** tests when skipped. All three stay SILENT (the
`POKEMON_SWITCHED` / `RETREATED` / `POKEMON_EVOLVED` row already tells the story —
D112's own call).

**⚠️ AND THE THREE SITES ARE SWEPT RATHER THAN LISTED, WHICH IS ALSO THE
GENERALISATION EVIDENCE.** They are three hand-written object literals in two
files (`clearOnLeavingActive` and `placeEvolution` in turn.ts, `switchInto` in
interpreter.ts) with nothing making them agree. One case encumbers a Pokémon with
every §10-sheddable field and asserts all three routes shed the SAME set — the
thing that fails if a fourth stamped field forgets one.

### ⚠️ It locks the POKÉMON, not the ATTACK

Pinned FROM THE INSIDE rather than by a refusal list: Alomomola's index-0 "Surf"
is refused by the lock its index-1 "Aqua Slash" installed. That is the assertion
separating this family from the eight `can't use {AttackName}` printings, which
leave the card's other attack legal and stay LOUD.

### ⚠️ One thing the item called free was NOT — the third "guard that is an accident" in five slices

Sentence one of the compound was priced as *"a one-token widening of D140's anchor
(`damageChosen { target: "opponentAny" }`, which exists and already carries
`source`)"*. The OP exists. **The interpreter path did not.**

Every put-counter snipe in the pool was Bench-only, so `placeSnipe`'s Active
branch was reached only with `deals === true` — and it said so **in a comment,
asserted nowhere**. That is the D139 → D140 shape for a third time: a guard that is
an accident of the candidate sets. Ninetales' *"1 of your opponent's POKÉMON"* is
the first printing to offer the Active to a **PLACEMENT**, and routing it through
`snipeActive` would run the full §8.5 pipeline over a placed counter — **doubling
it on a Weakness and cutting it on a Resistance**, against this engine's standing
ruling since D138/D139 that a placed counter is not attack damage and that being
printed on an attack does not make it one.

The fix **REUSES `damageActive`** rather than writing a second flat-placement
path: that function is already *"flat counters onto the opponent's Active,
D142-guarded, `source` off the op"*, which is this arm to the byte, and the only
difference is how the target was named. D131's widen-don't-add rule applied to a
FUNCTION instead of a field. **Routing the placement through `snipeActive` fails 2
tests; setting `deals: true` fails 4.**

There is deliberately **no bare any-zone anchor**: `Put {N} damage counters on 1 of
your opponent's Pokémon.` is printed **nowhere** in the pool as a standalone
attack sentence. Every other printing of that noun phrase is an ABILITY (Dusclops
`sv06.5-019`/`-069`, Dusknoir `sv06.5-020`/`-070` "Cursed Blast"), refused by the
capitalised "Put" plus `^…$` exactly as D139/D140's anchors refuse theirs.

### ⚠️ Two sentences, ONE anchor, two ops in printed order

`DEFENDER_POISON_CANT_RETREAT`'s shape (D125's two-consequent question, same
answer). Matching sentence one as a PREFIX would place the counters and silently
drop the drawback — **shipping an attack the catalog does not print**, which is
strictly worse than leaving the card LOUD. The order is also the only one that
reads right in a log, since sentence one can Knock the target Out; and because the
counters PARK, this is the family's first op sitting BEHIND a park.

**Dropping the second op fails 6 tests; reversing the order fails 6.**

### The four structural questions

1. **Does the op PARK?** `preventAttack` does not — it is deterministic, consumes
   no rng and asks nothing; and a new UNION MEMBER is a WIDENING (D125). The other
   op in the program, `damageChosen`, **does** park, but gained no field, so every
   serialized `EffectContinuation` is byte-identical. **The bump is D142's case
   again**: a new REQUIRED field on `InPlayPokemon` that would read back BENIGNLY
   (`undefined === 4` is false, so an old record resolves to "not locked" — even
   correctly). **`MATCH_RECORD_VERSION` 4 → 5**, the third bump on the identical
   shape (D124's `promotedTurn`, D142's `attackBlock`, this).
2. **Whose VOICE?** `ATTACK_LOCKED` files under the seat owning the locked
   Pokémon, and that Pokémon is the actor's own — ACTIVE voice, D142's case. What
   is NEW is the content: it reports a COST rather than a protection, so the
   wording is pinned as tightly as the seat.
3. **Is the guard ASSERTED?** Three ways, all swept rather than listed: the three
   §10 clear sites are shown to shed the same field set; both projections are
   swept attack-by-attack against the real gate; and the "only attacking is
   gated" claim is driven over the whole turn:action vocabulary (attach, bench,
   retreat, trainer, end turn) in both directions. `preventAttack` also had to be
   classified in D142's own `preventBlock.test.ts` table before it would go green
   — which is that table working as designed, one slice later.
4. **Does the mechanism exist?** For the LOCK, yes, and D142 built it — this is
   the first slice in the tail whose headline mechanism cost nothing. For sentence
   ONE, **no**: the op existed and its Active PLACEMENT path did not.

### The suite — `attackLock.test.ts` (32 tests)

Its own `ATTACK_LOCK_DECK`, and for the OPPOSITE reason to
`PREVENT_BLOCK_DECK`'s: that family takes a coin and needed a seed sweep, while
**this one takes none** — so the suite is **seed-free** and pins that by an
unchanged `rngState` across a whole park-and-resolve. Three fixtures: **Alomomola
`sv01-048`** (the bare sentence, printed **120** alongside the lock — a D125 tail
board — with index-0 "Surf" as the sibling the lock also refuses), **Ninetales
`sv03-029`** (the compound, INDEX 1, no printed damage, a Stage 1 surgeried in),
and **`fix-mola-stage1`** (the one invented card, so the §10 evolve clear is a
drive rather than a surgery).

**Mutation-checked fourteen ways:** `+ 1` instead of `+ 2` fails **14**, dropping
the §8 gate **9**, sharing `attackBlock.turn` **8**, dropping the compound's
second op **6**, reversing its op order **6**, `deals: true` on the counter half
**4**; then **2** each for the three §10 clears, the `snipeActive` misroute, the
dropped `['’]` class and a lock that never expires; and **1** each for the redact
projection line and a system-voiced install row.

`clauseApostrophe.test.ts`'s DISCOVERED census moved **38 → 40** the moment the
fixtures landed — and these are the first entries whose exposed slot is a
CONTRACTION (`can't`) rather than a possessive, which is precisely the asymmetry
D137 found two whole tables missing. **Three witnesses re-pointed, none deleted**:
`counterPut`, `counterBenchPut` and `counterMove` all listed the Ninetales
sentence as a stays-LOUD near-miss, and all three moved to still-unmapped real
catalog rows (Kingambit `sv03-150`, Annihilape ex `sv02-242`, Lycanroc ex
`sv02-117`).

### ⚠️ The generalisation question — answered with three readings in hand

The list asked for this explicitly, and said to take item 1 first *"so the
decision is made with three readings in hand rather than one guessed at"*. With
D142's block built, this lock built and the `takes {N} less damage` family
specced:

**The two BUILT readings share almost nothing beyond the stamp.**

| | `attackBlock` (D142) | `attackLockedTurn` (D143) |
|---|---|---|
| Window | `state.turn + 1` | `state.turn + 2` |
| Gates | what may be done TO the holder | what the holder may DO |
| Read sites | 4 damage sites + 6 effect ops | 1 action gate + 2 projections |
| Refusal shape | a nulled RESULT + an event | an ILLEGAL ACTION + an error code |
| Provenance | needs `EffectContext.invokedBy` | cannot use one, and needs none |
| Payload | a boolean (`effects`) | nothing |

**So a record of installed effects would buy exactly two things:** the three §10
clear sites stop being hand-written literals, and the `MATCH_RECORD_VERSION` bump
happens once instead of once per field. It would cost a discriminated union, a
lookup at every read site (where today each site names its own field and the
compiler checks it), and a persisted shape change. **On two readings that is a
LOSS**, and the one hazard it removes is already covered by the swept clear-set
test written here.

**The trigger is named rather than left to judgement: a THIRD field makes it a
win, and item 4 is that third.** The `takes {N} less damage` family (14 printings)
is a NUMBER rather than a boolean, read at the **same four damage sites** as
`attackBlock` one line below it — so it is the first reading that would genuinely
SHARE a read path, which is the thing a union pays for. **Take the generalisation
WITH item 4, not before it and not instead of it**, and note that the
generalisation is itself a required-shape change (one more bump) after which
further durated effects cost none.

### Still unmapped after D143 — ranked by cost

The heal census (D133/D135), the gated census (§D134), the counter-damage censuses
(§D138/§D139/§D140), the §9 recoil census (§D141), the PREVENT + `During your
opponent's next turn` census (§D142) and now **the `can't attack` census above**
are all CLOSED. Do not re-run any of them.

- **The TAILS gate — 5 printings / 1 sentence.** `Flip a coin. If tails, during
  your next turn, this Pokémon can't attack.` (Oinkologne `sv01-157`, Oinkologne
  ex `sv01-158`/`-234`, Paldean Clodsire ex `sv02-130`/`-244`). **Now the cheapest
  item on the list**: `coinFlipGate` runs its body on HEADS only, so this is ONE
  optional field on that op (`onTails?: true`) or one sibling member, plus one
  regex, plus the deriver arm. The op it gates is already built.
- **The attacker-CLASS filter — 4 printings / 2 clauses** (`…prevent all damage
  done to this Pokémon by attacks from [Basic|Ancient] Pokémon.`). Unchanged from
  §D142: one optional field on `preventDamage` plus a predicate over the
  ATTACKER's card. `Basic` is `isBasicPokemon` verbatim; `Ancient` has no reader.
- **The OPPONENT-side attack lock — 4 printings / 2 clauses.** Eiscue ex
  `sv03-042`/`-210`/`-222` "Scalding Block" (behind a self Energy discard, so it
  is a two-sentence anchor like Ninetales') and Houndoom ex `sv03-134` "Evil Claw"
  (behind a Basic-ness predicate, with the duration at the END of the sentence).
  Earns `preventAttack` its `target` field — **two axes, not one**, since the
  defender-side window is `+ 1`.
- **The `takes {N} less damage` family — 14 printings / 4 amounts, still the
  LARGEST un-taken count.** A DURATED `damageReductionAfterWR`. **⚠️ TAKE THE
  `attackBlock` GENERALISATION WITH IT** — see the table above; it is the first
  reading that shares a read path with an existing stamped field, which is what
  makes a union pay.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142. Vengeful
  Punch `sv03-197` (a Tool, KO-conditioned, no duration — cheapest of the three),
  Lycanroc ex `sv02-117`/`-241` "Scary Fangs" (a stamped field summed into
  `passivesOf`'s number), Mabosstiff `sv02-143` "Comeuppance" (the same plus the
  §9.2 channel).
- **The PER-ATTACK lock — 8 printings / 6 sentences.** `During your next turn,
  this Pokémon can't use {AttackName}.` A per-attack lock, so the state is an
  attack INDEX (or a name) beside a turn — the first durated field that is not a
  bare stamp. Note Seismitoad `sv03-052`'s durated per-attack BUFF wants the same
  addressing, so two shapes may be one mechanism.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged: a
  channel from the §8.5 pipeline's RESULT into a tail op, shared with Mabosstiff,
  Grimmsnarl `sv02-148` and Copperajah `sv06.5-042`'s "if you do". Do it last or
  not at all.

## D144 — the TAILS GATE: `Flip a coin. If tails, during your next turn, this Pokémon can't attack.` (engine 0.93.0, MATCH_RECORD_VERSION unchanged at 5)

Item 1 of D143's remainder list, and **the cheapest slice this tail has taken**:
D132's inventory rule on BOTH halves at once. The consequent (`preventAttack`) is
D143's, the gate (`coinFlipGate`) has spliced a branch into the work queue since
0.x, and the only thing that did not exist is **which FACE unshifts it**. One
optional field, one regex, one deriver arm, one comparison.

### The resume point's claims, checked before anything was designed

Every CATALOG claim held. The ONE structural claim was false — and it was the
claim the whole design call had been priced on.

| Claim | Verdict |
|---|---|
| Ids `sv01-157`, `sv01-158`/`-234`, `sv02-130`/`-244`; 5 printings / 1 sentence | **TRUE**, all five, and the printed string is byte-exact |
| "The op is built — D143's `preventAttack`, gate and clears included" | **TRUE**, and complete: no `types.ts` / `continuous.ts` / `turn.ts` / `attack.ts` / `redact.ts` diff was needed |
| "the ONLY missing piece is that `coinFlipGate` runs its body on HEADS only" | **TRUE** |
| "the cost is ONE optional field … or one sibling member, ONE regex and ONE deriver arm" | **TRUE**, and it is the field — see below |
| "⚠️ `attack.ts` reads `coinFlipGate` directly (D130's `programPerHeads` expansion lives there too) so **read that code before pricing it**" | **⚠️ FALSE, and the item was right that it had to be read.** `attack.ts` NEVER reads this op. See below |
| *(ABSENT)* the attack NAMES | **⚠️ MISSING** — "Leg Stomp", "Heavy Stomp", "Needle Bone" |
| *(ABSENT)* the attack INDEX | **⚠️ MISSING, and it is NOT CONSTANT** — 1 on the three Oinkologne printings, **0** on the two Clodsire ones |
| *(ABSENT)* the `MATCH_RECORD_VERSION` question | **MISSING; the answer is NO BUMP** (an optional field is a widening), and the question is real because a gate behind a park is persisted |
| *(ABSENT)* whether the tails shape GENERALISES | **MISSING, and it does** — 3 sentences / 8 printings, two of them one arm away |

**NINTH consecutive list carrying something wrong, and the FIRST whose miss made
the item CHEAPER rather than dearer.** The pattern is otherwise unchanged: the
catalog claims are reliably right, the structural ones are not, and the most
dangerous is the absent one.

### ⚠️ `attack.ts` DOES NOT READ `coinFlipGate` — the item's own warning, discharged

The item said to read the code, so it was read, and the answer is the opposite of
what it warned about. `attack.ts`'s coin family is **`deriveAttackCoinFlip`'s own
union** — `bonusOnHeads` / `cancelOnTails` / `perHeads` / `programPerHeads` — read
at a DIFFERENT site, in FRONT of the §8.5 pipeline, precisely because those
members retract or fold DAMAGE and an `EffectOp` runs at the function's TAIL
(D125's placement rule, stated in that file at length). **`programPerHeads` is a
member of THAT union, not of this op.** The three mentions of `coinFlipGate` in
`attack.ts` are comments explaining exactly that disjointness — *"disjoint … from
`deriveAttackEffect`'s `coinFlipGate` programs by its CONSEQUENT"*.

So the op has **exactly TWO real readers**:

| Reader | What the field costs it |
|---|---|
| `runProgram`'s splice (interpreter.ts) | ONE comparison — `face === (op.onTails === true ? "tails" : "heads")` |
| `programPlayable`'s descent (cardplay.ts) | **NOTHING** — the argument is face-agnostic (below) |

`log.ts` handles the EVENT, not the op; `withConsequence` scans only `recordGate`
branches; `registry.ts`'s four authored gates are all heads and gain no key.

### ⚠️ A FIELD, NOT A SIBLING MEMBER — D131's test, decided on the census

Everything downstream of the face is byte-identical: the coin is TAKEN on both
faces (`coinFlipGate` flips first and splices second, so `rngState` advances
either way and an online match cannot desynchronise), the same
`ATTACK_EFFECT_COIN_FLIP` row is emitted either way, the branch is spliced by the
same `unshift` so an op inside it can still PARK, and the descent is
face-agnostic. That is D131's test passing.

**What a sibling member would have cost**, written down rather than asserted: a
second op in the vocabulary, a duplicated descent in `programPlayable`, a new row
in `preventBlock.test.ts`'s op-classification table (which is TOTAL over the
discovered op set and fails until a new op is classified), a new arm in the
interpreter's unreachable-gate `case` list, and a choice to make every time a
future gated sentence is mapped — all to carry ONE boolean.

**ABSENT, never `false`** (D135's rule): derived shapes are compared by value
against hand-authored registry rows (`{ op: "coinFlipGate", then: [{ op: "gust" }] }`
— Pokémon Catcher), and an explicit `onTails: undefined` is not `toEqual`-identical
to an absent one. Swept over the whole pool + registry rather than asserted at one
site.

### The census — the TAILS FACE as its own question (local D1, 2026-08-02, 978 cards)

**D142's rule applied to D143's census.** That slice counted these five printings
as REFUSALS of the *"can't attack"* question, which is correct for that question
and says nothing at all about how the FACE generalises. Run properly:
`attacks_json LIKE '%if tails%'` → **26 printings / 8 sentences**, plus 2 on a
Trainer (`effect`) and **0** on any Ability — **28 in all**.

| Sentence | Printings | Status after D144 |
|---|---|---|
| `Flip a coin. If tails, this attack does nothing.` | **11** | ✅ ALREADY SIMULATED, by the OTHER reader — `deriveAttackCoinFlip`'s `cancelOnTails` (D126), in front of §8.5 because it retracts damage |
| `Flip a coin. If tails, during your next turn, this Pokémon can't attack.` | **5** | ✅ **`FLIP_TAILS_SELF_CANT_ATTACK` → `coinFlipGate { onTails } → preventAttack` (D144)** |
| `During your opponent's next turn, if the Defending Pokémon tries to attack, your opponent flips a coin. If tails, that attack doesn't happen.` | 4 | ❌ a DURATED gate making the OPPONENT flip on their own turn — not a `coinFlipGate` at all (Dolliv `sv01-022`/`-200` "Apply Oil", Quaxly `sv02-049`/`-206` "Apply Gel") |
| `Flip a coin. If tails, discard all Energy from this Pokémon.` | **2** | ❌ LOUD — **and its consequent op EXISTS** (`SELF_DISCARD_ALL` → `discardEnergy { from: "yourActive", count: "all" }`). Pikachu ex `sv02-063` "Dynamic Bolt" (idx 1, 220), Beartic `sv03-054` "Frost Purge" (idx 1, 170). **ONE regex and ONE arm** |
| `Flip a coin. If tails, this Pokémon also does 60 damage to itself.` | **1** | ❌ LOUD — **consequent op EXISTS too** (`SELF_DAMAGE` → `damageSelf`). Oinkologne `sv03-183` "High-Impact Kick" (idx 1, 160) — a THIRD Oinkologne, a different card from `sv01-157`. **ONE regex and ONE arm** |
| `Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.` | 1 | ❌ TWO consequents on ONE flip (Dragonite ex `sv03-159` "Mighty Meteor") |
| `Flip a coin. If tails, this attack does nothing. If heads, …prevent all damage…` | 1 | ❌ the same (Squawkabilly `sv01-162` "Fly") — D142's refusal verbatim |
| `Flip a coin. If heads, search your deck for a card… If tails, discard a card from your hand.` | 1 | ❌ the same (Slowpoke `sv02-085` "Tail-Fishing") |
| Egg Incubator `swsh10.5-066`/`-087` (a TRAINER) | 2 | ❌ the same shape again — and the reason the face-agnostic `programPlayable` claim has no card to drive |

**⚠️ THE SHAPE GENERALISES, AND ONTO OPS THAT ALREADY EXIST.** Exactly **THREE
SENTENCES / 8 PRINTINGS** are the bare `Flip a coin. If tails, <one consequent>.`
form the field buys, and this slice takes 5 of them; the other two are one regex
and one arm each, which is what settles field-over-member. **The 5 two-consequent
printings are NOT brought closer by the field** — an `onTails` gate still runs
exactly one branch, and an `otherwise` is what those need (D142's refusal).

### ⚠️ The INDEX is not constant across the five printings

| Printing | Attack | Index | Cost | Damage |
|---|---|---|---|---|
| Oinkologne `sv01-157` | Leg Stomp | **1** | {C}{C}{C} | 130 |
| Oinkologne ex `sv01-158`/`-234` | Heavy Stomp | **1** | {C}{C}{C} | 210 |
| Paldean Clodsire ex `sv02-130`/`-244` | Needle Bone | **0** | {D}{C}{C} | 200 |

D139 and D143 each found a non-zero index a list had not mentioned; **this is the
first family that is not internally CONSISTENT**, so a suite pinned to either
number alone would simulate the wrong attack on two of the five. Both fixtures are
in the pool for that reason and every end-to-end case sweeps them. Every printing
carries a FLAT `damage` and no `+`/`×` marker, so `modifierSimulated` (attack.ts)
is untouched and the drawback really is the whole effect text.

### ⚠️ The LOSING face is the one that does something

On every other gated sentence in the pool the payout is on HEADS, so "nothing
happened" and "the coin missed" differ by a board delta. Here they are INVERTED:
**the printed damage lands on both faces and the only witness is the lock row.**
A build that ignored the field would install the drawback on precisely the
declarations that did not earn it — silently, with nothing on the board looking
wrong and the card's whole balance quietly reversed. So both faces are driven end
to end across the turn boundary for every claim:

| Face | Turn 2 (install) | Turn 3 | Turn 4 | Turn 6 |
|---|---|---|---|---|
| **tails** | damage lands, `ATTACK_LOCKED`, stamp **4** | the opponent's, untouched | **BOTH** of the holder's attacks refused (`ATTACK_PREVENTED`) | free, and a fresh coin decides the next window |
| **heads** | damage lands, NO row, stamp `null` | the opponent's | attacks normally | — |

Seeds are a pinned table over [1..40] (`TAILS_SEEDS` 23 / `HEADS_SEEDS` 17),
**shared by both installers** because the install is the first coin either board
draws after setup and every surgery in `armed` is rng-pure — asserted seed by
seed, so a deck edit that reshuffles fails loudly instead of turning the
cross-turn cases vacuous. `PREVENT_BLOCK_DECK`'s scheme, not `ATTACK_LOCK_DECK`'s.

### ⚠️ `programPlayable`'s descent was FACE-AGNOSTIC by argument — now by assertion

`cardplay.ts` descends into a gate's `then` on the strength of *"a coin gate has
no `otherwise`, so its `then` is the only thing the card can ever do"* (D41,
Crushing Hammer). **That argument never mentions which face splices it**, so it
holds for `onTails` unchanged and the field costs no code there. But
true-by-argument is exactly the state D139 → D140 → **D143's `placeSnipe`
comment** were in three slices running, so it is DRIVEN: a constructed
`coinFlipGate` over a `gust` into an empty opponent Bench is refused identically
with and without the field, and playable again on both once the Bench has a body.
**A constructed program is the honest shape here** — the pool's only tails-gated
Trainer (Egg Incubator) is a two-consequent sentence this op cannot express, so
there is no card to drive. Dropping the descent fails 3 tests.

### The four structural questions

1. **Does the op PARK?** `coinFlipGate` never parks itself (it is spliced by
   `runProgram` before the park machinery sees it), but it **can be PERSISTED**:
   a gate sitting behind a parking op rides `EffectContinuation` into
   `phase.cont` and into `MatchRecord`. The question is therefore real and the
   answer is still no bump — an OPTIONAL field is a WIDENING (D125), an old
   continuation simply lacks the key, and "absent" reads as "heads wins", which
   is what every persistable gate before D144 was by construction. That is the
   opposite of the REQUIRED-field-on-`InPlayPokemon` case bumped three times
   (D124, D142, D143), where the TYPE would be a lie whatever it read back as.
   **`MATCH_RECORD_VERSION` stays 5**, written into `match.ts`'s own doc block.
2. **Whose VOICE?** Two rows land on one declaration and they are voiced
   differently on purpose — `ATTACK_EFFECT_COIN_FLIP` is a NEUTRAL fact about the
   actor (*"flipped tails for the effect"*, neutralised for Trainer sharing back
   in M5) and `ATTACK_LOCKED` is the ACTIVE voice reporting a cost just paid, the
   only durated row in the engine that does. **Driven rather than argued**: the
   log was rendered under real names and read in sequence — *"Oinkologne used Leg
   Stomp"* → *"flipped tails for the effect"* → *"Oinkologne can't attack next
   turn"* — and the HEADS declaration produces the coin row and NOT the cost row,
   so the log tells the faces apart even though the board cannot. **No log diff.**
3. **Is the guard ASSERTED?** Three ways, all swept rather than listed: the
   face-agnostic descent (above); `onTails` ABSENT rather than `false` on every
   heads-gated program the engine emits, discovered from `FIXTURE_POOL` + the
   registry so a gate added later is swept the day it lands; and the seed table
   itself, pinned seed by seed on both installers.
4. **Does the mechanism exist?** Yes — and this is the first slice in the tail
   where BOTH halves already existed. What the item warned did not exist
   (`attack.ts` reading the gate) turned out not to exist in the other direction.

### The suite — `tailsGatedOp.test.ts` (24 tests)

Its own `TAILS_GATE_DECK`, for `PREVENT_BLOCK_DECK`'s reason rather than
`ATTACK_LOCK_DECK`'s: **this family takes a real coin**, and sharing a deck with
the seed-free self-lock suite would make that suite's determinism a coincidence of
this one's shuffle — which is exactly the hazard D143 wrote its unchanged-`rngState`
case to pin. Two new fixtures: **Oinkologne `sv01-157`** (INDEX 1, 130, with
index-0 "Ram" as the control AND the sibling attack a locked body is refused) and
**Paldean Clodsire ex `sv02-130`** (INDEX **0**, 200, its card's only attack, kept
as an `ex` with its inert printed Ability — D133's Skeledirge precedent).
**Alomomola `sv01-048` is in the deck as the cross-family control**: D143's BARE
sentence on the same board takes NO coin at all, which is what makes "the flip
belongs to the gate" a claim rather than a property of the shuffle.

**Mutation-checked four ways:** dropping `onTails` from the deriver fails **14**,
reverting `runProgram` to compare against `"heads"` fails **11**, dropping the gate
and deriving the bare op fails **13**, dropping `programPlayable`'s descent fails
**3**.

**One stays-LOUD witness RE-POINTED, none deleted** (D143's habit):
`attackLock.test.ts` listed this exact sentence as its sharpest refusal —
*"`coinFlipGate` runs its body on HEADS only, so this is a field or an op the
engine has not got"* — and the row moved from a NULL to a SHAPE claim (the gated
program's `then` is that file's own anchor output, byte for byte), which is
strictly stronger. `clauseApostrophe.test.ts`'s DISCOVERED census moved **40 →
41** the moment the fixtures landed: the same CONTRACTION slot D143's pair
introduced, on a regex written a whole slice later, swept without anyone having
this file open.

**One catalog correction on the way past**: a D125 comment said the
`cancelOnTails` family is 12 printings. Counted while censusing the face, it is
**11** (Tarountula `sv01-018`, Medicham `sv01-111`, Lechonk `sv01-156`, Alolan
Rattata `swsh10.5-041`, Nymble `sv02-020`, Shinx `sv02-069`, Surskit `sv03-006`,
Darumaka `sv03-034`, Froakie `sv03-056`, Houndour `sv03-131`/`-204`) — fixed with
the eleven ids written in, so the next reader does not have to re-count.

### Still unmapped after D144 — ranked by cost

The heal census (D133/D135), the gated-HEADS census (§D134), the counter-damage
censuses (§D138/§D139/§D140), the §9 recoil census (§D141), the PREVENT +
`During your opponent's next turn` census (§D142), the `can't attack` census
(§D143) and now **the TAILS-FACE census above** are all CLOSED. Do not re-run any
of them.

- **The two remaining TAILS-GATED sentences — 3 printings / 2 sentences, and now
  the cheapest item on the list.** `Flip a coin. If tails, discard all Energy from
  this Pokémon.` (Pikachu ex `sv02-063` idx 1, Beartic `sv03-054` idx 1) and
  `Flip a coin. If tails, this Pokémon also does 60 damage to itself.`
  (Oinkologne `sv03-183` idx 1). **BOTH consequent ops exist and the field is
  built**, so this is two regexes and two arms with no mechanism at all — D134's
  shape on the other face, and its rule (a one-printing sentence is warranted by
  its SHAPE when the shape has members) covers the Oinkologne one. ⚠️ Take them
  TOGETHER; separately the second does not clear D121's warrant.
- **The attacker-CLASS filter — 4 printings / 2 clauses.** Unchanged from §D142/
  §D143: one optional field on `preventDamage` plus a predicate over the ATTACKER's
  card. `Basic` is `isBasicPokemon` verbatim; **`Ancient` has no reader anywhere**.
- **The `takes {N} less damage` family — 14 printings / 4 amounts, still the
  LARGEST un-taken count.** A DURATED `damageReductionAfterWR`. **⚠️ TAKE THE
  `attackBlock` GENERALISATION WITH IT** — §D143's table is unchanged by this
  slice, which added no stamped field at all.
- **The OPPONENT-side attack lock — 4 printings / 2 clauses.** Earns
  `preventAttack` its `target` field — **two axes**, since the defender-side
  window is `+ 1`.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
- **The PER-ATTACK lock — 8 printings / 6 sentences**, unchanged.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.

## D145 — the TAILS-GATED SELF-COSTS: `Flip a coin. If tails, discard all Energy from this Pokémon.` + `Flip a coin. If tails, this Pokémon also does 60 damage to itself.` (engine 0.94.0, MATCH_RECORD_VERSION unchanged at 5)

Item 1 of D144's remainder list, and **the emptiest slice this tail has taken**:
D132's inventory rule with literally nothing left over. The gate has spliced a
branch since 0.x, the `onTails` field is D144's, and both consequent ops have
been read off their BARE printings since 0.x. Two regexes, two arms.

**⚠️ AND THE FAMILY IS CLOSED.** All 3 sentences / 8 printings of the bare
`Flip a coin. If tails, <one consequent>.` shape are now read (D144's 5, this
slice's 3). The other 20 tails printings in the pool are refused by their SHAPE
and none is brought closer by a face.

### The resume point's claims, checked before anything was designed

**The first list in TEN that was right about everything.**

| Claim | Verdict |
|---|---|
| Ids `sv02-063`, `sv03-054` / 2 printings, 1 sentence | **TRUE**, byte-exact effect string |
| Id `sv03-183` / 1 printing — "a THIRD Oinkologne, a different card from `sv01-157`" | **TRUE**, and worth the warning: same NAME, same evolution line (Lechonk), same types, same retreat and even the **same 120 HP** — only the SET and all four attacks differ |
| Attack NAMES "Dynamic Bolt" / "Frost Purge" / "High-Impact Kick" | **TRUE** |
| Costs {L}{L}{C} / {W}{W}{C} / {C}{C}{C}; printed 220 / 170 / 160 | **TRUE** |
| **INDEX 1 on all three** | **TRUE — and checked SEPARATELY per printing**, not once for the family (D144's rule) |
| "Both consequent ops EXIST and the `onTails` field is built" | **TRUE** |
| "two regexes and two deriver arms with no mechanism, no op, no event and no interpreter diff" | **TRUE**, exactly |
| "⚠️ TAKE THEM TOGETHER — separately the Oinkologne one does not clear D121's warrant" | **⚠️ THE CONCLUSION HOLDS, THE REASON DOES NOT.** D134's rule clears it ALONE — see below |
| "⚠️ mind D134's FIXTURE HP TRAP on the recoil one" | **TRUE and load-bearing**: 120 HP vs a 60 recoil is why the self-KO is one `setDamage` away and never an accident |

**What made this list right is not luck and not a change of pattern**: D144 had
already READ the two ops it was pricing, so its remainder list is an artefact
written with the code open. The standing note stands — a list written from
memory is a different thing.

### The consequent censuses (local D1, 2026-08-02, 978 cards) — D142's rule, fourth time

D144's census was run for the **FACE**. These two were run for the
**CONSEQUENTS**, and one of them moved an anchor's justification.

**1. `discard all Energy from this Pokémon` — 10 attack printings, 0 Abilities, 0 Trainers.**

| Form | Printings | Status |
|---|---|---|
| BARE, the whole effect | **4** | ✅ `SELF_DISCARD_ALL` since 0.x — Pawmot `sv01-076`/`-209` "Electro Paws" (230), Raichu `sv02-064`/`-211` "Thunderbolt" (200) |
| TAILS-gated | **2** | ✅ **`FLIP_TAILS_SELF_DISCARD_ALL` (D145)** — Pikachu ex `sv02-063` (idx 1, 220), Beartic `sv03-054` (idx 1, 170) |
| COMPOUND — a SECOND SENTENCE after the discard | **4** | ❌ LOUD — Weavile `sv06.5-014` "Hail Claw" (+ Paralyze), Kyurem `sv06.5-047` "Trifrost" (+ a 3-target snipe), Eiscue `sv02-048`/`-205` "Frigid Block" (+ a durated *takes 100 less damage*) |

**⚠️ A WIDER ANCHOR WOULD SWALLOW FOUR REAL CARDS AND SHIP HALF OF EACH, AND THE
HAZARD IS LIVE.** Eiscue's rider is **item 4 of D144's own remainder list**, so
the day the `takes {N} less damage` family lands, both halves of that string
derive and the compound must *still* not match. The whole-sentence `^…$` is the
entire guard, and the four are now pinned as refusals in TWO suites
(`tailsSelfCost.test.ts` and `attackPark.test.ts`).

A fifth trap the census caught: **four MORE printings say `Move` all Energy from
this Pokémon** (Blissey `sv01-145`, Tropius `sv02-007`/`-195`, Darkrai
`sv03-136`) — a different verb and a different op (`moveEnergy`). A census keyed
on the noun phrase rather than the verb would have counted 14 and called them one
family.

**2. `This Pokémon also does {N} damage to itself.` — 48 printings, 0 Abilities, 0 Trainers.**

**47 BARE** (the pool's most reprinted recoil rider — Skeledirge `sv01-038`,
Magneton, Great Tusk ex, Koraidon ex, Wild Charge / Take Down / Reckless Charge
on a dozen lines) and **exactly ONE gated**, this one. **No heads-gated printing
of either consequent exists anywhere**, which is what licenses both anchors
refusing the heads spelling rather than mapping it. Small fact worth keeping: the
47 print 10/20/30/50/90 and the gated one prints **60**, an amount no bare
printing carries.

### ⚠️ D121's warrant — verified rather than inherited, and it clears more easily

The DISCARD sentence is **2 printings on TWO CARDS FROM TWO SETS**, which is
D139's stronger form of the warrant and clears on its own.

The RECOIL sentence is **ONE printing**, and **D134's rule covers it on BOTH AXES
AT ONCE** — *when a one-printing sentence is an INSTANCE of a shape the engine
already reads, the warrant is owed by the SHAPE, not by the printing*: the GATE
has been read on 5 printings since D144, and the CONSEQUENT on 47 since 0.x.

**So it would have cleared even taken alone.** The list's "TAKE THEM TOGETHER" is
the right call for a *different* reason — one census, one deck, one suite, one
seed table — and that is written down rather than the reasoning copied forward.

### ⚠️ The printed "also" IS the tail placement, and it settles two unstated things

An `EffectOp` runs at `attack.ts`'s TAIL, strictly after the §8.5 pipeline
(D125), which is exactly what *"this Pokémon **also** does 60 damage to itself"*
says. The rows prove it: `ATTACK_DECLARED` → `DAMAGE_DEALT` →
`ATTACK_EFFECT_COIN_FLIP` → `COUNTERS_PLACED`. Two consequences neither sentence
states:

**(a) THE RECOIL IS FLAT.** `damageSelf` writes `active.damage + amount` and
emits `COUNTERS_PLACED` source `"self"`; it never re-enters §8.5, so no Weakness,
no Resistance and no reduction reaches it. **Driven by measurement rather than
argued** — a ×2 Colorless defender doubles the main hit to **320 while the recoil
stays exactly 60**, which a build routing it through the pipeline (or reading it
off `dealt`) cannot pass. This extends D138/D139/D141/D142's flatness rulings for
*placed counters* to the recoil, on the same event and the same argument.

**(b) IT IS STILL PAID WHEN THE MAIN HIT DEALT ZERO.** §11 prevention nulls the
**damage**, not the attack, so the tail program runs regardless. Pikachu ex
declared into Mimikyu `sv02-097`'s Safeguard deals **0** (its 220 would have
swept the 70 HP body off the board) and on a tails **still loses every Energy** —
which is why Pikachu ex rather than a second Beartic is a fixture: `isExOrV`
reads the rule box off the NAME, and this is the only board in the pool where
§8.5 deals nothing while an attack effect resolves.

What does **not** run the program is a CANCELLED attack — D125's requirement gate
and D126's `cancelOnTails` both return in FRONT of it — and no printing of either
sentence carries either clause, the anchors being whole-string.

### ⚠️ The self-KO — D134's fixture-HP trap turned into the case it warns about

Oinkologne `sv03-183` is **120 HP against a 60 recoil**: a fresh body survives it
twice, a body already carrying 60 does not. One `setDamage` away, never an
accident. Driven end to end:

| | tails, primed to 60 | heads, the identical board |
|---|---|---|
| main hit | 160 into fix-titan (survives) | 160 |
| recoil | 60 → **120 of 120** | none |
| sweep | `finishAttack`'s **TWO-seat** §8.1 sweep (flow.ts) | — |
| prize | owed to the **DEFENDER**, `ko:takePrizes` seat `p2` count 1 (no rule box) | — |
| turn | **does NOT end early** — `pending` is `[takePrizes, promote, endTurn, checkup, startTurn]`, no `TURN_ENDED` row | ends normally |
| body | discarded, bench force-promotes | **still standing at 60** |

The two-seat sweep was widened for `damageSelf` back in M5; **this is the first
time it is reached through a GATE**.

### ⚠️ The whiff is SILENT — asked because the family owes the question

`count: "all"` on an empty attachment set files an empty record and returns
`done`: **no `ENERGY_DISCARDED`, no `ATTACK_EFFECT_SKIPPED`, no park.** That is
D134's three states (a tails is not a skipped effect; a run that whiffed is not a
run that never happened) and D140's rule that only an UNREAD sentence is loud.

It is **UNREACHABLE from either printing** — declaring the attack pays a
three-symbol cost and nothing between payment and the tail can strip it — so it
is driven as a **CONSTRUCTED program** rather than pretended into a board
(D144's precedent for its face-agnostic descent). Through the GATE it spends the
coin and still says nothing, which is the combination worth seeing once.

### The four structural questions

1. **Does the op PARK?** **No, and more strongly than D144's answer.** Neither op
   parks on these programs — `discardEnergy { count: "all" }` "asks nothing" and
   resolves inline (interpreter.ts), `damageSelf` places without a decision — so
   **neither derived program can reach `EffectContinuation` at all**, and D144's
   persistence edge (a gate behind a parking op riding into a `MatchRecord`) is
   not merely widened but *unreachable* here. No new op, no new field, no new
   event, no new `InPlayPokemon` key, no log wording. **`MATCH_RECORD_VERSION`
   stays 5**, written into `match.ts`'s own doc block — asked rather than omitted
   precisely because "an arm over an existing field" is the shape a session skips
   the question on.
2. **Whose VOICE?** Driven under real names, **twice**, because the two sentences
   answer differently.
   - *Discard*: "Pikachu ex used Dynamic Bolt" → "dealt 220 damage to fix-titan"
     → "flipped tails for the effect" → **"discarded Lightning Energy ×2,
     fix-energy from Ember's Pikachu ex"**. `ENERGY_DISCARDED` reads from its
     `actor` — the same seat that owns the stripped body for a self-discard — and
     names the owner outright, so a mirror match cannot print two identical rows.
   - *Recoil*: → **"Oinkologne did 60 damage to itself"** → "Oinkologne was
     Knocked Out" → the prize row **under the OPPONENT's seat**.
     `COUNTERS_PLACED` source `"self"` renders in the ACTOR's own ACTIVE voice
     (the attacker CHOSE this attack) rather than as the confusion self-hit's
     system row. The `who` of every row is asserted, not the wording alone.
   **No log diff.**
3. **Is the guard ASSERTED?** Three, swept rather than listed: each gated anchor
   is **mutually exclusive with its own BARE anchor in BOTH directions** (the
   capitalised first word PLUS `^…$`, neither alone sufficient — the gated
   consequent is lowercase and mid-sentence, the bare string has no "Flip a coin."
   prefix); the four COMPOUND discard printings are pinned as refusals in two
   suites; and `tailsGatedOp.test.ts`'s tails-gate sweep now asserts the
   **producer SET** (five ids, discovered from `FIXTURE_POOL` + the registry)
   instead of a two-id predicate, so a sixth producer fails loudly.
4. **Does the mechanism exist?** Read, and yes — the second slice running where
   BOTH halves already existed.

### The suite — `tailsSelfCost.test.ts` (28 tests)

Its own `TAILS_SELF_COST_DECK`, for `TAILS_GATE_DECK`'s reason **and one more**:
D144's seed table is pinned **seed by seed** against its own shuffle, so adding a
card to that deck would move all 40 of its pins. Two coin families, two decks,
two tables, neither able to make the other's determinism a coincidence.

Three new fixtures, one per printing, each chosen for a claim it alone can make:
**Pikachu ex `sv02-063`** (a BASIC, a MIXED {L}{L}{C} pile so "all" is a claim
about the `anyEnergy` filter, and an **`ex`** so Safeguard can null its main hit),
**Beartic `sv03-054`** (a different SET and a different Energy line — the
two-printing warrant as a fact of the fixtures), **Oinkologne `sv03-183`** (120
HP against the 60 recoil, and its index-0 "Confounding Cologne" is the sharpest
control in the slice: effect text read by a DIFFERENT arm of the SAME deriver).
`sv02-097` Mimikyu (registry Safeguard), `fix-colorless-weak-big` (the flatness
witness) and `fix-titan` complete the deck.

Seeds: **26 tails / 14 heads over [1..40]**, **one list for all three
installers** because the declaration is the first coin either board draws after
setup and every surgery in `armed` is rng-pure — asserted seed by seed on all
three, so a deck edit that reshuffles fails loudly instead of turning every
both-faces case vacuous.

**Mutation-checked six ways:** dropping `onTails` from the two new arms fails
**18**, reverting `runProgram` to compare against `"heads"` fails **23**,
dropping the gates and deriving the bare ops fails **22**, hardcoding the recoil
at 60 fails **1**, dropping the gated anchors' `$` fails **1**, dropping
`SELF_DISCARD_ALL`'s `$` fails **2**.

**THREE stays-LOUD witnesses RE-POINTED, none deleted** (D144's own move applied
to D144's own witnesses): `attackPark.test.ts` held the gated discard sentence as
a NULL and now makes a SHAPE claim (plus two more COMPOUND refusals added beside
it), and `tailsGatedOp.test.ts` held both sentences — its "OTHER SEVEN" list is
now "OTHER FIVE" and its census case asserts both gated programs equal
`[{ coinFlipGate, onTails, then: <the bare anchor's own output> }]`.

`clauseApostrophe`'s DISCOVERED census stays at **41**, which is a RESULT rather
than an omission: **neither mapped sentence carries an apostrophe at all** (a
first for this family, stated in the code so the next reader does not hunt for a
missing `['’]`), and the one apostrophe-bearing sentence the new fixtures print —
Oinkologne's "Your opponent's Active Pokémon is now Confused." — is already in
the census via `fix-statuser`, so it adds an ID to an existing row and not a row.

### Still unmapped after D145 — ranked by cost

The heal census (D133/D135), the gated-HEADS census (§D134), the counter-damage
censuses (§D138/§D139/§D140), the §9 recoil census (§D141), the PREVENT +
`During your opponent's next turn` census (§D142), the `can't attack` census
(§D143), the TAILS-FACE census (§D144) and now **the two CONSEQUENT censuses
above** are all CLOSED. Do not re-run any of them.

**⚠️ THE BARE TAILS-GATED FAMILY IS CLOSED — 3 sentences / 8 printings, all
read.** The remaining 20 tails printings are refused by SHAPE: 11 are D126's
`cancelOnTails` (already simulated, by the OTHER reader), 4 are a durated gate
making the OPPONENT flip on their own turn, 5 carry TWO consequents on one flip
and want an `otherwise` `coinFlipGate` deliberately lacks. **None is brought
closer by a face**, so the next tails printing this op can express is one the pool
does not print.

- **The attacker-CLASS filter — 4 printings / 2 clauses.** Unchanged from §D142/
  §D143/§D144: one optional field on `preventDamage` plus a predicate over the
  ATTACKER's card. `Basic` is `isBasicPokemon` verbatim; **`Ancient` has no reader
  anywhere in the engine** and is the only real work.
- **The `takes {N} less damage` family — 14 printings / 4 amounts, still the
  LARGEST un-taken count.** A DURATED `damageReductionAfterWR`. **⚠️ TAKE THE
  `attackBlock` GENERALISATION WITH IT** — §D143's table is unchanged by D144 or
  D145, neither of which added a stamped field. **⚠️ AND NOTE THE NEW COUPLING:
  Eiscue `sv02-048`/`-205` "Frigid Block" prints this rider as the SECOND SENTENCE
  after `Discard all Energy from this Pokémon.` — a compound anchor whose first
  half is already built (D145's census found it), exactly the Ninetales/Eiscue
  shape D143 handled. That is 2 of the 14 for one extra `test` arm.**
- **The OPPONENT-side attack lock — 4 printings / 2 clauses.** Earns
  `preventAttack` its `target` field — **two axes**, since the defender-side
  window is `+ 1` where the self one is `+ 2`.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
- **The PER-ATTACK lock — 8 printings / 6 sentences**, unchanged.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.

## D146 — the ATTACKER-CLASS filter: `During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.` (engine 0.95.0, MATCH_RECORD_VERSION unchanged at 5)

Item 1 of D145's remainder list. The mechanism was bought whole at D142 — the turn
stamp, the three early clears, the four damage sites and the effects gate are all
reused unchanged — so the whole slice is **one regex, one deriver arm, one op
field, one `AttackBlock` field, one event field, one log arm, one predicate and
one changed signature**. What it is actually ABOUT is the sentence's OTHER printed
class token, and the answer there is a data finding rather than an engine one.

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| "4 printings / 2 clauses" | **TRUE** — 3 `Basic` + 1 `Ancient` against the local D1 (2026-08-02, 978 cards) |
| "Fletchling `sv01-150`" | **FALSE.** `sv01-150` is **STARAPTOR** — Stage 2 from Staravia, 150 HP, Colorless, retreat 1, ×2 Lightning, −30 Fighting. Fletchling is `sv02-163` and prints none of this text. |
| "Bombirdier `sv02-153`/`-246`" | **FALSE.** Those are **NOIVERN ex** — Stage 1 from Noibat, 260 HP, Dragon, retreat 0, no Weakness, no Resistance. Bombirdier is `sv01-138`/`-219`/`sv02-147`. |
| "Iron Moth `sv06.5-009` **index 1**" | **TRUE** — and the list said why it is the only index it names: D142 found it *by checking*. |
| (unstated) the two Basic printings' INDEX | **INDEX 0 on all three**, checked SEPARATELY per printing (D144's rule) |
| (unstated) their attack names / costs / damage | "Tailspin Away" {C}{C} 60; "Covert Flight" {C}{C} 70 — verified byte-exact, including both printed effect strings |
| "UNGATED, so no coin" | **TRUE**, and it is load-bearing: the suite is SEED-FREE, the family's first ungated producer of this op |
| "one optional field on `preventDamage` plus a predicate over the ATTACKER's card" | **TRUE**, exactly |
| "`Basic` is `isBasicPokemon` verbatim" | **TRUE** |
| "**`Ancient` has no reader anywhere in the engine** and is the only real work" | **⚠️ TRUE IN LETTER, INVERTED IN SUBSTANCE.** It has no reader because it has **no DATUM** — see below. It is not work; it is an INGEST change. |

**AN ELEVENTH LIST CARRYING SOMETHING WRONG, and the first whose miss is in the
card NAMES.** The pattern holds in its usual shape with one refinement: the
CATALOG *counts* were right and the CATALOG *names* were not, which is new. The
names had ridden four remainder lists, D142's own `effects.ts` comment AND D142's
own suite — because a card NAME is the one field nobody re-queries, being the
field a reader thinks they recognise. **D144's per-printing rule extends to names:
verify by QUERY, never by recognition.**

### ⚠️ `Ancient` HAS NO DATUM — the finding, and the reason the sentence stays LOUD

The Ancient/Future banner is printed on the card FACE and debuted with Paradox
Rift (sv04). It is:

- **not in the persisted catalog** — the `cards` table has `stage`, `evolve_from`,
  `regulation_mark`, `rarity`, `types_json` and no tag column of any kind;
- **not in tcgdex's own card model** — `packages/schema/src/tcgdex/card.ts` is
  authored against live payloads and has no such field. **Verified upstream**
  against **Roaring Moon ex `sv04-124`**, the canonical Ancient print: its payload
  carries `suffix: "ex"` for the rule box and **nothing whatsoever** for the
  banner. So this is an UPSTREAM gap, not an ingest one this repo dropped;
- **not in the NAME** either, unlike every other class this engine reads. `ex` /
  `V` / `VMAX` / `Radiant` are all name-encoded (`pokemonSuffixOf`, `hasRuleBox`),
  which is precisely why those predicates exist; "Slither Wing" and "Iron Moth"
  carry no marker at all.

**AND A SPECIES-NAME TABLE WOULD BE WRONG RATHER THAN INCOMPLETE.** The banner is
a per-PRINTING fact — D135's rule at its sharpest — and this pool contains the
counter-example: **Great Tusk ex `sv01-123`/`-230`/`-246`** is one of the Ancient
SPECIES, printed a full year before the mechanic existed, carrying no banner. A
name-keyed answer is therefore wrong on three real cards **with no failure
anywhere**, which is the wrong-with-no-failure outcome this family refuses. Same
for **Iron Treads ex `sv01-143`/`-233`/`-248`** on the Future side.

So the Ancient sentence falls through to `ATTACK_EFFECT_SKIPPED` and stays LOUD,
the `fromClass` union has exactly **ONE** member, and `attackerMatchesClass`
(continuous.ts) is an **EXHAUSTIVE `switch`** — the closed vocabulary D120 requires
of a varying token, enforced by tsc rather than by a comment: a second member
cannot be added without the compiler demanding the predicate that reads it.

**`Future` obliges NOTHING, and the answer is written down rather than assumed.**
It is a real class in this pool (4 printings / 2 cards — Iron Moth `sv06.5-009`,
Iron Treads ex `sv01-143`/`-233`/`-248`) and **one printing already asks a live
question about it**: Slither Wing `sv06.5-026` "Iron Smasher" — *"If your opponent
has any Future Pokémon in play, this attack does 120 more damage."* But (a) it is
unreadable for the identical reason, and (b) it is a **different mechanism** — a
board-condition damage bonus, not a block — so reading one would not have read the
other. Both wait on the same ingest change. (A cheap trap the census caught: Absol
ex `sv03-135`/`-214`'s attack is NAMED "Future Sight", so a text search for
"Future" returns it. The word in a card's own vocabulary is not the class token.)

### The census (local D1, 2026-08-02, 978 cards) — D142's rule, fifth time

`LIKE '%by attacks from%'` over `attacks_json`, `abilities_json` AND `effect`, so
the query sees Abilities and Trainers rather than only attacks. **The whole
attacker-filter neighbourhood is 10 printings across 7 sentences:**

| Sentence | Printings | Kind | Status after D146 |
|---|---|---|---|
| `…prevent all damage done to this Pokémon by attacks from Basic Pokémon.` | **3** | attack | ✅ `preventDamage { fromClass: "Basic" }` — Staraptor `sv01-150` idx 0, Noivern ex `sv02-153`/`-246` idx 0 |
| `…prevent all damage done to this Pokémon by attacks from Ancient Pokémon.` | 1 | attack | ❌ LOUD — Iron Moth `sv06.5-009` idx 1. No datum (above) |
| `Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex and Pokémon V.` | 1 | **Ability** | ✅ since 0.58.0 — Mimikyu `sv02-097` "Safeguard" (`preventDamageFromExV`, gated on `isExOrV`) |
| `…by attacks from your opponent's {R} Pokémon.` | 1 | **Ability** | ❌ Dachsbun `sv01-099` "Well-Baked Body" — filters by ENERGY TYPE, and carries a second sentence ("can't be Burned") |
| `…by attacks from your opponent's {L} Pokémon.` | 2 | **Ability** | ❌ Bellibolt `sv03-078`/`-201` "Insulator" — the same type filter, one printing short of a family with Dachsbun |
| `As long as this Pokémon is in the Active Spot, prevent all damage done to your BENCHED Pokémon by attacks from your opponent's Pokémon.` | 1 | **Ability** | ❌ Thundurus `sv03-070` "Adverse Weather" — filters by ZONE, and protects a body OTHER than the holder |
| `Prevent all damage done to Pokémon that don't have a Rule Box … by attacks from the opponent's Pokémon ex and Pokémon V.` | 1 | **Stadium** | ❌ Neutralization Zone `sv06.5-060` — filters the PROTECTED side as well as the attacker, on a shared zone |

Three things the table is worth keeping for:

1. **ONLY 4 OF THE 10 ARE ATTACKS.** Six are always-on (5 Abilities + 1 Stadium),
   i.e. they need no duration at all and would sit beside `preventDamageFromExV`
   in `passivesOf` rather than on `attackBlock`. **The durated/undurated split is
   not the same split as the filtered/unfiltered one**, and a slice pricing "the
   filter family" off this table must read the KIND column first.
2. **THE POOL FILTERS ON FIVE CLASSES, NOT TWO** — stage (Basic), banner
   (Ancient), rule box (ex/V), energy type ({R}/{L}) and zone (Benched). Only the
   first two are on this op, and only the first is readable. `fromClass` is
   therefore NOT the general "attacker predicate" field it looks like from one
   printing; the energy-type pair would want a different vocabulary and the zone
   one a different holder entirely.
3. **NO COMPOUND PRINTING EXISTS ON THE ATTACK SIDE.** All 4 attack printings are
   the whole effect string with nothing following, so the `^…$` anchor is under no
   pressure here — unlike D145's discard, where four compounds were live. (The
   Ability side does print one: Dachsbun's two sentences.)

### ⚠️ The predicate is evaluated at the READ SITES, and folded INTO the single read

The attacker is unknowable when the block is installed — it is written on the
installer's own body during the installer's own turn, and the Pokémon it will
refuse has not declared anything yet. That is the same split
`PassiveEffects.preventDamageFromExV` has been under since D107: the aura reports
itself and the SITES gate it on `isExOrV(attacker)`.

What is new is WHERE the resolution lives. `attackBlockOf(state, pokemon,
attacker)` now takes the attacking card as a **REQUIRED (nullable) parameter** and
applies the filter itself, so "the ONE read of `InPlayPokemon.attackBlock`" stays
true in the strong sense: **a read site cannot honour the turn stamp and forget
the filter, because there is no way to ask the first question without answering
the second.** Every one of the four damage sites already had the card in hand for
Safeguard on the very next line, so the two auras still sit on one `||`.

`undefined` (no resolvable attacking card) fails a FILTERED block and passes an
unfiltered one — conservative on both: an unfiltered block is the pre-D146
behaviour byte for byte, and a filtered block whose class cannot be checked
protects LESS rather than more, which is `effects`' polarity.

**This is also why ignoring the filter fails only 2 tests**, and the number is a
property of the design rather than of the suite: all four damage sites plus the
effects gate route through one line, so per-site duplicates would be testing one
line five times — and the pool prints **no evolved spread or snipe attacker**
(checked: zero Stage 1/Stage 2 printings of "damage to each of your opponent's
Benched Pokémon"), so those sites cannot be driven with a non-matching attacker
off a real card at all.

### ⚠️ What the filter does when it FAILS — and it is strictly the NARROW reading

The attack lands **in full**: `DAMAGE_DEALT` with `prevented` absent and the real
number in `dealt`, the §8.5 pipeline untouched. `ptcg-rules.md` has no clause for
a filtered prevention — the family is only §8 step 5's *"prevent all damage"*
damage MODIFIER and §15.B's *"Prevent all / reduce damage"* — and reading it as a
modifier is what settles this: a modifier whose condition does not hold simply
does not apply, and nothing else about the step changes.

**It does not touch the effects half at all, and that is a printed fact rather
than a simplification.** All three `fromClass` printings are the NARROW spelling
(no "from and effects of"), so a MATCHED Basic attacker has its damage nulled and
still lands everything else it prints — driven end to end on Pincurchin
`sv02-072`'s Energy discard, Mimikyu `sv02-097`'s 7 PLACED counters and
fix-attacker's Asleep. **This is where D142's decision to ship TWO readings pays**:
folding them would have refused a discard this card does not refuse.

The effects gate is nonetheless made to honour the filter — the Bench-arm argument
from D142 applied to the other axis. Ignoring it would make `fromClass` mean one
thing at four sites and another at the fifth, purely because no printing reaches
it, which is an ACCIDENT rather than a guard. It is pinned by a CONSTRUCTED
`{ effects: true, fromClass: "Basic" }` block (D144's precedent for a rule with no
card) and the sharpest available pair: **Mimikyu (Basic) and Polteageist
`sv03-098` (Stage 1) reaching the SAME `damageActive` op**, told apart by nothing
but the attacker's stage.

### ⚠️ Two installers, and they are each other's negative case

No bespoke "evolved attacker" fixture was invented, because the two printings
already are one: **Staraptor `sv01-150` is a Stage 2 and Noivern ex `sv02-153` is
a Stage 1**, so a Stage 2 swinging into the Stage 1's block for its whole 180 and
a Stage 1 swinging into the Stage 2's for its whole 70 is the filter failing,
driven off printed cards. Their printed lines carry the rest of the suite too:

- Staraptor's **×2 LIGHTNING** weakness means Pincurchin's Basic 70 doubles to 140
  and is then nulled, so a blocked 0 is 0 rather than 0 by coincidence (the row
  still REPORTS the Weakness it computed — the block supersedes, it does not skip);
- Noivern ex's **260 HP** survives the unblocked 180 with room, so the
  "filter failed" cases end with a body still on the board to assert about;
- Noivern ex's index-1 "Dominating Echo" carries an **UNMAPPED** sentence (a
  Special-Energy/Stadium lock) and is the LIVE unmapped witness this slice adds to
  its own deck (D135's move), driven end to end to `ATTACK_EFFECT_SKIPPED`;
- Staraptor's index-1 "Power Blast" is the index control AND the big non-Basic hit.

### ⚠️ The merge rule, read on the other axis

`effects` widens, so two installs OR it. `fromClass` NARROWS, so two installs keep
the filter only when they AGREE, and any disagreement (including one side having
no filter) collapses to the UNFILTERED block. Both are the same rule — *a second
installation may never leave the holder with less protection than one of them
printed* — and when the merge says nothing new the row is suppressed entirely,
which is D142's idempotence answering on two fields instead of one. Unreachable
off any printing (no card prints two of these attacks), constructed and pinned.

### The four structural questions

1. **Does the op PARK?** No — `preventDamage` is deterministic, consumes no rng
   and asks nothing, and this producer is UNGATED so the derived program is a
   single non-parking op that cannot reach `EffectContinuation` at all.
   **`MATCH_RECORD_VERSION` STAYS 5, and the reason is a THIRD distinct one.** The
   field lands INSIDE `AttackBlock` — a record that only exists when a block was
   installed — rather than on `InPlayPokemon`; it is OPTIONAL; and the old shape
   `{ turn, effects }` is still a valid inhabitant of the new type, reading back as
   "refuses every attacker", which is what it meant. Contrast D142/D143, which
   bumped for a REQUIRED field on `InPlayPokemon` itself where the old record's
   TYPE became a lie whatever it read back as. Written into `match.ts`'s own doc
   block, asked rather than omitted, because "one optional field on a persisted
   sub-record" is exactly the shape a session skips the question on.
2. **Whose VOICE?** `ATTACK_BLOCK_APPLIED` gains `fromClass` and a THIRD phrasing
   — *"… is protected from damage from Basic Pokémon's attacks during your
   opponent's next turn"* — for `effects`' reason made sharper: a filtered block
   lets EVERY evolved attacker through at full damage, so the two-phrasing wording
   would be an outright lie about the very next turn. The seat is unchanged
   (D142's active voice: it owns the shielded Pokémon and that Pokémon is the
   actor's own). **And a block that FAILS to match emits NOTHING** — asked
   deliberately, because a silent rule is a real log question. The attack's own
   `DAMAGE_DEALT` row already carries the whole story, and announcing a rule that
   DECLINED would be announcing a non-event: loudness in this engine is owed to
   UNREAD TEXT, not to a read rule saying no (D140).
3. **Is the guard ASSERTED?** Three ways rather than one. The vocabulary is a
   COMPILER fact (the exhaustive `switch` over a one-member union). The PRODUCER
   SET is swept out of the pool rather than listed (D145's move — the sweep walks
   every attack the deriver can read, asserts every emitted `fromClass` is
   vocabulary the predicate has an arm for, and pins the set at exactly
   `["sv01-150", "sv02-153"]`, so a third producer fails loudly). And the effects
   gate honours the filter despite being unreachable from any printing.
4. **Does the mechanism exist?** Read first, and yes — D142's duration, stamp,
   three early clears and four damage sites are reused unchanged, the third slice
   running where the mechanism already existed. **What did NOT exist is the DATUM**
   for the second class token, which is a failure mode this question has not hit
   before: the mechanism was there and the DATA were not.

### The suite — `classBlock.test.ts` (27 tests)

Its own `CLASS_BLOCK_DECK`, and for `ATTACK_LOCK_DECK`'s reason rather than
`PREVENT_BLOCK_DECK`'s — which is worth stating, because this is D142's own op:
**the sentence is UNGATED**, no printing of it flips anything, so the suite is
**SEED-FREE**, has no seed table, runs every board off one seed and pins the fact
by an **unchanged `rngState` across a whole install** (D143's move). Sharing
`PREVENT_BLOCK_DECK` would have moved all of ITS pinned heads/tails seeds.

Both installers are evolutions, fielded by `setActiveFromDeck` surgery exactly as
Ninetales `sv03-029` and Oinkologne `sv01-157` are next door. Every board crosses
at least one turn boundary through real actions.

**Mutation-checked eight ways:** dropping `fromClass` from the deriver fails **8**,
inverting the predicate fails **7**, ignoring the field in `attackBlockOf` fails
**2**, dropping the anchor's `^` fails **1**, ignoring the filter at the effects
gate fails **1**, keeping the filter on a merge disagreement fails **1**, dropping
the class from the install row fails **1**, dropping it from the log arm fails
**1**. (The log arm was UNPINNED when first written — the mutation found it, and
`log.test.ts` gained the arm pin as a result. That is the mutation check earning
its place rather than confirming a suite.)

`clauseApostrophe`'s DISCOVERED census moved **41 → 42** — one row, carried by both
new fixtures, and its exposed slot is the possessive "your opponent's" its
unfiltered siblings already carry **on a regex that is UNGATED where theirs are
not**, so the fold is now proven across the gate boundary too.

`preventBlock.test.ts`'s refusal list was **RE-POINTED, NOT SHORTENED**: the Basic
spelling moved from "expect null" to "expect this exact shape" in the same case,
and the misnamed cards were corrected in place.

### Verification

`bun run check` **GREEN exit 0 — 188 files / 3106 tests** (was 187 / 3079).
engineVersion 0.94.0 → **0.95.0**; `MATCH_RECORD_VERSION` **unchanged at 5**. ZERO
new ops, events, error codes, prompts, parks, clause-table rows, `BoardCondition`
members, registry rows or redact arms; no `redact.ts` / `turn.ts` / `flow.ts` /
`cardplay.ts` / `rng.ts` / `registry.ts` diff and no web/DB/`@luminous/schema`
diff at all.

### Still unmapped after D146 — ranked by cost

The heal census (D133/D135), the gated-HEADS census (§D134), the counter-damage
censuses (§D138/§D139/§D140), the §9 recoil census (§D141), the PREVENT +
`During your opponent's next turn` census (§D142), the `can't attack` census
(§D143), the TAILS-FACE census (§D144), the two CONSEQUENT censuses (§D145) and
now **the ATTACKER-FILTER census above** are all CLOSED. Do not re-run any of them.

**⚠️ TWO SENTENCES ARE NOW BLOCKED ON INGEST RATHER THAN ON THE ENGINE** — Iron
Moth `sv06.5-009`'s Ancient filter and Slither Wing `sv06.5-026`'s Future
board-condition bonus. Neither is a slice; both are one schema/ingest change and
then a one-line predicate each. **Do not put either on a remainder list as engine
work**, and do not let a later session "fix" them with a species table.

- **The `takes {N} less damage` family — 14 printings / 4 amounts, now the LARGEST
  un-taken count in the tail by a wide margin.** A DURATED
  `damageReductionAfterWR`, read at the same four damage sites **one line below**
  `attackBlockOf`. **⚠️ TAKE THE `attackBlock` GENERALISATION WITH IT** — §D143's
  table is unchanged by D144, D145 or D146. D146 added a field INSIDE `AttackBlock`
  rather than a third stamped field on `InPlayPokemon`, so the count of stamped
  fields is still TWO and this item is still the third. **What D146 does change is
  one input to that decision**: the four damage sites now take the attacker, so a
  generalised installed-effects record would have a uniform read signature to hand
  — which makes the union slightly cheaper than §D143 priced it, not dearer.
  **⚠️ AND THE COUPLING STANDS: Eiscue `sv02-048`/`-205` "Frigid Block" prints this
  rider as the SECOND SENTENCE after `Discard all Energy from this Pokémon.`** —
  2 of the 14 for one extra `test` arm (D145's census).
- **The OPPONENT-side attack lock — 4 printings / 2 clauses.** Eiscue ex
  `sv03-042`/`-210`/`-222` "Scalding Block" and Houndoom ex `sv03-134` "Evil Claw".
  Earns `preventAttack` its `target` field — **two axes**, since the defender-side
  window is `+ 1` where the self one is `+ 2`. ⚠️ **D146 IS DIRECTLY RELEVANT TO
  HOUNDOOM ex**: its clause is *"If the Defending Pokémon is a Basic Pokémon…"* —
  the SAME `isBasicPokemon` predicate this slice just wired, read off the DEFENDER
  instead of the attacker. Read `attackerMatchesClass` before pricing it.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
- **The PER-ATTACK lock — 8 printings / 6 sentences**, unchanged.
- **The always-on attacker filters — 6 printings / 4 sentences (NEW, from the
  census above).** Dachsbun `sv01-099` + Bellibolt `sv03-078`/`-201` filter by
  ENERGY TYPE (3 printings, 2 sentences, and Dachsbun carries a second clause);
  Thundurus `sv03-070` filters by ZONE and protects the BENCH rather than the
  holder; Neutralization Zone `sv06.5-060` is a Stadium filtering the PROTECTED
  side too. All four want `PassiveEffects` siblings of `preventDamageFromExV`, NOT
  `attackBlock` — **no duration, no install, no stamp** — so they are a different
  slice from anything above despite the shared sentence stem.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.

## D147 — the DURATED DAMAGE REDUCTION: `During your opponent's next turn, this Pokémon takes {N} less damage from attacks (after applying Weakness and Resistance).` (engine 0.96.0, MATCH_RECORD_VERSION 5 → 6)

Item 1 of D146's remainder list, the largest un-taken count in the whole tail (14
printings / 4 amounts), and the slice D143 explicitly deferred the **`attackBlock`
generalisation** to — so half of it is a reader and half is a design decision.

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| "14 printings / 4 amounts" | **TRUE on both numbers** — 20×1, 30×10, 50×1, 100×2, against the local D1 (2026-08-02, 978 cards) |
| …and all 14 are one sentence | **FALSE.** Twelve are; the other two are Eiscue's COMPOUND, and the **100 amount is printed ONLY there** — so the bare anchor sees three amounts and the compound anchor the fourth |
| "a DURATED `damageReductionAfterWR`, D142's stamp carrying a NUMBER" | **TRUE**, and truer than it reads: `damageReductionAfterWR` is not a name for a new thing, it is the EXISTING `PassiveEffects` field, already summed at the four sites |
| "read at the same four damage sites one line below the block" | **TRUE as a location, MISLEADING as a cost.** The four sites already read that number; the diff is one `+` each, not four new reads |
| "Eiscue `sv02-048`/`-205` prints this rider as the SECOND SENTENCE after `Discard all Energy…`" | **TRUE**, verbatim, INDEX 1, {W}{W}{W}, printed 100 — and the free count it promised is real |
| "the bare anchor must still refuse the compound" | **TRUE**, and it does; both directions asserted |
| "THIS is the third reading, the first that would genuinely SHARE a read path" | **HALF TRUE, AND THE HALF THAT IS FALSE IS THE DECIDING ONE** — see the generalisation section below |
| (ABSENT) the same sentence is printed WITHOUT the duration on 4 always-on Abilities, all already simulated | The whole mechanism, number, clamp and read sites existed. No list in four mentioned it. |
| (ABSENT) two of the fourteen printings are ALREADY IN `FIXTURE_POOL` | Forretress `sv01-139` (D129) and Varoom `sv06.5-043` (D131), both carrying the rider unread. The producer SWEEP found Varoom; nothing else would have. |
| (ABSENT) the INDEX is not constant | Shuckle `sv03-005` and Forretress `sv01-139` print it at **1**, the other twelve at **0** |

**And the card-NAME failure D146 found repeated itself immediately, in a sharper
form.** `sv02-148` is **Corviknight**, not Grimmsnarl; `sv03-145` is **Bronzong**,
not Palafin. Both were misnamed in `effects.ts`, `types.ts`, `interpreter.ts`,
`index.ts`, `preventBlock.test.ts` and `classBlock.test.ts` — **while the SAME two
ids were named CORRECTLY elsewhere in the same repo** (`testFixtures.ts` carries
`name: "Bronzong"`; `attackDiscards.test.ts` says Corviknight). The engine held
the right answer and the wrong one at once and nothing could see the
disagreement. All corrected in place.

### The census (local D1, 2026-08-02, 978 cards) — D142's rule, sixth time

Run for the whole **incoming-damage-reduction** neighbourhood rather than for this
sentence, over attacks, Abilities AND Trainer text. `LIKE '%less damage%'` is
**31 printings across 14 sentences**, and the split is by the PARENTHETICAL:

| Group | Printings | Sentences | Status |
|---|---|---|---|
| **AFTER W/R, durated, on the holder** — `During your opponent's next turn, this Pokémon takes {20\|30\|50} less damage…` | 12 | 1 | ✅ D147 |
| …and its COMPOUND — `Discard all Energy from this Pokémon. …100 less…` (Eiscue `sv02-048`/`-205`) | 2 | 1 | ✅ D147 |
| **AFTER W/R, always-on, on the holder** — `This Pokémon takes {20\|30} less damage…` (Bouffalant `sv03-174`, Stonjourner `sv01-121`, Copperajah ex `sv02-150`/`-245`) | 4 | 2 | ✅ since 0.x (`PassiveEffects.damageReductionAfterWR`) |
| **AFTER W/R, always-on, on a TOOL** — Rock Chestplate `sv01-192` (`The {F} Pokémon this card is attached to takes 30 less damage…`) | 1 | 1 | ❌ one registry row + an energy-type gate on the HOLDER |
| **AFTER W/R, always-on, TEAM-WIDE** — Hariyama `sv02-113` "Arm Thrust Practice" (`All of your Pokémon take 10 less damage…`) | 1 | 1 | ❌ a seat-wide aura `passivesOf` has no shape for |
| **BEFORE W/R — a debuff on the ATTACKER** — Houndoom `sv06.5-008`/`-066` "Snarl" (100, idx 1), Pikachu `sv02-062` + Pidove `swsh10.5-061` "Growl" (20, idx 0), Florges `sv01-093` "Moonblast" (30, idx 0) | 5 | 3 | ❌ a different body, a different step |
| …and its always-on member — Entei `sv03-030` "Pressure" (20) | 1 | 1 | ❌ same mechanism, no duration |
| **`This attack does {10\|20} less damage for each damage counter on this Pokémon`** — Skeledirge ex ×4, Cetitan `sv01-060` | 5 | 3 | ❌ the ATTACKER's own damage calc; a different mechanism entirely |

`reduce` appears in **ZERO** printings — the pool spells every one of these as
"less damage", which is why the query is what it is.

**⚠️ D142's own map UNDERCOUNTED the attacker-side group as 4.** It is 5 durated
attack printings plus an always-on Ability, i.e. 6. The mildest of the eleven
remainder-list misses, and worth recording only because it is the same shape as
all of them: a count copied forward rather than re-queried.

**THE PARENTHETICAL IS THE WHOLE TAXONOMY.** The two halves of this census read
the same words ("N less damage") and mean opposite things — one is subtracted from
what the DEFENDER takes after the modifiers, the other from what the ATTACKER
deals before them. A reader keying on the verb phrase would have shipped five
attacks and an Ability backwards, which is why the parenthetical is inside the
anchor rather than trimmed off it.

### ⚠️ The §8.5 ORDERING, pinned by driving it BOTH WAYS

`ptcg-rules.md` §8 puts the reduction at step 5, after Weakness and Resistance,
and the catalog prints the same thing in parentheses on every one of the twenty
after-W/R printings. The engine's four damage sites already implemented it — this
slice's only job was not to move it, and to make a move fail loudly.

The suite re-derives every `DAMAGE_DEALT` row from **its own reported fields** in
both placements, through the engine's own `applyDamageModifier` (so a bug there
cannot hide behind a matching bug in the oracle), and asserts they differ wherever
a Weakness is present:

| Board (all printed cards, no surgery) | printed order | reversed order | what the difference IS |
|---|---|---|---|
| Forretress `sv01-139` Metal **90** → Eiscue `sv02-048` (×2 Metal, **100**, 110 HP) | `90×2 − 100` = **80** | `max(0, 90−100)×2` = **0** | a 100-point reduction vs TOTAL IMMUNITY |
| fix-attacker Fire **60** → Forretress (×2 Fire, **50**, 120 HP) | `60×2 − 50` = **70** | `(60−50)×2` = **20** | 3.5× |
| fix-attacker Fire **60** → Pineco `sv01-001` (×2 Fire, **30**, 60 HP) | **90** | **60** | both lethal — so the number is asserted, not the KO |
| fix-attacker Fire **30** → Pineco / Varoom (×2 Fire, **30**) | **30** | **0** | the reduction exactly equals the base |
| fix-attacker Fire **30** → Forretress (×2 Fire, **50**) | **10** | **0** | the reduction exceeds the base |
| Rotom `sv01-069` Lightning **20** → Swablu `sv03-169` (×2 Lightning, **20**) — `snipeActive` | **20** | **0** | the SECOND site that runs W/R |
| any hit into a −30 Resistance carrying a reduction | *equal* | *equal* | **the parenthetical CANNOT bite here** |

**The last row is the finding.** Resistance and the reduction are both ADDITIVE and
therefore COMMUTE; only the MULTIPLICATIVE Weakness step makes the printed order
observable at all. That is why all four fixtures were chosen for their Weakness
lines, and why the commuting case is pinned as arithmetic rather than posed as a
board. **Flipping the order fails 3 tests at the main hit and 1 at `snipeActive`.**

**A CLAMPED ZERO IS NOT A PREVENTION.** `Math.max(0, …)` was already at all four
sites and is inherited by summing into the number it guarded. The row keeps
`prevented` ABSENT when a big reduction zeroes a hit, because the same 0 is two
different facts: the §11 block SUPERSEDES the pipeline, this one RAN it.

### ⚠️ The generalisation question — re-derived, and DECLINED with a new trigger

D143 deferred this call here "so the decision is made with three readings in hand
rather than one guessed at", and named the trigger precisely: this would be the
first reading to genuinely **SHARE a read path** with `attackBlock` — the same four
damage sites, one line below it — "which is the thing a union pays for". D146 then
moved one input in the union's favour (those sites now take the attacker, so a
generalised record would have a uniform read signature to hand).

**The premise does not survive contact with the designed reading.** It shares the
SITES. It does not share the QUESTION:

| | `attackBlock` (D142/D146) | `attackLockedTurn` (D143) | `damageReduction` (D147) |
|---|---|---|---|
| Window | `turn + 1` | `turn + 2` | `turn + 1` |
| Read sites | 4 damage sites + 6 effect ops | 1 action gate + 2 projections | the SAME 4 damage sites |
| What it asks | is this damage refused outright? | may the holder declare? | how much comes off? |
| Where in §8.5 | SUPERSEDES the result | not in §8.5 at all | SUBTRACTED inside it |
| Refusal shape | a nulled RESULT + an event | an ILLEGAL ACTION + an error code | a smaller number, reported on the row |
| Provenance | needs `EffectContext.invokedBy` | cannot use one | needs none (see below) |
| Attacker | resolved INTO the read (`fromClass`) | n/a | asks nobody |
| Payload | a boolean + a class token | nothing | a number |

Two rows are new since D143 and both cut against the union. **The two live at the
same four sites and give different KINDS of answer at different STEPS**, so a read
site that had one record in hand would still have to ask it two questions and fold
them separately — a union merges STORAGE, not lookups. And **D146's filter makes
the independence observable rather than notional**: a `fromClass` block can DECLINE
an attacker while the reduction on the same body still bites, which the suite
drives.

Priced concretely against D143's own table:

- **BUYS**: the three §10 clear sites stop being hand-written literals (~3 lines,
  and the hazard they carry is already covered by D143's own swept clear-set test);
  ONE `MATCH_RECORD_VERSION` bump instead of one per field — **and this slice bumps
  either way, so the entire saving is in the FUTURE.**
- **COSTS**: a discriminated union; a `find`-by-kind at every read site where today
  each site names its own field and the compiler checks it; a harder install/merge
  (remove-then-push instead of one assignment); a mechanical rewrite of every suite
  that surgeries a stamp; and a persisted shape change.

**If it were taken, MRV would bump once more and then further durated effects would
cost none.** That is the real argument for it and it is stated rather than buried —
a FUTURE saving weighed against a PRESENT and PERMANENT cost at the read sites.

**And the fact that decided it: this was never a new READING at all.** The number,
its four read sites, its clamp and its `ignoreWR` bypass all existed, and the pool
prints this sentence minus its duration prefix on four always-on Abilities that
have been simulated since 0.x. The slice's state field is a **SOURCE** feeding a
number the engine already computes — one `+` per site — so there was no read path
to unify even in principle.

**⚠️ THE NEW TRIGGER, so the next durated slice inherits a test and not a
judgement: the first caller that must ENUMERATE the installed effects on a body
instead of asking for one by name.** Field-by-field storage answers *"is effect X
live?"* perfectly and answers *"what is on this Pokémon?"* only with a hand-written
list — exactly the literal-list hazard a union removes. Three things would produce
that question and **none exists today**:

1. a printing that REMOVES the effects of attacks — **censused: the pool has none,
   and the one card that mentions removal at all, Toedscruel ex `sv03-022`, says
   explicitly "(Existing effects are not removed.)"**;
2. a redact/HUD projection that must SHOW the durated riders as a list — today none
   crosses the wire (`RedactedConditions`/`BattleConditions` pin the shape field by
   field, and D143 folded its lock into an existing `playable` boolean);
3. a FIFTH stamped field, at which point the three clear sites carry five literals
   each.

**Note the count: the §9 counterattack item (Lycanroc ex `sv02-117`/`-241`,
Mabosstiff `sv02-143`) would be the FOURTH**, so the trigger is deliberately not
"the next one".

### ⚠️ Kept OUT of `passivesOf`, and both reasons are structural

`passivesOf` is documented as the CATALOG scan — a printed passive plus attached
Tools — which is the aura/installation distinction `attackBlockOf`'s own doc block
draws. It also **SUPPRESSES a holder's own printed passive under a §9 Ability-lock
aura**, and an attack INSTALLATION must be immune to that, because an installation
is not an Ability. Summing at the four sites keeps that immunity a property of
where the number comes from rather than of where the suppression happens to sit.

### ⚠️ No provenance channel, by D143's generalisation rather than by luck

A durated effect owes an `EffectContext.invokedBy` only when it gates an OP that a
Trainer or an Ability could also reach. This number is summed into one the
ALWAYS-ON printings already contribute at the same four sites with **no** such
check, so giving it one would make the same printed words mean two different
things depending on whether they carry a duration. Checked rather than assumed:
all three interpreter damage sites are attack-only in this pool — every registry
`damageChosen` is `opponentBench` without `deals`, and `damageActive` places flat
counters no reduction touches.

### The merge rule — `Math.max`, which is D142's `||` on a number

Both are instances of *a second installation may never leave the holder with less
protection than one of them printed*: for a flag that is OR, for a number MAX. A
SUM would be the other reading — two continuous effects from two SOURCES do stack,
which is exactly why `passivesOf` sums a passive with a Tool — but this field holds
ONE installation with ONE window, so summing would make the stored number depend on
how many times the record was written rather than on what was printed. Unreachable
off any printing (one attack per turn, no card prints two of these), constructed
and pinned; the day a printing installs this on the DEFENDER, the field becomes a
list and the sum becomes the live question. The row is suppressed when the merge
says nothing new.

### The four structural questions

1. **PARK?** No — `reduceDamage` is deterministic, consumes no rng and asks
   nothing, so no `EffectContinuation` can carry it. **`MATCH_RECORD_VERSION`
   5 → 6**, D124/D142/D143's reason verbatim and the FOURTH bump on the same
   trigger: a REQUIRED key on `InPlayPokemon` makes every body in an older record
   the wrong TYPE, and the fact that it would read back benignly (`undefined.turn`
   is never `state.turn`) is precisely the soft landing that constant exists to
   refuse. Contrast D146's OPTIONAL key inside `AttackBlock`, which did not bump.
2. **VOICE?** ACTIVE — `seat` owns the protected Pokémon and that Pokémon is the
   actor's own — and **the AMOUNT is in the wording**, unlike `ATTACK_BLOCK_APPLIED`
   where "protected" plus a spelling says everything: four amounts share one
   sentence, and the row sits directly above a `DAMAGE_DEALT` row on the next turn
   whose own `reduction` field carries the same figure. The row reports the MERGED
   number. **A reduction that FIRES emits nothing** — `DAMAGE_DEALT.reduction` has
   named that fact since Bouffalant "Bouffer" (D140/D146: loudness is owed to
   UNREAD TEXT).
3. **GUARDS ASSERTED?** Four ways, and one PAID: the PRODUCER SET is swept out of
   the pool rather than listed — **which is what found the fifth producer nobody
   had listed** — the §8.5 ordering is asserted against a re-derived oracle on
   every row rather than against typed numbers, both BENCH read sites are guarded
   although a live reduction is unreachable there by construction (D146's
   precedent), and `preventBlock.test.ts`'s swept §11 classification table refused
   to go green until the new op had a verdict (`untouched`).
4. **MECHANISM EXISTS?** Read first, and it existed TWICE over — the number, its
   four read sites, its clamp, its `ignoreWR` bypass, and four printed always-on
   producers of the very same sentence. **What this slice added is the DURATION.**
   D146 found a slice where the mechanism existed and the datum did not; this is
   its mirror — the datum existed, in the engine's own fixture pool, and nobody
   had looked.

### The suite — `damageReduction.test.ts` (36 tests)

Its own `DAMAGE_REDUCTION_DECK`, **SEED-FREE** for `classBlock.test.ts`'s reason
(no printing of this family carries a coin) and pinned by an unchanged `rngState`
across an install. Four driven installers covering all four amounts at both
printed indices — Swablu `sv03-169` (20, {C}, no damage, idx 0), Pineco `sv01-001`
(30, {C}{C}, 10, idx 0), Forretress `sv01-139` (50, {M}{C}{C}, 90, **idx 1**),
Eiscue `sv02-048` (100, {W}{W}{W}, 100, **idx 1**, the COMPOUND) — plus Varoom
`sv06.5-043` (30, idx 0), the fifth producer the sweep discovered. **Pineco is
Forretress's PRE-EVOLUTION**, so the §10 evolve clear and "the record belongs to
the Pokémon" both run off printed cards. Each of the four READ SITES gets its own
attacker (fix-attacker's Flame for the main hit, Rotom `sv01-069` for
`snipeActive`, fix-sniper for `spreadDamage`, fix-bramble for `placeSnipe`'s
`deals` arm).

**Mutation-checked fourteen ways:** stamping `state.turn` fails **14** and
`state.turn + 2` fails **14**; dropping the compound arm **12**; dropping the
main-hit `+` **8**; dropping the bare anchor's `^` **6**; flipping the §8.5 order
at the main hit **3** and at `snipeActive` **1**; and **1** each for dropping the
`+` at `snipeActive` / `spreadDamage` / `placeSnipe`, merging by `Math.min`,
dropping the bare anchor's `$`, skipping the leaving-Active clear, skipping the
evolve clear, and dropping the amount from the log row.

`clauseApostrophe.test.ts`'s DISCOVERED census moved **42 → 46** — its largest
single jump, because a family that varies by a NUMBER is three rows on a
`sentence` census even though it is one anchor with one capture. It is also the
first time that sweep has covered an anchor whose varying token is a CAPTURE
rather than a fixed string, and the `['’]` class sits BEFORE the capture, so a
template-per-amount build would have had to spell it three times. **Two
stays-LOUD witnesses re-pointed, none deleted** (`attackPark.test.ts`,
`tailsSelfCost.test.ts`, both NULL → SHAPE — D145's own move applied to D145's own
witnesses, on the printing D145 forecast would need it).

### Verification

`bun run check` **GREEN exit 0 — 189 files / 3142 tests** (was 188 / 3106).
engineVersion 0.95.0 → **0.96.0**; `MATCH_RECORD_VERSION` **5 → 6**. ZERO new
prompts, parks, clause-table rows, `BoardCondition` members, error codes, registry
rows or redact arms; no `redact.ts` / `flow.ts` / `cardplay.ts` / `rng.ts` /
`registry.ts` / `triggers.ts` diff and no web/DB/`@luminous/schema` diff beyond the
one constant.

### Still unmapped after D147 — ranked by cost

Twelve censuses are CLOSED and must not be re-run: the heal neighbourhood
(D133/D135), the gated-HEADS neighbourhood (§D134), the counter-MOVE (§D138) and
counter-PUT (§D139/§D140) neighbourhoods, the §9 RECOIL neighbourhood (§D141), the
PREVENT + duration neighbourhood (§D142), the `can't attack` neighbourhood
(§D143), the TAILS-FACE neighbourhood (§D144), the two CONSEQUENT neighbourhoods
(§D145), the ATTACKER-FILTER neighbourhood (§D146) and **the whole
INCOMING-DAMAGE-REDUCTION neighbourhood above**.

- **The OPPONENT-side attack lock — 4 printings / 2 clauses.** Eiscue ex
  `sv03-042`/`-210`/`-222` "Scalding Block" (behind a self Energy discard — a
  two-sentence anchor, and the discard half is already built) and Houndoom ex
  `sv03-134` "Evil Claw" (behind a Basic-ness predicate). Earns `preventAttack` its
  `target` field — **two axes**, since the defender-side window is `+ 1` where the
  self one is `+ 2`. ⚠️ D146's `isBasicPokemon` predicate is the one Houndoom ex
  wants, read off the DEFENDER. ⚠️ Houndoom ex also prints a BARE recoil at index 1,
  so read the index and the NAME off the D1.
- **The attacker-side `do {N} less damage` family — 6 printings / 4 sentences
  (NEW, from the census above).** `During your opponent's next turn, attacks used
  by the Defending Pokémon do {N} less damage (BEFORE applying Weakness and
  Resistance).` — Houndoom `sv06.5-008`/`-066` (100), Pikachu `sv02-062` + Pidove
  `swsh10.5-061` (20), Florges `sv01-093` (30), plus Entei `sv03-030`'s always-on
  Ability (20). **A durated stamp on the DEFENDER's body read at the ATTACKER's
  pre-W/R step** (`attackerPreWRBonus`), i.e. D147's mirror on both axes at once —
  and it would be the FOURTH stamped field. The one existing pre-W/R read site is
  a BONUS, so this needs a signed number or a second term there.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
  Vengeful Punch `sv03-197` (a Tool, KO-conditioned, no duration — cheapest),
  Lycanroc ex `sv02-117`/`-241` "Scary Fangs" and Mabosstiff `sv02-143`
  "Comeuppance" (stamped fields summed into `passivesOf`'s `damageAttacker`).
  ⚠️ Either of the last two would be the **fourth** stamped field — see the
  generalisation trigger above; the fourth is NOT it.
- **The always-on damage reductions the census turned up — 2 printings / 2
  sentences (NEW).** Rock Chestplate `sv01-192` (a **Tool**, {F}-gated on the
  HOLDER — one registry row plus a type check `passivesOf` has no shape for) and
  Hariyama `sv02-113` "Arm Thrust Practice" (a **seat-wide** aura: "All of your
  Pokémon take 10 less damage…"). Both feed the SAME number D147 just summed into,
  which makes them the cheapest remaining widenings of it — but neither is a
  duration and neither is an `attackBlock` sibling.
- **The always-on attacker filters — 6 printings / 4 sentences (§D146).**
  Unchanged: `PassiveEffects` siblings of `preventDamageFromExV`, not stamps.
- **The PER-ATTACK lock — 8 printings / 6 sentences**, unchanged. The first durated
  state that is not a bare stamp (it needs an attack index or a name).
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.
- **BLOCKED ON INGEST, NOT ON THE ENGINE (D146):** Iron Moth `sv06.5-009`'s Ancient
  filter and Slither Wing `sv06.5-026`'s Future bonus. Not slices.

---

## D148 — the OPPONENT-SIDE ATTACK LOCK: `Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.` + `If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.` (engine 0.97.0, MATCH_RECORD_VERSION unchanged at 6)

Item 1 of D147's remainder list, and **the slice that answers a question D143
wrote down and refused to guess**: whether `preventAttack` should carry a
`target`. It should. What makes it worth a decision block is that D143's
objection is **true in its facts and wrong in its conclusion**, and the reason it
took two readings to see that is exactly why D143 wrote the warrant down instead
of building the field.

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| Eiscue ex `sv03-042`/`-210`/`-222`, 3 printings, "Scalding Block" | **TRUE** — one attack in three rarities (Double rare / Ultra Rare / Special illustration rare), byte-identical on all three. D121's second-printing warrant met by the card |
| Houndoom ex `sv03-134` "Evil Claw", 1 printing | **TRUE** |
| "4 printings / 2 clauses" | **TRUE** |
| "its first half is `discardEnergy from: \"yourActive\"`, already built" | **TRUE**, and sharper than it reads — that op PARKS, so this is the first OPPONENT-side install in the family to sit behind a park |
| "⚠️ Houndoom ex also prints a BARE recoil at index 1 (\"Hound's Fang\", 220 — already simulated)" | **TRUE** on all three facts, and the only index any list has named correctly on first pass |
| *(UNSTATED)* Evil Claw's own index | **INDEX 0**, checked separately (D144's rule). The list named index 1 and said nothing about index 0 |
| *(UNSTATED)* Scalding Block's index | **INDEX 0** — Eiscue ex's ONLY attack |
| every name / cost / printed damage / effect string, per printing | **VERIFIED** — Eiscue ex {W}{W}{W} 160, Houndoom ex {D}{D} 90 and {D}{D}{D} 220 |
| "⚠️ D146 IS DIRECTLY RELEVANT TO HOUNDOOM ex … the SAME `isBasicPokemon` predicate, read off the DEFENDER" | **TRUE, and it is the SLICE's second finding** — the same predicate on the other body resolves at the opposite SITE. See below |
| "⚠️ TWO axes, not one … the field carries a holder AND a stamp rule" | **⚠️ FALSE, and this is the headline.** Two NUMBERS, ONE axis: the stamp is a pure function of the holder |
| "⚠️ SWEEP `FIXTURE_POOL` FOR BOTH SENTENCES FIRST" | **RUN, and it came back EMPTY** — neither sentence was already fielded. D147's rule working from the other end |
| *(UNSTATED)* any misnamed id | **NONE FOUND.** The first slice in three where the name sweep turned up nothing, and it was still run |

**Thirteen lists in, and this is the first whose only miss is in a STRUCTURAL
claim it argued for explicitly** rather than in a count, a name, an index or an
absence. The standing shape holds otherwise: the catalog claims were right to the
byte, and the one claim that was reasoned rather than queried is the one that
failed.

### ⚠️ `target` is ONE axis and not two — the finding

D143 declined the field in `preventAttack`'s own doc block:

> a `target` would have to carry a DIFFERENT STAMP as well as a different holder
> (the defender-side window is `state.turn + 1`, this one is `state.turn + 2`),
> so the field is two axes rather than one

Both numbers are real. They are not **independent**. There is exactly one rule:

> **the window is the LOCKED POKÉMON's controller's NEXT turn**

and the two numbers are that one rule evaluated on the two seats, because
**declaring an attack ENDS the turn (§5.3)**. The turn after the installing one
belongs to the opponent — so the defender's next turn is `+ 1` — and the one after
that is the installer's own, `+ 2`. The printed wordings differ for exactly the
same reason:

| Printing | Printed duration | Locked body | Stamp |
|---|---|---|---|
| `During your next turn, this Pokémon can't attack.` (22) | *your* next turn | the ACTOR's own Active | `+ 2` |
| `…the Defending Pokémon can't attack.` (4) | *your opponent's* next turn | the DEFENDER | `+ 1` |

Both sentences are spoken from the installer's chair; the body they lock is a
different one; the window is the same rule about that body. So the stamp is
DERIVED from `target` at the one install site, one field determines both, and
D131's widen-don't-add test passes — **on the second reading rather than guessed
at from the first, which is what D143's refusal bought.**

**Driven, not argued: `+ 2` on both arms fails 13, `+ 1` on both fails 23,
ignoring the field at the install site fails 17.**

### ⚠️ The STATE costs nothing — the first durated slice in four with no new field

`InPlayPokemon.attackLockedTurn` is reused unchanged. *"On which turn may this
body not attack"* is ONE question about ONE body, and **whose attack wrote the
answer is a fact about the OP, not about the record**. Consequences, all of them
driven rather than inherited:

| Site | Diff |
|---|---|
| `attackLocked` (continuous.ts) | none — D143 forecast this here verbatim ("would earn the OP a `target` field, not this reader a return type") |
| the §8 attack gate (attack.ts) | none |
| `redactedAttacksOf` (redact.ts) | none |
| `GameHud.tsx` | none |
| the three §10 clear sites | none |
| `MATCH_RECORD_VERSION` | **unchanged at 6** |

**And that is the answer to D147's generalisation trigger, said explicitly: this
is NOT a fifth stamped field. It adds none.** The question is not re-opened.

The MRV question is nonetheless live rather than academic. `preventAttack` never
parks, but on Eiscue ex's compound it sits BEHIND one, so the op rides
`EffectContinuation.rest` into a persisted record. An OPTIONAL field absent on all
22 self-lock printings is a WIDENING (D125's distinction, D144's worked case): an
old `{ op: "preventAttack" }` is a valid inhabitant of the new type and reads back
as the self arm, which is exactly what it meant. Written into `match.ts`'s own doc
block as a FOURTH distinct no-bump reason.

### ⚠️ The class predicate is D146's MIRROR — same predicate, opposite site

Houndoom ex's *"If the Defending Pokémon is a Basic Pokémon"* is the same
`isBasicPokemon` D146 wired one slice earlier. The one word that differs changes
where it resolves:

| | D146 (`AttackBlock.fromClass`) | D148 (`opponentActiveIsBasic`) |
|---|---|---|
| Body the class is asked about | the ATTACKER | the DEFENDER |
| Known at install time? | **no** — nobody has declared yet | **yes** — it is standing in front of the attack |
| Where it resolves | the four damage READ SITES | the INSTALL, once |
| What is stored | the printed TOKEN | **nothing** |
| Cost | one field inside a persisted record | one `BoardCondition` member |

So the gate is `conditionGate { cond: { kind: "opponentActiveIsBasic" }, then: [
{ op: "preventAttack", target: "defender" } ] }` — an op that has spliced
deterministic branches into the work queue since M4 — and the new member is the
exact complement of D115's `opponentActiveIsEvolution`, **pinned against it on
every real body** rather than each against a fixture. A field on the op would have
been a second way to say generally what the gate already says (D131), and it would
have said it for one op where the gate says it for all.

`conditionGate` also answers two questions for free: it emits **no event** (a
board condition is a fact both players can read off the table), and it draws **no
coin**, which is what keeps the suite seed-free.

### ⚠️ Two regexes, and the gated `then` is the other anchor's own op

One anchored whole-sentence regex per PRINTED STRING (D136/D137). The two share
four words and differ in the first clause, in whether there is a gate at all, in
the subject's noun phrase (*"the Defending Pokémon"* vs *"it"*) and in **where the
four duration words sit** — so an alternation would be two patterns wearing one
name. What they share is the ACTION, and the action is shared as an OP: the gated
`then` is byte-identical to the compound's second op, asserted rather than argued
(D134's move on the heads face, D144/D145's on tails).

- **No bare anchor.** *"During your opponent's next turn, the Defending Pokémon
  can't attack."* is printed NOWHERE in the pool as a standalone attack sentence
  — the compound is the only form it takes, exactly as D143's any-zone counter PUT.
- **"Basic" is SPELLED, not captured** — D146's call on the same word one slice
  back. D120's precondition ("does exactly one TOKEN vary across printings?") is
  answered NO by a one-printing sentence whose sibling readings live on different
  skeletons; the vocabulary is closed where the READING is (`BoardCondition`).
- **The prefix is a LIVE reading, which makes `^…$` sharper than D143's.**
  *"Discard an Energy from this Pokémon."* has derived since 0.x, so a prefix match
  would return a program that RUNS — pay the Energy, install nothing — rather than
  null. Asserted in both directions.

### ⚠️ The first op in this family a §11 block REFUSES — and the swept table found it

`preventBlock.test.ts`'s classification moved `preventAttack` from `untouched` to
`blocked`. Its old verdict (*"it writes a stamp onto the CONTROLLER's own
Active"*) was true of **the ops the deriver could emit**, not of the op — so the
interpreter now owes `attackEffectRefused`, `preventRetreat`'s check verbatim,
asked on the RESOLVED seat so the rule is total over both arms (`applyStatus`'s
call; the self arm is provably inert, a block being live only during its holder's
opponent's turn). **Dropping it fails 2.** Reachable off printed cards, not
constructed: the defender installs on their turn, the window is the installer's
very next turn, and that is the turn this lock would land on.

**⚠️ AND THE SWEEP HAD A HOLE — the D139 → D140 → D143 → D146 shape for a FIFTH
time.** Its walker descended `coinFlipGate` only, which was correct at 0.91.0 and
became an accident of the candidate sets six slices ago; Houndoom ex is the first
printed attack whose WHOLE PROGRAM is a `conditionGate`. Fixed, hoisted out of the
sweep so a case can call it directly, and pinned that way — **because the pool
sweep cannot see its own blindness**: removing the arm fails nothing off
`FIXTURE_POOL`, since the gate is discovered at top level and the op inside it is
also emitted bare by D143's 22 printings.

**⚠️ AND A SECOND FINDING ABOUT THAT TABLE, MEASURED RATHER THAN ASSUMED — it is
weaker than three slices have described it.** It asserts that every op HAS a
verdict; it never asserts the verdict is TRUE. Flipping `blocked` back to
`untouched` fails **nothing**. The behaviour is pinned by the driven case; the
table is a FORCING FUNCTION (it made the question get asked, which is real and is
how this slice found the refusal) but not a proof. Proving it means driving every
`blocked` op under a live block, which is a slice of its own — carried forward
rather than smuggled in here.

### ⚠️ Who "the Defending Pokémon" is, and the §10 clears with the AGENCY inverted

`ptcg-rules.md` §8 step 5 defines it: *"the Defending (opponent's Active)
Pokémon"* — the body that was Active **when the attack resolved**, not "whatever
is Active on their turn". So the lock is written onto that `InPlayPokemon` record
and §10 sheds it the moment that body leaves the Active Spot or evolves, exactly
as D112's retreat block is treated. The lifetime table:

| Moment | `state.turn` | Locked? | Why |
|---|---|---|---|
| The install resolves (attack tail, turn N) | N | **no** | the printed word is "NEXT" |
| Checkup ending turn N | N | **no** | nothing clears it here, as D142/D143 |
| The victim's whole turn N+1 | N+1 | **YES** | the printed window — **BOTH** of their attacks are refused |
| The installer's turn N+2 | N+2 | **no** | not the locked seat's turn; the installer attacks normally |
| The victim's turn N+3 onward | ≥ N+3 | **no** | expired by arithmetic; the stale stamp answers nothing |
| The victim RETREATS inside the window | — | **no** | §10, and the promoted body attacks |
| The victim SWITCHES it out and back | — | **no** | §10, and it comes back clean |
| The victim EVOLVES it | — | **no** | §10 — the cheapest counterplay: no Energy, no allowance |
| Knocked Out by the installing attack | — | — | the stack leaves play; the promoted body carries no lock |
| Installed twice | — | the later stamp | monotone (below) |

**Every route is D143's reachability with the AGENCY inverted.** All three are
lines of play on the locked player's own turn — but that player is the VICTIM, so
they are COUNTERPLAY against an imposed effect rather than an escape from a
drawback the holder chose. **The INSTALLER can reach none of them**: their turn
ended when they declared, which is the exact inversion of D142's block, whose only
in-window clear was the opponent's Boss's Orders. That makes **four durated
effects with four different reachability stories on the same four fields**, and it
is why the clear-set is swept rather than listed.

A **lethal install is a LINE rather than a corner** here, unlike anywhere else in
this family: Eiscue ex's printed 160 into Alomomola's 110 KOs the very body it
locks. The lock row lands BEFORE the KO — the program runs at `attack.ts`'s tail
and the §8.1 sweep follows it, exactly as a defender-targeted status lands on a
lethal hit — and the promoted body carries nothing.

### ⚠️ Two installs on one body are now reachable, and the stamps are MONOTONE

Before D148 a re-install was ≥ 2 turns later by construction. Now a Pokémon can
lock itself with its own attack AND be locked from across the table. Every install
writes its holder's next turn measured from the install, and installs are ordered
in time — so a later stamp is never an EARLIER turn than the one it replaces.
That is why the later one simply wins and there is nothing to `Math.max` (contrast
`reduceDamage`, whose two sources really can disagree). Driven: Alomomola's
self-lock (`+ 2` from turn 3 = **5**) and Houndoom ex's defender-lock (`+ 1` from
turn 4 = **5**) name the SAME turn, so the second install is **silent** — D142's
*"when the merge says nothing new the row is suppressed entirely"*, reached for
the first time by two DIFFERENT printings.

### The census (local D1, 2026-08-02, 978 cards) — D142's rule, SEVENTH time

Run for THIS question — *what printings lock the OPPONENT's Pokémon out of
attacking, under any duration or gate?* — rather than read off §D143's `can't
attack` table, per that slice's own rule. The `can't attack` query reproduces
§D143's numbers exactly (38 printings: 33 attacks, 2 Abilities, 3 Trainer). What
it **cannot see** is a printing that says `can't USE` — and that is where the
census paid:

| Sentence | Printings | Kind | Status after D148 |
|---|---|---|---|
| `Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.` | **3** | attack | ✅ `discardEnergy` + `preventAttack { target: "defender" }` — Eiscue ex `sv03-042`/`-210`/`-222` idx 0 |
| `If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.` | **1** | attack | ✅ `conditionGate` → the same op — Houndoom ex `sv03-134` idx 0 |
| `Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.` | **2** | attack | ❌ **NEW — on no earlier list or census.** Medicham `sv01-111` "Acu-Punch-Ture" idx 0, Oranguru `sv02-094` "Plotter's Command" idx 0. The OPPONENT-side twin of the per-attack lock, and it needs a **PARK** (choosing which attack) on top of the attack address |
| `During your opponent's next turn, if the Defending Pokémon tries to attack, your opponent flips a coin. If tails, that attack doesn't happen.` | 4 | attack | ❌ a durated gate making the OPPONENT flip on their OWN turn (Dolliv `sv01-022`/`-200`, Quaxly `sv02-049`/`-206`) — §D145 already refused these on the face question, and they are refused here on the DECIDER |
| `…is now Paralyzed.` | 25 | attack | ✅ §12, simulated since 0.x — a Special Condition, not this mechanism (no stamp, a Checkup tick, a status chip) |
| `During this turn, your Pokémon can't attack.` | 3 | **Trainer** | ❌ Geeta `sv03-188`/`-218`/`-226` — a different turn, the actor's OWN board, and not an attack effect |

**So the opponent-side attack-denial neighbourhood is 6 printings / 3 sentences on
the ATTACK side (4 mapped here, 2 refused), plus 4 coin-gated near-misses, plus
Paralysis.** Two things the table is worth keeping for:

1. **THE PER-ATTACK LOCK GROUP IS 10 / 7, NOT 8 / 6.** §D143 counted the SELF-side
   printings (`this Pokémon can't use {AttackName}`, 8 across 6 sentences) and its
   query could not see a sentence whose subject is the opponent's. The two new
   printings are strictly harder than the self-side eight: they need the attack
   address AND a park to choose it, so item 4 of any remainder list is two
   mechanisms rather than one.
2. **NO COMPOUND RIDES BEHIND THIS RIDER.** Both mapped printings are compounds
   whose OTHER half comes first (an Energy cost, a class gate); nothing in the pool
   prints a sentence AFTER either one, so the `^…$` anchors are under no pressure
   from a third clause — unlike D145's discard, where four compounds were live.

### The four structural questions

1. **Does the op PARK?** `preventAttack` does not — deterministic, consumes no
   rng, asks nothing. The op it rides BEHIND (`discardEnergy`) does, and gained no
   field. **`MATCH_RECORD_VERSION` UNCHANGED at 6**, and the reason is a FOURTH
   distinct one: no `InPlayPokemon` key moved at all (the state field is reused),
   and the op's new key is OPTIONAL and absent on every pre-existing producer, so
   a persisted continuation written by the previous deploy is a valid inhabitant
   of the new type and reads back as what it meant. **This is also, explicitly,
   NOT D147's fifth-stamped-field trigger.**
2. **Whose VOICE?** `seat` owns the LOCKED Pokémon (D136's finding 1) — the
   actor's own on 22 printings, the actor's OPPONENT's on 4 — and **there is no
   new phrasing, which is a result rather than a saving**. D143 phrased
   `ATTACK_LOCKED` from the HOLDER's side *"so it reads as RETREAT_BLOCKED's
   sibling"*, and RETREAT_BLOCKED is a **victim-side** row: the wording chosen for
   what was then an active-voiced row was ALREADY the passive-side one, and the
   direction it was written to flip is the direction this slice added. *"<name>
   can't attack next turn"* is true under either seat, because *"next turn"* is
   the LOCKED player's next turn in both readings — the printed wordings differ
   only because they are spoken from the installer's chair, and a log row is not.
   Contrast D146, which owed a THIRD phrasing the moment its field landed:
   `fromClass` changed what the rule DOES, `target` only changes whose name the
   row already carries. Driven and READ in sequence from both seats. **A gate that
   DECLINES emits nothing** (D140/D146), asserted on the rendered LOG.
3. **Is the guard ASSERTED?** Four ways, and two found something. The §11
   classification table forced the `blocked` verdict; its walker's gate blindness
   was found, fixed and pinned directly; the table's OWN weakness was measured and
   written down (a wrong verdict goes green); the turn:action vocabulary is swept
   from the seat that did not install (attach, Trainer, retreat, endTurn all still
   legal); and the §12 ordering is pinned — an Asleep AND locked Active reports
   `STATUS_PREVENTS_ATTACK`, not `ATTACK_PREVENTED`.
4. **Does the mechanism exist?** Read first, and it existed THREE times over: the
   lock field, its §8 gate, both projections and its three clears are D143's; the
   gate op and its `BoardCondition` union are M4's; the predicate is D146's and the
   discard half is 0.x's. **What this slice added is the DIRECTION.**

### The suite — `defenderLock.test.ts` (40 tests)

Its own `DEFENDER_LOCK_DECK`, for `ATTACK_LOCK_DECK`'s reason rather than
`PREVENT_BLOCK_DECK`'s: neither sentence flips anything, so the suite is
**SEED-FREE** and pins that by an unchanged `rngState` across a whole
park-and-resolve. It cannot SHARE `ATTACK_LOCK_DECK` even though it reuses three
of its cards — that suite's own shuffle decides which Basics its `armed()` finds.

**⚠️ THE DECK IS THE FIRST IN THIS FAMILY THAT IS ASYMMETRIC BY DESIGN**, because
it is the first sentence whose effect lands on the opponent: the INSTALLERS matter
on P1 and the VICTIMS matter on P2, and a case is only meaningful when the victim
is the right STAGE and survives the right number. Two new fixtures (Eiscue ex
`sv03-042`, Houndoom ex `sv03-134`); **Alomomola `sv01-048` does three jobs at
once** — it is BASIC (Evil Claw's predicate holds), it has TWO attacks (so "the
lock is on the POKÉMON" is asserted from the other seat), and its index-1 "Aqua
Slash" installs D143's SELF-lock, which is what makes the two-ops-one-stamp case a
drive rather than a surgery. `fix-mola-stage1` is both the §10 evolve clear and,
once evolved, the body the predicate FAILS on — **so the filter's two answers are
one printed line of play apart.**

The one SURGERY is D142's wide block, and the reason is censused rather than
assumed: **every one of the pool's 13 `effects: true` printings is coin-gated**,
so driving one would put a coin into a suite whose whole determinism claim is that
it takes none (D143's own move on this same field).

**Mutation-checked seventeen ways:** dropping the gated arm fails **24**, `+ 1` on
both arms **23**, dropping the §8 gate **22**, inverting the predicate **22**,
ignoring `target` at the install site **17**, dropping `target` from the gated arm
**16**, `+ 2` on both arms **13**, dropping the whole compound arm **12**, dropping
`target` from the compound arm **9**, reversing the compound's op order **6**,
skipping the leaving-Active clear **4**, skipping the evolve clear **3**, dropping
the redact projection line **3**, dropping `attackEffectRefused` **2**, and **1**
each for the compound anchor's `^`, the gated anchor's `$`, the idempotence
early-return and the sweep's `conditionGate` descent. Two mutations SURVIVED and
both are reported rather than buried: reverting the walker (fixed by pinning it
directly) and flipping the classification verdict (not fixable cheaply — above).

`clauseApostrophe`'s DISCOVERED census moved **46 → 48** — one row per new
fixture, and both expose BOTH slots at once (the possessive "your opponent's" AND
the contraction "can't"). Houndoom's is the first entry in that census whose
derived program is a `conditionGate`, i.e. whose apostrophes sit in a sentence read
for a BOARD CONDITION as well as for an op.

**Three stays-LOUD witnesses RE-POINTED, none deleted**: `attackLock.test.ts`
(whose case title moved too — it held BOTH field warrants and now holds one),
`attackPark.test.ts` (its THIRD moved row, and the first on the "an" form) and
`typeNameClause.test.ts`, whose claim got SHARPER rather than weaker: the token
`Basic` must still resolve to nothing THERE, and the failure it now guards against
is not "an unread card" but the worse one — two readers claiming one printed
clause.

### Verification

`bun run check` **GREEN exit 0 — 190 files / 3183 tests** (was 189 / 3142).
engineVersion 0.96.0 → **0.97.0**; `MATCH_RECORD_VERSION` **unchanged at 6**.
ZERO new ops, events, error codes, prompts, parks, state fields, registry rows or
redact arms; no behavioural diff in `attack.ts` / `continuous.ts` / `redact.ts` /
`turn.ts` / `log.ts` / `events.ts` / `flow.ts` / `cardplay.ts` / `rng.ts` /
`registry.ts` / `triggers.ts`, and no web/DB/`@luminous/schema` diff (the
`GameHud.tsx` change is a comment).

### Still unmapped after D148 — ranked by cost

Thirteen censuses are CLOSED and must not be re-run: the heal neighbourhood
(D133/D135), the gated-HEADS neighbourhood (§D134), the counter-MOVE (§D138) and
counter-PUT (§D139/§D140) neighbourhoods, the §9 RECOIL neighbourhood (§D141), the
PREVENT + duration neighbourhood (§D142), the `can't attack` neighbourhood
(§D143), the TAILS-FACE neighbourhood (§D144), the two CONSEQUENT neighbourhoods
(§D145), the ATTACKER-FILTER neighbourhood (§D146), the INCOMING-DAMAGE-REDUCTION
neighbourhood (§D147) and **the OPPONENT-SIDE ATTACK-DENIAL neighbourhood above**.

- **The attacker-side `do {N} less damage` family — 6 printings / 4 sentences
  (§D147's census).** `During your opponent's next turn, attacks used by the
  Defending Pokémon do {N} less damage (BEFORE applying Weakness and Resistance).`
  — Houndoom `sv06.5-008`/`-066` (100, **index 1**), Pikachu `sv02-062` + Pidove
  `swsh10.5-061` (20, index 0), Florges `sv01-093` (30, index 0), plus Entei
  `sv03-030`'s always-on Ability (20). **A durated stamp on the DEFENDER's body
  read at the ATTACKER's pre-W/R step** (`attackerPreWRBonus`) — D147's mirror on
  both axes at once, and it WOULD be the fourth stamped field. ⚠️ Note D148 does
  NOT make this cheaper: `preventAttack.target` is about which BODY an op writes
  to, and this family's difficulty is which SITE reads it. The one existing pre-W/R
  read site is a BONUS, so it needs a signed number or a second term there; the
  Ability wants a `PassiveEffects` sibling, so 5 of the 6 are one slice and 1 is
  another.
- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
  Vengeful Punch `sv03-197` (a Tool, KO-conditioned, no duration — cheapest),
  Lycanroc ex `sv02-117`/`-241` "Scary Fangs" and Mabosstiff `sv02-143`
  "Comeuppance" (stamped fields summed into `passivesOf`'s `damageAttacker`).
  ⚠️ Either of the last two would be the **fourth** stamped field, and per §D147
  the fourth is NOT the generalisation trigger. `installedReductionOf` is the
  template.
- **The PER-ATTACK lock — now 10 printings / 7 sentences (was 8 / 6; §D148's
  census).** `During your next turn, this Pokémon can't use {AttackName}.`
  (Munkidori ex `sv06.5-037`/`-083`/`-091`, Lucario `sv01-114`, Radiant Charizard
  `swsh10.5-011`, Radiant Blastoise `swsh10.5-018`, Skarmory `sv03-142`, Greedent
  ex `sv03-179`) **plus the OPPONENT-side twin — Medicham `sv01-111` and Oranguru
  `sv02-094`, `Choose 1 of your opponent's Active Pokémon's attacks. During your
  opponent's next turn, that Pokémon can't use that attack.`** The self-side eight
  need an attack INDEX (or name) beside the turn and a capture for a PROPER NOUN;
  the opponent-side two need that **plus a PARK** to choose the attack, and D148's
  `target` gets them no closer. ⚠️ This is the **FIFTH stamped field**, i.e. one of
  §D147's three named generalisation triggers — and the one that actually earns it,
  because a payload-carrying member is the case a union is built for. Seismitoad
  `sv03-052`'s durated per-attack BUFF wants the SAME addressing.
- **The §11 CLASSIFICATION TABLE only forces a verdict, it does not check one
  (NEW, §D148).** `preventBlock.test.ts`'s table is total over the discovered op
  set and refuses to go green on an unclassified op — which is real and is how
  D148 found `preventAttack`'s refusal — but flipping a verdict from `blocked` to
  `untouched` fails NOTHING. Making it a proof means driving every `blocked` op
  under a live wide block and asserting `ATTACK_EFFECT_PREVENTED`, which is ~7
  boards and a fixture each. Small, self-contained, and it hardens the guard three
  slices have leaned on.
- **The always-on damage reductions — 2 printings / 2 sentences (§D147).** Rock
  Chestplate `sv01-192` (a **Tool**, {F}-gated on the HOLDER) and Hariyama
  `sv02-113` "Arm Thrust Practice" (a **seat-wide** aura). Both feed the SAME
  number D147 summed into; neither is a duration or an `attackBlock` sibling.
- **The always-on attacker filters — 6 printings / 4 sentences (§D146).**
  Unchanged: `PassiveEffects` siblings of `preventDamageFromExV`, not stamps.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.
- **BLOCKED ON INGEST, NOT ON THE ENGINE (§D146):** Iron Moth `sv06.5-009`'s
  Ancient filter and Slither Wing `sv06.5-026`'s Future bonus. Not slices.

---

## D149 — the ATTACKER-SIDE DAMAGE DEBUFF: `During your opponent's next turn, the Defending Pokémon's attacks do {N} less damage (before applying Weakness and Resistance).` + `…attacks used by the Defending Pokémon do {N} less damage (before applying …).` (engine 0.98.0, MATCH_RECORD_VERSION 6 → 7)

Item 1 of D148's remainder list, and **D147's mirror on both axes at once**: a
durated stamp installed on the DEFENDER's body and read at the ATTACKER's
PRE-Weakness/Resistance step. Half of it is arithmetic and half is a design
question the list wrote down and refused to guess (signed number or second term).

### The resume point's claims, checked before anything was designed

| Claim | Verdict |
|---|---|
| "6 printings" | **TRUE** — 5 attack printings + Entei's Ability, against the local D1 (2026-08-02, 978 cards) |
| "**4 sentences**" | **FALSE by this repo's own counting, and it matters.** It is TWO attack skeletons (plus the Ability), not four: 4 is a byte-distinct-string count, where §D147's own table reads "12 printings / 1 sentence" across three amounts. The consequence is real — the family needs TWO anchors, and the list quoted only ONE of them |
| the quoted template `attacks used by the Defending Pokémon do {N} less damage` | **TRUE OF 2 OF THE 5.** The other three print `the Defending Pokémon's attacks do {N} less damage` — Pikachu `sv02-062`, Pidove `swsh10.5-061`, Florges `sv01-093`. The MAJORITY spelling is the one the list did not carry |
| Houndoom `sv06.5-008`/`-066` "Snarl" (100, **index 1**) | **TRUE on all four facts** — {R}{C}{C}, printed 100, index 1, and the two ids are ONE attack in two rarities (Common / Illustration rare), so D121's second-printing warrant is met by the card |
| Pikachu `sv02-062` + Pidove `swsh10.5-061` "Growl" (20, index 0) | **TRUE** — {C}, NO printed damage, index 0, byte-identical effect strings |
| Florges `sv01-093` "Moonblast" (30, index 0) | **TRUE** — {P}{C}{C}, printed 120, index 0 |
| Entei `sv03-030` "Pressure" (20, an always-on Ability) | **TRUE**, and it is a CROSS-BOARD aura with an Active clause on both ends — `opposingRetreatBlocked`'s shape, not `PassiveEffects`'s. Scoped out, as the list forecast |
| "⚠️ the one existing pre-W/R read site is a BONUS … needs a signed number or a second term" | **TRUE AS A WARNING, WRONG ON THE COUNT** — there are TWO existing pre-W/R read sites (`attack.ts`'s main hit and `snipeActive`), and the debuff wants FOUR |
| "⚠️ D148 makes this NO cheaper" | **TRUE**, and the reason the list gives is the right one: `target` is about which BODY, this family is about which SITE |
| "⚠️ it WOULD be the fourth stamped field, which per §D147 is not a trigger" | **TRUE**, re-derived rather than inherited — all three triggers re-checked, none fires |
| "⚠️ the anchor must carry the parenthetical" | **TRUE**, and asserted in BOTH directions now that the "before" spelling has a reader |
| *(ABSENT)* Florges `sv01-093` is ALREADY IN `FIXTURE_POOL` — **with no attacks at all** | D147's finding in its OTHER form. The fixture has been there since D104 as the Blooming Garden source, verbatim on everything it carried and silently PARTIAL. Entei `sv03-030`'s fixture is missing its Ability the same way |
| *(ABSENT)* Florges's own Ability makes its own printing's step order UNOBSERVABLE | Blooming Garden nulls Weakness on Florges's side, which is the side its debuffed victim attacks into. The ONE printing of the 30 is the one whose parenthetical cannot bite |
| *(ABSENT)* the sentence has NO Active-spot scope, so it reaches the BENCH | Every pre-W/R printing that ADDS damage names its target; neither that SUBTRACTS does. Four read sites, not two |
| *(ABSENT)* three MISNAMED ids elsewhere in the repo | `sv02-109`/`-219` is **Sudowoodo** (called "Cufant"), `sv02-132` is **Honchkrow** (called "Sandile"), `sv06.5-034` is **Malamar** (called "Sharpedo", in four places including a test title). All corrected |

**Fourteen lists in, and this one's miss is in the WORDS again — D142's shape.**
The catalog claims were right to the byte on every id, name, cost, damage and
index; the claim that failed is the one that was COPIED FORWARD from a census
written for a neighbouring question rather than re-queried.

### The census (local D1, 2026-08-02, 978 cards) — D142's rule, EIGHTH time

Run for THIS question — *what printings reduce the damage an attacker DOES,
rather than the damage a defender TAKES, under any duration, gate, Ability or
Tool?* — rather than read off §D147's table, per that slice's own rule.

`LIKE '%less damage%'` over attacks, Abilities AND Trainer text reproduces
§D147's **31 printings / 14 sentences** exactly. The attacker-side half:

| Sentence | Printings | Kind | Status after D149 |
|---|---|---|---|
| `During your opponent's next turn, the Defending Pokémon's attacks do {20\|30} less damage (before applying Weakness and Resistance).` | **3** | attack | ✅ `weakenDefenderAttacks` — Pikachu `sv02-062` idx 0 (20), Pidove `swsh10.5-061` idx 0 (20), Florges `sv01-093` idx 0 (30) |
| `During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying …).` | **2** | attack | ✅ the same op — Houndoom `sv06.5-008`/`-066` idx **1** |
| `As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying …).` | 1 | **Ability** | ❌ a CROSS-BOARD aura, Active clause on BOTH ends — Entei `sv03-030` "Pressure" |
| `This attack does {10\|20} less damage for each damage counter on this Pokémon.` | 5 | attack | ❌ the attacker's OWN damage calc off its OWN counters — a different mechanism (Skeledirge ex ×4, Cetitan `sv01-060`) |

**And the second query, which is the one that closes the neighbourhood:** every
printing whose text contains `before applying` — 19 across attacks, Abilities and
Trainers. **Six of them SUBTRACT and thirteen ADD**, and the split is the finding:

| | Printings | Carries an Active-spot TARGET clause? |
|---|---|---|
| ADD (`do {N} more damage …`) | 12 | **12 of 12 YES** — Vitality Band `sv01-197`, Defiance Band `sv01-169`, Choice Belt `sv02-176`, Practice Studio `sv02-186`, Binding Mochi `sv06.5-055`, Kingambit `sv01-134`/`-220`, Galvantula `sv06.5-002`, Okidogi `sv06.5-074`, Moltres `swsh10.5-012`, Articuno `swsh10.5-024`, Zapdos `swsh10.5-029` |
| ADD, per-ATTACK and durated | 1 | Seismitoad `sv03-052` (`this Pokémon's Echoed Voice attack does 100 more damage`) — no target clause, and unmapped (it wants the per-attack ADDRESS, remainder item 3's mechanism) |
| SUBTRACT | 6 | **0 of 6** — the five above plus Entei |

**That asymmetry is the whole reason the debuff reaches the Bench where the bonus
does not.** `spreadDamage`'s existing comment says the bonus is "Active-target-
only", which is true of every printing that grants one; nothing that takes damage
AWAY says any such thing. It is a printed fact, not a ruling.

`reduce`, `reduced`, `minus` and `half the damage` appear in **ZERO** printings —
the pool spells every one of these as "less damage", which is why the query is
what it is. So the attacker-side neighbourhood is **6 printings / 3 skeletons
(5 mapped here, 1 refused)**, and the whole "less damage" neighbourhood is now
**26 of 31 printings simulated**, the remainder being Entei, Rock Chestplate,
Hariyama and the 5 own-counter printings.

### ⚠️ A SECOND TERM, NOT A SIGNED BONUS — the design question the list asked

`attackerPreWRBonus` (interpreter.ts) folds `passivesOf(attacker)`'s three
channels — the flat Tool bonus, the board-conditional one and the target-suffix
one — into a single number, at two sites. Making it signed would have been ONE
LINE and zero call-site diff. Refused on three grounds, all observable:

| # | Ground | What it would cost |
|---|---|---|
| 1 | `DAMAGE_DEALT.bonus` is a REPORTED field, emitted only when positive and documented as what continuous effects **ADDED** | A −100 vanishes from the row AND from the log line a player reads |
| 2 | That function folds `passivesOf`, the CATALOG scan, which is **SUPPRESSED under a §9 Ability-lock aura** | An attack INSTALLATION would become silenceable by Klefki — D147's own reason for keeping `installedReductionOf` out of `passivesOf`, on the other side of the table |
| 3 | Only the debuff can drive the pre-W/R subtotal NEGATIVE | The clamp would have to move into a function whose contract has never needed one |

So `installedAttackDebuffOf` (continuous.ts) is `installedReductionOf`'s exact
mirror, subtracted BESIDE the bonus at the read sites and reported in a `debuff`
field of its own. **It also leaves the always-on member somewhere to land**: Entei
becomes a sibling scan summed beside this call at the same four sites, and nothing
built here has to move for it.

### ⚠️ The §8.5 ORDERING, pinned by driving it BOTH WAYS

`ptcg-rules.md` §8 step 5 puts "+X modifiers from the attack/effects that add to
base damage *before* Weakness" first, and the catalog prints the same thing in
parentheses on all six of these. The suite re-derives every `DAMAGE_DEALT` row
from its OWN reported fields in both placements, through the engine's own
`applyDamageModifier`, and asserts they differ wherever a Weakness is present:

| Board (all printed cards, no surgery) | printed order | reversed order | what the difference IS |
|---|---|---|---|
| Houndoom `sv06.5-008` Snarl (100 debuff) → Alomomola `sv01-048` "Aqua Slash" (120 Water) into ×2 Water | `max(0,120−100)×2` = **40** | `120×2 − 100` = **140** | 3.5×, and a 120 HP body that LIVES on one reading and dies on the other |
| Pidove Growl (20) → Pikachu "Pika Bolt" (30 Lightning) into ×2 Lightning | `max(0,30−20)×2` = **20** | `30×2 − 20` = **40** | 2× |
| Pidove Growl (20) → Rotom `sv01-069` "Linear Attack" (20, `snipeActive`) into ×2 Lightning | **0** | **20** | the second W/R site, and the debuff exactly equals the base |
| Houndoom Snarl (100) → Alomomola "Surf" (30 Water) into ×2 Water | **0** | **0** | the CLAMP, where the two agree — so it is asserted as a number, not as an order |
| the same board **with a benched Florges** | *equal* | *equal* | **Blooming Garden — the parenthetical CANNOT bite** |
| any hit into a −30 Resistance carrying a debuff | *equal* | *equal* | additive, so it COMMUTES |

**The Florges row is the finding.** `sv01-093` prints the 30 AND carries "Your
Pokémon in play have no Weakness", and Florges's own side is the side its
debuffed victim attacks INTO — so the ONE printing of the 30 is the ONE printing
whose ordering claim cannot be driven on its own board. Pinned as a PAIR (same
board ± a benched Florges: 20 → 10), which makes the claim about the AURA rather
than about a different set of cards. **Flipping the order fails 6 at the main hit
and 1 at `snipeActive`.**

**THE CLAMP IS AT THE PRE-W/R STEP.** "This attack does {N} less damage" is a
statement about the attack's OUTPUT, and §8.5 says damage cannot go below 0. On
every board the pool can print the two placements agree — every catalog Weakness
is `×2` and every Resistance `-30`, so a negative subtotal is still 0 afterwards —
and they diverge only under the old-era ADDITIVE weakness the engine's own
`DamageModifier` still admits (`max(0, 50−100) + 20 = 20` against
`50 + 20 − 100 → 0`). Written at the step it belongs to and pinned as arithmetic,
D147's move on its commuting case.

**A CLAMPED ZERO IS NOT A PREVENTION**, and it is also not an attack that "did
damage". `prevented` stays ABSENT (the same 0 is two different facts: a §11 block
SUPERSEDES the pipeline, this one RAN it), and the `dealt > 0` boundary is driven
from **both** sides with Rocky Helmet `sv01-193` worn by the installer — a
debuffed swing clamped to 0 draws no §9 recoil and no KO; the same board at 40
draws a 20-counter `COUNTERS_PLACED`. D141/D145's boundary, measured rather than
assumed absent.

### ⚠️ Two anchors, and what they share is the OP

One anchored whole-sentence regex per PRINTED STRING (D136/D137). The two differ
in the subject noun phrase (*"the Defending Pokémon's attacks do"* /
*"attacks used by the Defending Pokémon do"*) and in nothing else, so an
alternation would be two patterns wearing one name — D148's call on its own pair.
What they share is the ACTION, shared as an OP and **asserted byte for byte at a
common amount**, with the two source strings asserted to be genuinely different so
the comparison is not a regex checked against itself.

- **Sentence ONE carries the SAME apostrophe slot TWICE** (*"your opponent's"* AND
  *"the Defending Pokémon's"*) — the first entry in `clauseApostrophe`'s census to
  do so, and both are classed `['’]`. A build that folded only the first would
  pass every earlier row and fail this one; the suite drives each slot separately.
- **No compound rides in front of either** (censused), so the `^…$` anchors are
  under no pressure from a third clause — unlike D145's discard.
- **The parenthetical is inside both anchors** and its refusal is now asserted in
  BOTH directions, D147's sentence against these and these against D147's.

### ⚠️ The VOICE — the third answer, and the first where the sibling would have LIED

`seat` owns the debuffed Pokémon (D136's finding 1). This op has **no self arm**,
so `ATTACK_DEBUFF_APPLIED` is the family's first row that is victim-side BY
CONSTRUCTION rather than by which printing fired:

| Row | Whose body `seat` names | Wording spoken from |
|---|---|---|
| `ATTACK_BLOCK_APPLIED` (D142/D146) | always the ACTOR's | the installer's chair — and honest, because the row renders under the installer |
| `DAMAGE_REDUCTION_APPLIED` (D147) | always the ACTOR's | ditto ("…during your opponent's next turn") |
| `ATTACK_LOCKED` (D143/D148) | actor's on 22 printings, victim's on 4 | the AFFECTED player's ("…next turn") — seat-independent, which is why D148 owed no new arm |
| `ATTACK_DEBUFF_APPLIED` (D149) | **always the VICTIM's** | must be the affected player's |

Copying D147's wording would render *"…during your opponent's next turn"* under
the VICTIM's name, naming the one turn the debuff is NOT live on. So the phrasing
is D143's — *"<name>'s attacks do {N} less damage next turn"* — which under this
family's seat rule always means the named player's own next turn. **Copying D147's
wording fails 1; rendering the row under the actor fails 1.** A debuff that FIRES
emits nothing: `DAMAGE_DEALT.debuff` carries the number on the row whose
arithmetic it changed, with a `· weakened −N` crumb printed BEFORE the Weakness
one so the log reconstructs §8.5 in printed order.

### ⚠️ The §11 refusal — forced by the table, DRIVEN because the table cannot check

`preventBlock.test.ts`'s classification gains `weakenDefenderAttacks: "blocked"` —
`reduceDamage`'s verdict INVERTED, because the two are the same record on opposite
bodies and this one writes onto the DEFENDING Pokémon. The interpreter owes
`attackEffectRefused`, `preventRetreat`'s and D148's `preventAttack` check
verbatim, asked on the defender's seat. Reachable off printed cards: the defender
installs a wide block on their own turn, its window is the installer's very next
turn, and that is the turn this debuff would land on.

**D148's measurement re-run and still true: flipping the verdict fails NOTHING.**
So the behaviour is pinned by a live-block board in the slice suite, in BOTH
directions (a live block refuses and says `ATTACK_EFFECT_PREVENTED`; an expired one
does not). Hardening the table itself is still a remainder item and was
deliberately not smuggled in here.

### ⚠️ The §10 clears — a FIFTH reachability story on what are now five fields

The window is the HOLDER's own next turn, so all three routes off the Active Spot
are lines of play the holder can take INSIDE it — and the holder is the VICTIM, so
they are COUNTERPLAY (D148's agency) rather than an escape from a chosen drawback:

| Moment | Debuffed? | Why |
|---|---|---|
| The install resolves (attack tail, turn N) | **no** | the printed word is "NEXT" |
| The victim's whole turn N+1 | **YES** | the printed window — every damage their attacks do |
| The installer's turn N+2 onward | **no** | expired by arithmetic; the stale stamp answers nothing |
| The victim RETREATS inside the window | **no** | §10 — and the promoted body attacks at full |
| The victim SWITCHES it out | **no** | §10 (`switchInto`) |
| The victim EVOLVES it | **no** | §10 — the cheapest counterplay: Alomomola → `fix-mola-stage1`, whose "Bubble" then lands 80 instead of 0 |
| Knocked Out by the installing attack | — | the stack leaves play; the promoted body carries nothing (a LINE, since Snarl's 100 kills a 60 HP Rotom) |
| Installed twice on one turn | the LARGER | `Math.max`, unreachable off any printing, DRIVEN through the interpreter off a constructed prior stamp |

**⚠️ AND THERE IS NO BOSS'S ORDERS IN THIS SLICE'S DECK**, unlike every earlier
durated deck — the absence is the point. The FORCED half of `switchInto` is
UNREACHABLE for this field: the installer's turn ended when they declared, so
nobody but the victim can move the debuffed body while it is live.

### The four structural questions

1. **PARK?** No — `weakenDefenderAttacks` is deterministic, consumes no rng and
   asks nothing, so no `EffectContinuation` can carry it.
   **`MATCH_RECORD_VERSION` 6 → 7**, D124's reason verbatim and the FIFTH time on
   the same trigger: a REQUIRED key on `InPlayPokemon` makes every body in an
   older record the wrong TYPE, and the fact that it would read back benignly
   (`undefined.turn` is never `state.turn`) is precisely the soft landing that
   constant exists to refuse. **D148 in between did NOT bump**, which is the
   control that shows the trigger is the KEY and not the family.
2. **VOICE?** VICTIM-side, and the first row in the family that is so BY
   CONSTRUCTION — see the table above. The sibling's wording was checked by
   RENDERING it and reading it, and it would have named the wrong turn.
3. **GUARD ASSERTED?** Four ways, and two paid: the PRODUCER SET is swept out of
   the pool rather than listed — **which is what found the incomplete Florges
   fixture**; the §11 classification table forced a verdict, and because that
   table is known-weak the verdict was DRIVEN in both directions; the §8.5
   ordering is asserted against a re-derived oracle on every row rather than
   against typed numbers; and both BENCH read sites are driven off printed cards
   rather than surgeried, since a debuffed attacker CAN legally spread.
4. **MECHANISM EXISTS?** Read first (`attackerPreWRBonus`), and the answer changed
   the design: it is a `passivesOf` FOLD, not a bare number, which is what turned
   "signed or second term" into a decision with three observable grounds rather
   than a preference. The record shape, the stamp convention, the clamp and the
   three §10 clears all existed (D147); **what this slice added is the
   DIRECTION and the STEP.**

### The suite — `attackDebuff.test.ts` (41 tests)

Its own `ATTACK_DEBUFF_DECK`, **SEED-FREE** (no printing of this family carries a
coin) and pinned by an unchanged `rngState` across an install. **The first deck in
this family that is asymmetric in TWO directions at once**: the installers matter
on P1 and the victims on P2, and the victim is also the ATTACKER a turn later — so
every board is a PAIR of cards chosen for the installer's Weakness line.

Four driven installers covering all three amounts across both sentences and both
printed indices; one victim per READ SITE (Pikachu's "Pika Bolt" for the main hit,
Rotom `sv01-069` for `snipeActive`, `fix-sniper` for `spreadDamage`, `fix-bramble`
for `placeSnipe`'s `deals` arm); Alomomola `sv01-048` doing four jobs (surviving
Snarl's 100, the ordering pin, the clamp board, and the §10 evolve line into
`fix-mola-stage1`); Entei `sv03-030` doing two (a 130 HP body that survives
Moonblast's 120, and the stays-LOUD always-on witness on the same board its
Ability would have bitten).

**Mutation-checked twenty-two ways:** dropping the possessive anchor fails **26**,
writing onto `ctx.seat` **22**, stamping `state.turn` **20** and `+ 2` **20**,
dropping the "used by" anchor **13**, dropping the main-hit term **9**, dropping
the row's `debuff` field **9**, moving the main-hit subtraction after W/R **6**,
either anchor's parenthetical **2** each, and **1** each for moving the
subtraction after W/R at `snipeActive`, dropping the term at `spreadDamage` /
`placeSnipe`, dropping `attackEffectRefused`, merging by `Math.min`, ignoring the
turn stamp at the reader, the three §10 clears, either anchor's `^`, anchor one's
`$`, the `amount >= 1` guard, the log breadcrumb, the log wording and the log seat.
**ONE mutation SURVIVED and is reported rather than buried:** flipping the §11
classification verdict, which is D148's own measured weakness (remainder item).

`clauseApostrophe.test.ts`'s DISCOVERED census moved **48 → 51** — three rows for
one family, because sentence one varies by a NUMBER (the 20 and the 30 are two
rows on a `sentence` census even though they are one anchor with one capture) and
sentence two is the third. **One stays-LOUD witness RE-POINTED, none deleted**
(`damageReduction.test.ts`, NULL → SHAPE), and its claim got SHARPER rather than
weaker: the demand is no longer "nothing reads this" but "the other reader reads
it and this one still does not" — two readers must not claim one printed clause.

### Verification

`bun run check` **GREEN exit 0 — 191 files / 3224 tests** (was 190 / 3183).
engineVersion 0.97.0 → **0.98.0**; `MATCH_RECORD_VERSION` **6 → 7**. ZERO new
prompts, parks, clause-table rows, `BoardCondition` members, error codes, registry
rows or redact arms; no `redact.ts` / `flow.ts` / `cardplay.ts` / `rng.ts` /
`registry.ts` / `triggers.ts` diff and no web/DB/`@luminous/schema` diff beyond the
one constant.

### ⚠️ The name sweep — THREE misnamed ids, all pre-existing, the third slice in four

Run over every id named in the touched files and then over the whole repo, by
QUERY rather than by recognition. It found three, none of them this slice's:

| id | Repo said | The D1 says | Where |
|---|---|---|---|
| `sv02-109`/`-219` | "Cufant" | **Sudowoodo** ("Hit and Hide") | `effects.ts` (D142's census comment) and §D142 above. Cufant is real at `sv02-149`/`sv06.5-041`/`-076` and prints none of this |
| `sv02-132` | "Sandile" | **Honchkrow** ("Dirty Throw") | `attackRequirement.test.ts` (D125). Sandile is `sv01-115`/`-216` |
| `sv06.5-034` | "Sharpedo" | **Malamar** ("Colluding Tentacles") | `effects.ts`, `index.ts`, `attackRequirement.test.ts` **including a test TITLE**, §D125's table, progress.md. Sharpedo is `sv03-047` |

All corrected in place. **A NAME IS THE ONE FIELD NOBODY RE-QUERIES** — and this
sweep is worth running even on a slice that touches none of the cards it names.

### Still unmapped after D149 — ranked by cost

Fourteen censuses are CLOSED and must not be re-run: the heal neighbourhood
(D133/D135), the gated-HEADS neighbourhood (§D134), the counter-MOVE (§D138) and
counter-PUT (§D139/§D140) neighbourhoods, the §9 RECOIL neighbourhood (§D141), the
PREVENT + duration neighbourhood (§D142), the `can't attack` neighbourhood
(§D143), the TAILS-FACE neighbourhood (§D144), the two CONSEQUENT neighbourhoods
(§D145), the ATTACKER-FILTER neighbourhood (§D146), the INCOMING-DAMAGE-REDUCTION
neighbourhood (§D147), the OPPONENT-SIDE ATTACK-DENIAL neighbourhood (§D148) and
**the whole pre-W/R DAMAGE-ADJUSTMENT neighbourhood above** (the `before applying`
query, which covers the ADD half as well as the SUBTRACT half).

- **The §9 recoil FAMILY — 5 printings**, unchanged from §D141/§D142/§D143.
  Vengeful Punch `sv03-197` (a Tool, KO-conditioned, no duration — cheapest),
  Lycanroc ex `sv02-117`/`-241` "Scary Fangs" and Mabosstiff `sv02-143`
  "Comeuppance" (stamped fields summed into `passivesOf`'s `damageAttacker`).
  ⚠️ Either of the last two is now the **FIFTH** stamped field, i.e. one of
  §D147's three named generalisation triggers. Re-read §D147's table before
  choosing a shape; `installedReductionOf` / `installedAttackDebuffOf` are the
  template either way.
- ~~**The §11 CLASSIFICATION TABLE only forces a verdict, it does not check one.**~~
  **DONE at §D150** — every verdict is now DRIVEN under a live wide block, both
  directions, and flipping one fails. See §D150.
- **The PER-ATTACK lock — 10 printings / 7 sentences (§D148's census).**
  Unchanged, and it is the FIFTH stamped field with a PAYLOAD, which is the case a
  union is built for. Seismitoad `sv03-052`'s durated per-attack BUFF (**+100
  before W/R**, confirmed by §D149's `before applying` census) wants the SAME
  addressing and would read at the very sites D149 just built — so three shapes may
  be one mechanism.
- **Entei `sv03-030` "Pressure" — 1 printing, NEW as its own item (§D149).**
  *"As long as this Pokémon is in the Active Spot, attacks used by your opponent's
  Active Pokémon do 20 less damage (before applying Weakness and Resistance)."* The
  always-on member of the family D149 just built, deliberately scoped out: a
  CROSS-BOARD aura with an Active clause on BOTH ends, which is
  `opposingRetreatBlocked`'s shape (continuous.ts), not a stamp's and not a
  `PassiveEffects` field's. Cost: one `PassiveEffects` flag, one scan beside
  `installedAttackDebuffOf`, summed at the SAME four read sites — plus **the
  fixture's printed Ability, which `FIXTURE_POOL` does not currently carry**.
  Genuinely small now that the read sites exist.
- **The always-on damage reductions — 2 printings / 2 sentences (§D147).** Rock
  Chestplate `sv01-192` (a **Tool**, {F}-gated on the HOLDER) and Hariyama
  `sv02-113` "Arm Thrust Practice" (a **seat-wide** aura). Both feed the number
  D147 summed into; neither is a duration.
- **The always-on attacker filters — 6 printings / 4 sentences (§D146).**
  Unchanged: `PassiveEffects` siblings of `preventDamageFromExV`, not stamps.
- **Iron Moth `sv06.5-009` "Suction" + Camerupt `sv03-032`** — unchanged. Do it
  last or not at all.
- **BLOCKED ON INGEST, NOT ON THE ENGINE (§D146):** Iron Moth `sv06.5-009`'s
  Ancient filter and Slither Wing `sv06.5-026`'s Future bonus. Not slices.

## D150 — HARDENING, NOT A CARD SLICE: the §11 classification table is a PROOF (engine 0.98.0 UNCHANGED, MATCH_RECORD_VERSION 7 UNCHANGED — TEST-ONLY, 0 engine lines)

**⚠️ THIS APPEARS IN NO CENSUS, AND SAYING SO IS PART OF THE ENTRY.** It maps no
printed sentence, adds no op, no field, no event, no error code, no registry row,
no fixture and no deck. A future session sweeping the pool for "what is still
unmapped" will not see it, and the §"Still unmapped after D149" list above is
unchanged by it except for the one item it closes.

### What was wrong
`preventBlock.test.ts`'s `CLASSIFIED` table is total over the op set the deriver
can emit and refuses to go green on an UNCLASSIFIED op — which is real, and is how
D148 and D149 both got their verdicts asked. But it asserted only that every op HAS
a verdict, never that the verdict is TRUE. **§D148 measured that. §D149 re-measured
it. This slice measured it a THIRD time before touching anything** — flipping
`weakenDefenderAttacks: "blocked"` to `"untouched"` and running the suite: **37
tests, all green, nothing failed.** Then fixed it. The lesson is not "the table was
weak"; it is **if a finding survives two handoffs unfixed, fix it on the third**.

### The shape of the fix
A `PROBES` table paired **1:1** with `CLASSIFIED`, asserted total in BOTH directions
(classified-but-undriven fails; driven-but-unclassified fails). Twenty ops, one
**constructed single-op program** each — D144's precedent, and the right call here
because the question is per-OP while a printed attack answers for its whole program,
and several arms have no printing at all. Each is fed straight to `runProgram` from
P2's chair with `invokedBy: "attack"`, against a P1 Active carrying a live
`{ turn: 3, effects: true }` block (the same `installed()` board the rest of the
suite uses), and each carries a `landed` predicate read off the **resulting state**
rather than off the absence of a refusal — *"nothing was prevented" is not evidence
that anything happened*.

- `blocked` → the op must NOT land **and** must show POSITIVE evidence: the
  `ATTACK_EFFECT_PREVENTED` row (asserted whole — `seat` is the VICTIM's and `uid`
  the shielded body, D136's finding 1) **or** a `DAMAGE_DEALT` row nulled to 0 with
  `prevented: true`. One or the other, never neither.
- `untouched` → the op must land in FULL, un-refused and un-nulled.

**A ONE-SIDED PROOF WOULD NOT HAVE BEEN ONE.** A guard that refused EVERYTHING
passes the `blocked` half and fails only the `untouched` half, which is exactly why
both are driven.

### The verdict that MOVED — `damageDefender`, `untouched` → `blocked`
Sharpening the vocabulary from *"who owes the check"* to **"what a live block
DOES"** moved an op on the spot. Its comment read *"routes into `snipeActive`, which
IS guarded"* — a true statement about where the guard lives and the wrong answer to
the table's question, since `snipeActive`'s `attackDamageBlocked` nulls its damage
to 0 exactly as it nulls the main §8.5 hit. **This is the FOURTH verdict this table
has settled (`preventAttack` at D148, `reduceDamage` at D147, `weakenDefenderAttacks`
at D149) and the FIRST settled by a board rather than by an argument.**

### The walker question, RE-ASKED rather than inherited — and D148's blindness one level out
`walkKinds` IS now genuinely total over EffectOp nesting: `coinFlipGate.then`,
`conditionGate.then`/`.otherwise` and `recordGate.then`/`.otherwise` are the **only**
`EffectOp[]` positions the union admits, verified by reading `effects.ts` rather than
trusting D148's fix. **But the SOURCE sweep was not total.** `attackOpKinds()` read
`deriveAttackEffect` and the registry only — and **`deriveAttackCoinFlip`'s
`programPerHeads` member (D130) carries `ops: EffectOp[]` of its own**, expanded once
per heads by `attack.ts`. That is a whole reader the sweep never opened: D148's
finding wearing a different hat. It is complete **by luck** today, because both
printings (Wugtrio `sv01-057`, Gyarados `swsh10.5-022`) expand to `discardDeckTop`,
which D142's own reading emits bare elsewhere. The arm is added — **and reported
honestly: removing it fails NOTHING**, precisely as removing D148's `conditionGate`
arm failed nothing. *A blind traversal cannot be pinned off the pool that hides it.*
**Ask not only what your walker descends, but how many FUNCTIONS hand an attack a
program. The answer is two, not one.**

### The two surgeries, and why they are surgeries
- **`spreadDamage`** needs the block on a **BENCHED** body, which **no printing can
  produce**: the install writes the stamp onto the installer's own Active and §10
  sheds it the moment that body leaves the spot (the Boss's Orders case in this same
  suite drives exactly that). Stamped by hand, and said so.
- **`damageChosen`** runs on a board whose P1 Bench is **EMPTY**, so the
  `opponentAny` pick is FORCED onto the Active and the run completes without a park
  — which is also the arm the §11 guard actually sits on (`damageActive`).

### An engine asymmetry found and DELIBERATELY not fixed
`placeSnipe` (interpreter.ts, ~line 2261) pushes `COUNTERS_PLACED` for
`damageChosen`'s put-counter arm at a **BENCH** target with **no
`attackEffectRefused` check** — where the Active arm has one, and where
`spreadDamage` and the `deals` arm both consult `attackDamageBlocked` per benched
body *"for the reason these sites must be TOTAL rather than case-covering"* (the
interpreter's own words, three lines away). **Unreachable today** — a wide block can
only ever be live on an Active — so this slice, whose constraint was test-only, left
it and wrote it down with its line number. One line plus one probe board whenever
someone next touches `placeSnipe`.

### That the harness is pinned to the ENGINE, not to itself
- Dropping `attackEffectRefused` from `preventRetreat` (interpreter.ts) **fails 2**.
- One case re-drives the same board with the block **surgically removed** and asserts
  `preventRetreat` lands — so the whole harness cannot go vacuous the day the seed
  table drifts or the stamp arithmetic changes.

### Mutation table (five verdict flips, both directions — ALL now fail)
| mutation | before D150 | after |
|---|---|---|
| `weakenDefenderAttacks` blocked → untouched | 0 fail | **1 fail** |
| `heal` untouched → blocked | 0 fail | **1 fail** |
| `damageDefender` blocked → untouched | 0 fail | **1 fail** |
| `preventAttack` blocked → untouched | 0 fail | **1 fail** |
| `reduceDamage` untouched → blocked | 0 fail | **1 fail** |
| drop the new `programPerHeads` sweep arm | — | **0 fail** (reported, not buried) |
| drop `attackEffectRefused` from `preventRetreat` (engine) | — | **2 fail** |

### Cost
**0 engine lines.** `preventBlock.test.ts` only: **33 → 37 tests**. `engineVersion`
stays **0.98.0** and `MATCH_RECORD_VERSION` stays **7** — said explicitly rather than
bumped by habit, because nothing persisted moved. `bun run check` **GREEN exit 0 —
191 files / 3228 tests** (was 191 / 3224).
