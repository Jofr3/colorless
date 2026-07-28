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
