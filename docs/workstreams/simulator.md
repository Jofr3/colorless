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
  ctx.
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

## Notes for effect authoring at scale
Authoring handlers for many cards is a natural **Workflow** fan-out (one agent per
set/card batch, each verified against the rules doc). Ask the user before
launching one. The mechanics all live in `interpreter.ts` (op programs incl.
spreadDamage, the `damageChosen` snipe + `attachEnergyFrom`), `continuous.ts` (persistent-zone
modifiers + special-energy provision), `triggers.ts` (triggered-Ability scan
points — onPlayToBench/onEvolve/betweenTurns/**onKnockOut**) and `registry.ts`
(EnergyProgram, StadiumEffects, PassiveEffects, TriggeredAbility incl. the on-KO
`onKoPrizeGuard`, AbilityProgram incl. activation `cost`, op programs), and the
KO flow reaches the whole board (attacks, the Checkup, a mid-turn snipe via the
shared `settleProgram`, and now an on-KO trigger that can pause the sweep for a
decision via the `koTrigger` stage + `resumeTail`), so a new card in a known
family is a few lines of data in `registry.ts` — the fan-out adds rows, not code.
