# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-19 — build session #16 (**P3-M5 coverage pass #1** — a
classify→verify **Workflow fan-out** (10 agents) over the 140 un-authored sv01–03
Trainers/Energy/Abilities found only **5 expressible with the current ops**
(landed: Poké Ball, Pokémon Catcher, Nemona, Copperajah ex, Stonjourner) and
**113 needing new ops** — coverage is op-bound, so the deliverable is the ranked
**new-op backlog** (`docs/reference/coverage-backlog.md`) that sequences the next
slices. Additive registry rows only — no engine change; 1080 → **1087** tests,
`bun run check` + `vite build` green. Prior: build #15 = **P3-M4 slice 9: on-KO
triggered Abilities** (§8.1) — a "when this Pokémon is Knocked Out" Ability fires
mid-KO-sweep DURING the opponent's turn, **closing M4**. Two forms on
`TriggeredAbility` (trigger `"onKnockOut"`): a coin-flip **Prize GUARD**
(`onKoPrizeGuard` — Glimmora "Shattering Crystal", heads → the opponent takes no
Prize for it) resolved INLINE in the KO sweep via a new `planPrizes` run UP FRONT
so the §14 tie guard stays exact; and a parking **PROGRAM** run as a new
`koTrigger` PendingStage that folds through `settleProgram` with a new
`resumeTail` flag — it PARKS on `effect:choose` (the KO'd, NON-turn player
decides) and the sweep RESUMES draining the prize/promotion tail. Representatives
Glimmora (sv02-126, real) + fix-onko (FIXTURE — no real SV on-KO Ability parks;
the fix-sniper precedent); built solo, **2-agent Opus review BOTH CLEAN — no
HIGH/MED/LOW correctness bugs** (the §14 tie guard × prize denial enumerated over
all 4 coin-flip combos × 60 seeds, proven exact), one LOW test-framing fix
applied. Suite 1066 → **1080**, `bun run check` green, `vite build` green;
engineVersion 0.10.0 → 0.11.0.).

## Resume point
**M5 coverage pass #1 is done — the ranked new-op backlog is the roadmap.** A
classify→verify **Workflow fan-out** (10 agents, 0 errors) classified the 140
un-authored sv01–03 Trainers/Energy/Abilities against the current op vocabulary:
**5 authorable now** (landed), **113 needs-op**, 22 already-authored. Coverage is
**op-bound, not authoring-bound** (~4% expressible today), so the deliverable is
BOTH the 5 landed registry rows AND the **new-op backlog**
(`docs/reference/coverage-backlog.md`) ranked by cards-unlocked. **Landed:** Poké
Ball (sv01-185, `coinFlipGate → [searchDeck anyPokemon→hand, shuffleDeck]`),
Pokémon Catcher (sv01-187, `coinFlipGate → [gust]`), Nemona (sv01-180,
`drawCards 3`), Copperajah ex (sv02-150, passive −30 after W/R), Stonjourner
(sv01-121, passive −20). The fan-out mis-placed Poké Ball's shuffle outside the
coin gate (tails would reorder the deck) — hand-fixed + test-pinned (the reason
authorable programs are hand-verified before landing). First Trainers to use
`coinFlipGate`, so the `ATTACK_EFFECT_COIN_FLIP` log copy was neutralized. No
engine mechanism changed (additive data); engineVersion stays 0.11.0. Suite 1080
→ **1087**; no 2-agent slice review (fan-out classify+verify + hand-verify +
tests). See "M5 coverage pass #1 as built".
**Next concrete actions (build the backlog, highest-unlock first):**
1. **`attachEnergyFrom`** — the single biggest unlock (11 cards, and the engine
   of most evolving-deck Abilities): an op that attaches Energy from a source
   (deck/discard/hand) matching a filter to a chosen Pokémon. A normal engine
   slice (new op + interpreter case + registry rows + tests + 2-agent review).
2. Then **`discardPileRetrieval`** + extra **`CardFilter`** kinds (Item/Tool/
   Evolution/no-rule-box), **`lookAtTopN`**, **`moveEnergy`**, the
   **`conditionalPlay`/`conditionalGate`** family, and the **hand-refresh
   Supporter family** (Iono/Judge/Marnie) — each turns dozens of "needs-op" rows
   into data rows. Full sequencing in `docs/reference/coverage-backlog.md`.
3. Or pivot to **P4 (online matches)** — the P3 engine is now broad enough to
   play real games; the projection is already the per-viewer filter P4 applies.
   (A further coverage pass can run in parallel or later.)

---
### Prior resume point (P3-M4 slice 9, kept for continuity)
**on-KO triggered Abilities are live (P3-M4 slice 9, D30) — M4 IS COMPLETE.** A
"when this Pokémon is Knocked Out" Ability (§8.1) fires mid-KO-sweep DURING the
opponent's turn — the inverse of the slice-8 snipe (the KO fires the trigger).
`TriggerTiming` += **`"onKnockOut"`**; detection is triggers.ts
**`onKnockOutTrigger`** (via `cardIdByUid → programFor`, valid after the KO
discarded the card), but flow.ts's KO sweep DRIVES it. Two forms on
`TriggeredAbility`: (1) a coin-flip **Prize GUARD** (`onKoPrizeGuard:
"coinFlipPrevent"` — Glimmora: heads → the opponent takes no Prize for it),
resolved INLINE by a new **`planPrizes`** (flow.ts) run UP FRONT — before the §14
tie-guard speculation — threading rng ONCE so the speculation and the real KO
share the post-flip count (§14 stays exact), the guard's events firing after the
`KNOCKED_OUT`; and (2) a general parking **PROGRAM** run as a new **`koTrigger`
PendingStage** (`advance` → **`runKoTrigger`** → **`settleProgram` with a new
`resumeTail`** flag): it PARKS on `effect:choose` (where `phase.seat` is the KO'd,
NON-turn player) and, on `resolveEffect`, the sweep RESUMES draining the queued
prize/promotion tail instead of folding back to a turn. Batch order:
PRIZES-first, then koTriggers, then promotions; a §14 game-ending prize skips the
program, while the guard (resolved earlier) can DENY a winning prize.
Behaviour-neutral for every card with no on-KO Ability. Representatives Glimmora
(sv02-126, real) + fix-onko (FIXTURE — no real SV on-KO Ability parks). **Web:**
the projection's `effect:choose` case reads the turn owner via `koParkActiveSeat`
when `resumeTail` (activeSeat ≠ waitingSeat — the KO'd player owes it
mid-opponent-turn); the parked decision reuses the `chooseCards` dialog; two new
log rows (`ABILITY_COIN_FLIP`, `PRIZE_PREVENTED`). engineVersion 0.10.0 → 0.11.0.
See "M4 slice 9 as built" + D30.
**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no
HIGH/MED/LOW correctness bugs.** The engine agent enumerated the §14 tie guard ×
prize denial over ALL FOUR coin-flip combos × 60 seeds and proved every
win/tie/continue outcome exact (post-flip counts, one rng advance), proved the
no-ability path byte-equivalent, and probed the resume-the-tail across all three
KO callers (attack / checkup / mid-turn). The web agent proved `koParkActiveSeat`
names the right owner in each origin, the viewer-follow flips to the KO'd player
and back, the dialog dispatches `resolveEffect` for the KO'd seat, and NO
demo/`/play` regression (a non-`resumeTail` park is byte-identical). One engine
LOW (a seed-fragile / misframed §14 test of mine) FIXED — it now pins both guard
branches (heads denies the win) + a deterministic fix-onko §14-skips-the-program
test; one web INFO is the pre-existing P4 hidden-info gap (not slice-9).
**Verification:** `bun run check` green (**1080 tests** — 1066 → 1080: 11 engine
`onKnockOut.test.ts` + 1 projection + 1 log + 1 DOM), production `vite build`
green. No live /play smoke this session (representatives not demo-reachable; NO
demo deck / projection path for existing cards changed — the demo boot is
byte-identical to slice 8's; the slice-6/8 precedent).
Next concrete actions:
1. **P3 M4 is COMPLETE — the next milestone is M5, the coverage-expansion
   Workflow fan-out** across the SV-era pool (track % simulated). Every mechanic
   now lives as DATA in `registry.ts` (op programs, EnergyProgram, StadiumEffects,
   PassiveEffects, TriggeredAbility incl. `onKoPrizeGuard`, AbilityProgram incl.
   activation `cost`), and the KO flow reaches the whole board (attacks, Checkup,
   the mid-turn snipe, and now an on-KO trigger that can pause the sweep), so a
   new card in a known family is a few registry rows, not code. **Ask the user
   before launching a fan-out** (large multi-agent run).
2. Or begin **P4 (online matches)** — run the P3 engine authoritatively inside
   the lobby DO. The projection is already the per-viewer filter P4 will apply;
   the logged P4 blockers (the HUD reading raw GameState for payability; the
   `effect:choose` prompt carrying the actor's search candidates unredacted; the
   opponent-hand/setup opaque-alias re-key) are collected across the M2–M4 notes.
3. **Slice-6 follow-up (still open):** the slice-6 (triggered Abilities) review
   was cut short by the usage limit — a `/code-review` re-run over commit
   `a634b30` is logged (user opted to defer it while building later slices).

Unchanged user-side blockers: web prod build/deploy story unset
(`VITE_API_ORIGIN` at build time; CSP derives from it); deployed Worker's
`APP_ORIGIN` still `http://localhost:5173`; OAuth 503 until the
Discord/Google apps + four secrets exist (see 2026-07-13 entry for details).
A `?full` batch param on `GET /cards` is a logged follow-up to bundle with
the next api deploy (D18).

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | ✅ M1–M9 + P2-M1 + task-17 api deployed (Worker `9b1ec1d1`, 2026-07-16); OAuth secrets pending (user) |
| deck-builder | P2 | ✅ ALL 19 tasks closed (task 17 landed + e2e-verified locally); only follow-ups left |
| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 coverage pass #1 done** (M4: D22–D30, evolution→on-KO triggers; **M5 #1, 2026-07-19**: a classify→verify Workflow fan-out landed 5 existing-op cards + produced the ranked new-op backlog in `docs/reference/coverage-backlog.md`) — next: build the backlog ops (`attachEnergyFrom` first) or P4 |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
- **2026-07-19** (build #16) — **P3-M5 coverage pass #1** (the coverage-expansion
  fan-out). A classify→verify **Workflow fan-out** (10 agents: 5 batches ×
  classify + adversarial verify, 0 errors, ~359k agent tokens) classified the
  **140 un-authored sv01–03** Trainers (61) / Special Energies (4) / Pokémon
  Abilities (75) against the current op vocabulary with the deriver doctrine
  (exact map or flag). Result: **5 authorable now**, 113 needs-op, 22
  already-authored — coverage is **op-bound, not authoring-bound** (~4%
  expressible today). Deliverable is BOTH the 5 landed cards AND the ranked
  **new-op backlog** (`docs/reference/coverage-backlog.md`): `attachEnergyFrom`
  unlocks 11, `discardPileRetrieval` 6, `lookAtTopN`/`moveEnergy`/`conditionalPlay`
  5 each, then a long tail that collapses into a few parameterized ops.
  **Landed** (registry rows over existing ops, id-verified vs the local catalog,
  each test-pinned): Poké Ball (sv01-185, coin-gated Pokémon search → hand),
  Pokémon Catcher (sv01-187, coin-gated gust), Nemona (sv01-180, draw 3),
  Copperajah ex (sv02-150, passive Bronze Body −30 after W/R), Stonjourner
  (sv01-121, passive Exoskeleton −20). Hand-verification caught a fan-out bug —
  Poké Ball's `shuffleDeck` was placed OUTSIDE the coin gate (a tails play would
  reorder the deck); fixed to inside the gate + pinned by a "tails → NO shuffle"
  test. Poké Ball / Catcher are the first Trainers to use `coinFlipGate`, so the
  `ATTACK_EFFECT_COIN_FLIP` log copy was neutralized ("flipped X for the effect").
  **No engine mechanism changed** (additive registry rows + fixtures + one
  `coverage.test.ts` + the backlog doc), so no 2-agent slice review — the fan-out's
  classify+verify already double-checked each program and each landed card is
  hand-verified + tested. engineVersion unchanged (0.11.0). **1080 → 1087 tests**,
  `bun run check` + `vite build` green. Files: registry.ts, testFixtures.ts,
  coverage.test.ts (new), logFromEvents.ts/.test.ts + docs/reference/coverage-backlog.md
  (new), simulator.md, progress.md, decisions.md.
- **2026-07-19** (build #15) — **P3-M4 slice 9: on-KO triggered Abilities**
  (§8.1, D30; built solo — full context loaded — then a 2-agent Opus review,
  BOTH CLEAN — **this CLOSES M4**). A "when this Pokémon is Knocked Out" Ability
  fires mid-KO-sweep DURING the opponent's turn — the inverse of the slice-8
  snipe (the KO fires the trigger, not the trigger firing the KO), and the last
  deferred mid-turn-KO timing. `TriggerTiming` += **`"onKnockOut"`**; detection
  is triggers.ts **`onKnockOutTrigger`** (via `cardIdByUid → programFor`, valid
  AFTER the KO discarded the card), driven by flow.ts's KO sweep. Two forms on
  `TriggeredAbility`: **(1)** a coin-flip **Prize GUARD** (`onKoPrizeGuard:
  "coinFlipPrevent"` — Glimmora "Shattering Crystal": heads → the opponent takes
  no Prize for it), resolved INLINE by a new **`planPrizes`** run UP FRONT —
  before the §14 tie-guard speculation — threading rng ONCE so the speculation
  and the real KO share the post-flip count (§14 stays exact), the guard's events
  (`ABILITY_TRIGGERED`/`ABILITY_COIN_FLIP`/`PRIZE_PREVENTED`) firing after the
  `KNOCKED_OUT`; **(2)** a general parking **PROGRAM** run as a new **`koTrigger`
  PendingStage** — `advance`'s `koTrigger` case → **`runKoTrigger`** →
  **`settleProgram` with a new `resumeTail` flag**: the program PARKS on
  `effect:choose` (where `phase.seat` is the KO'd, NON-turn player) and, on
  `resolveEffect`, the DONE branch keeps DRAINING the queued prize/promotion tail
  (`advance`) instead of folding back to a turn — the resume-the-tail
  continuation the slice-6/8 deferral named. `collectKnockOuts` groups the batch
  PRIZES-first, then koTriggers, then promotions; a §14 game-ending prize
  (finishGame clears `pending`) skips the koTrigger program, while the guard
  (resolved earlier) can DENY a game-winning prize. Fires from all three KO
  callers (attack epilogue, Checkup, mid-turn `resolveMidTurnKnockOuts`) — they
  share `collectKnockOuts`. Behaviour-neutral for every card with no on-KO
  Ability (planPrizes plans its face-value Prize, no flip, no koTrigger — the
  whole prior suite passes unchanged). Representatives: **Glimmora** (sv02-126,
  real — verified vs the local catalog) for the guard, **fix-onko** (a FIXTURE —
  "Last Wish" searches a Basic → hand, parking) for the resume-the-tail path (no
  real SV-era on-KO Ability requires a decision; the fix-sniper precedent);
  neither in the demo decks. New events `ABILITY_COIN_FLIP` / `PRIZE_PREVENTED`;
  new `PendingStage` `koTrigger`; `Phase.effect:choose` += `resumeTail?: true`.
  **Web:** the projection's `effect:choose` case reads the turn owner via
  **`koParkActiveSeat`** when `resumeTail` (activeSeat ≠ waitingSeat — the KO'd
  non-turn player owes it mid-opponent-turn, like the ko:* parks); the parked
  decision reuses the existing `chooseCards` dialog (no new dialog); two
  `logFromEvents` rows. engineVersion 0.10.0 → **0.11.0**. **Review (2 Opus
  agents — engine+rules / web+integration): BOTH CLEAN, no HIGH/MED/LOW
  correctness bugs.** The engine agent enumerated the §14 tie guard × prize
  denial over ALL FOUR coin-flip combos × 60 seeds (every win/tie/continue exact,
  one rng advance), proved the no-ability path byte-equivalent, and probed the
  resume-the-tail across all three KO callers. The web agent proved
  `koParkActiveSeat` correct per origin, the viewer-follow flip to the KO'd
  player, the dialog dispatch for the KO'd seat, and NO demo/`/play` regression.
  One engine LOW (a seed-fragile / misframed §14 test of mine) FIXED (both guard
  branches pinned + a deterministic fix-onko §14-skips-the-program test); one web
  INFO is the pre-existing P4 hidden-info gap. **1066 → 1080 tests**, `bun run
  check` + `vite build` green. Files: flow.ts, registry.ts, triggers.ts,
  types.ts, events.ts, cardplay.ts, index.ts, testFixtures.ts, onKnockOut.test.ts
  (new) + projection.ts, logFromEvents.ts and their tests +
  GameHud.cardplay.dom.test.tsx.
- **2026-07-19** (build #14) — **P3-M4 slice 8: the mid-turn-damage snipe** (§9,
  D29; built solo — full context loaded — then a 2-agent Opus review, BOTH
  CLEAN). A damaging Ability that puts damage counters on CHOSEN opponent Benched
  Pokémon and can Knock one Out **mid-turn** (the actor keeps their turn) — the
  last deferred mid-turn-KO reach from slices 4/6. New op **`damageChosen`**
  (`{op, target:"opponentBench", amount, count}`, effects.ts/interpreter.ts):
  place `amount` HP of counters on `count` chosen opponent Benched Pokémon —
  **flat** (no Weakness/Resistance, no reduction passive; a counter placed by an
  Ability is not "damage from attacks" — the `damageActive`/poison-tick rule,
  distinct from `spreadDamage` which IS attack damage). PARKS on a NEW
  multi-Pokémon prompt **`choosePokemonMulti {candidates, max}`** / choice
  `pokemonMulti {refs}` (the first multi-select Pokémon decision; "you may" +
  "up to" → 0..max) when the opponent has >count Benched, is forced (hits all) at
  ≤count, no-op at 0. **The KO reaches flow.ts via a unified `settleProgram`**
  (flow.ts): the two IDENTICAL local settle helpers (triggers.ts `settleTrigger`,
  cardplay.ts `settleRun`) collapse into ONE that, on a completed program,
  returns the controller to turn:action then runs the shared
  **`resolveMidTurnKnockOuts`** (slice-4 machinery) over both boards — so a snipe
  that drops an opponent's Benched Pokémon resolves as a mid-turn KO handing the
  turn back to the actor (the opponent's Pokémon prizes to the actor; a
  game-winning KO ends the game). Behaviour-preserving for every non-damaging
  program (the sweep is a no-op → straight back to turn:action). Meowscarada ex
  "Bouquet Magic" adds the engine's FIRST **ability activation cost**
  (`AbilityProgram.cost = {kind:"discardBasicEnergy", energyType}`): `useAbility`
  gates on the shared **`programPlayable`** (renamed from `trainerPlayable`,
  extended so the snipe needs an opponent Bench — a play that does nothing can't
  be made, so the cost is never spent for no effect) then pays the cost (discard
  a Basic {G} Energy from hand, `ABILITY_COST_PAID`) before running — an
  unpayable cost rejects `ABILITY_COST_UNMET`, and the cost is paid ONCE before
  parking, so a parked snipe resolving via `resolveEffect` never re-charges. New
  error `ABILITY_COST_UNMET`; new event `ABILITY_COST_PAID`. Representatives
  (verified vs the live api): **Hawlucha** (sv01-118, triggered onPlayToBench,
  2×1 counter) and **Meowscarada ex** (sv02-015/256, activated, once/turn, not
  Active-only, 1×3 counters); NOT added to the demo decks (auto-fire/contrived
  preconditions — the slice-4/5/6/7 precedent). **Web:** projection UNCHANGED
  (choosePokemonMulti rides the existing effect:choose; the mid-turn KO park is
  `resumeTurn` = in-turn per koParkActiveSeat since slice 4); GameHud adds one
  **`ChoosePokemonMultiDialog`** (multi-select up to max, Confirm/Take-none →
  `resolveEffect` `{kind:"pokemonMulti", refs}`); Meowscarada's button uses the
  D19 afford-then-reject (no special gate); `logFromEvents` adds one
  `ABILITY_COST_PAID` row (the snipe's damage/KO/trigger rows already existed).
  engineVersion 0.9.0 → **0.10.0** (additive). **Review (2 Opus agents —
  rules+engine / web+integration): BOTH CLEAN, no HIGH/MED correctness bugs.**
  The rules agent CONFIRMED (via probes) the settle unification behaviour-
  preserving (no pre-slice-8 settle program placed damage), the SEATS sweep safe
  (§14 tie guard can't spuriously fire — `effectiveMaxHp` is position-independent),
  the mid-turn KO prize+resume + §14-win correct, the ability cost
  paid-once-across-park, the `programPlayable` gate non-regressive (Chien-Pao's
  search never blocked), the flat-counter rule, wire-safety double-guarded
  (validateChoice AND placeSnipeCounters), the flow↔triggers cycle
  evaluation-safe, and purity. The web agent CONFIRMED the dialog keys/toggle/
  reset, the dialog↔engine lockstep (an enabled Confirm can only produce a legal
  dispatch), the projection + hot-seat viewer-follow through the mid-turn KO, the
  afford-then-reject button, the log rows, and NO demo/`/play` regression. **The
  one shared LOW** — the forced (≤count) branch auto-takes rather than offering
  the "you may" decline (only the parked branch does) — is HARMLESS (pure upside)
  and the documented auto-fire doctrine; made a conscious choice in an
  interpreter.ts comment (a decline confirm rides with the deferred
  downside-trigger confirm). No code fixes needed. **Deferred:** on-KO triggers
  (fire during the OPPONENT's turn mid-KO-sweep — the last M4 tail). **Verification:**
  `bun run check` green (1045 → **1066**: 17 engine `snipe.test.ts` + 2 DOM + 1
  projection + 1 log), production `vite build` green. No live /play smoke (the
  representatives aren't demo-reachable and NO demo deck / projection path
  changed — the demo boot is byte-identical to slice 7's, the slice-6 precedent).
  Files: effects.ts, interpreter.ts, flow.ts, triggers.ts, cardplay.ts,
  registry.ts, actions.ts, events.ts, index.ts, testFixtures.ts, snipe.test.ts
  (new) + GameHud.tsx, logFromEvents.ts/.test.ts, GameHud.cardplay.dom.test.tsx,
  projection.test.ts.
- **2026-07-18** (build #13) — **P3-M4 slice 7: Rare Candy** (§7.1, D28; built
  solo — full context loaded — then a 2-agent Opus review, BOTH CLEAN). Rare
  Candy evolves a Basic straight to a **Stage 2** from hand, skipping the Stage 1
  ("counts as evolving"). Because it evolves — and flow.ts owns every Knock Out
  (the interpreter never KOs) — it is a dedicated **`rareCandy` action**
  (cardplay.ts) `{seat, uid (the Rare Candy Item), target (the Basic),
  evolutionUid (the Stage 2)}`, NOT an interpreter program. The `evolve` tail was
  extracted into a shared **`placeEvolution`** (turn.ts) that both `evolve` and
  `rareCandy` call, so Rare Candy inherits §10 carry-over (damage/energy/tools
  stay, conditions/markers clear, turnPlayed resets), the **on-evolve triggered
  Ability**, and the **evolve-below-HP mid-turn KO** (a Bravery Charm's Basic-only
  +50 falling off) with zero new flow code. Timing mirrors `evolve` exactly (§4
  first-turn ban + `turnPlayed >= turn` → FIRST_TURN_EVOLVE / EVOLVE_TOO_SOON);
  the target must be a Basic (NOT_A_BASIC_POKEMON). **The Basic→Stage 2 link is
  resolved by BRIDGING**: the catalog stores only each card's immediate
  `evolveFrom` (a Stage 2 names its Stage 1, never the Basic), so
  `stage2EvolvesFromBasic` checks the pool for a **Stage 1** named
  `stage2.evolveFrom` whose own `evolveFrom` is the target Basic. **Documented
  gap:** a deck running Rare Candy + a Stage 2 but ZERO copies of the Stage 1
  can't resolve it (ingest-debt, like prizeValueOf=1); the demo Ember deck runs
  Crocalor so it resolves (verified vs the live api: Skeledirge → Crocalor →
  Fuecoco). A registry **marker** `CardProgram.rareCandy?: true` identifies it
  (sv01-191/256); `playTrainer` on a Rare Candy uid rejects
  TRAINER_TYPE_UNSUPPORTED (the Tool-routing precedent). New error code
  RARE_CANDY_NO_STAGE2; no new event (TRAINER_PLAYED then POKEMON_EVOLVED). **Web:**
  an engine helper **`rareCandyOptions(state, seat)`** (the authority) lists the
  legal `{Basic, matching Stage 2s}` pairings; Rare Candy shows in the Trainers
  list but its button opens a bespoke **`RareCandyDialog`** (pick a Basic → pick a
  Stage 2, with Cancel/Back) rather than `playTrainer`. The **projection needs NO
  change** — `placeEvolution` resolves to turn:action (done), a mid-turn KO park
  (resumeTurn, already in-turn) or an on-evolve trigger park (effect:choose,
  origin-agnostic), all already handled. Demo: Rare Candy ×2 in Ember (Fire energy
  14→12; non-Basic for non-Basic keeps the Basic count / mulligan rate).
  engineVersion 0.9.0 (unchanged — additive). **Review (2 Opus agents —
  rules+engine / web+integration): BOTH CLEAN, no correctness bugs.** The rules
  agent PROVED the `placeEvolution` refactor byte-for-byte equivalent to the old
  `evolve` (state shape, event order, hand-removal timing, the from/target split),
  the bridge sound (the intermediate is forced to be a Stage 1 — no realistic
  false positive), wire-safety airtight, purity. The web agent confirmed the
  projection "no change" across all three outcomes, the dialog↔options lockstep
  (an enabled button can only ever produce a legal dispatch or a clean reject),
  the demo deck (exactly 60, disjoint-except-shared-trainers intact, bridge
  present), and the log rows. **Fixes applied** from the LOW findings: a **Cancel**
  button on the dialog (Rare Candy is optional), `rareCandyOptions` made **lazy**
  in playableTrainers (its cardPool scan only runs when a Rare Candy is in hand),
  and 3 coverage tests (benched mid-turn KO, Tool carry-over, an Energy as the
  evolution card). Documented (not defects): the bridge gap + the un-exercised
  sv01-256 reprint. **Deferred:** the mid-turn-damage snipe (Hawlucha/Meowscarada)
  + on-KO triggers remain the P3-M4 tail. **Verification:** `bun run check` green
  (1019 → **1045**: 24 rareCandy.test.ts + 2 DOM), production `vite build` green.
  **Live /play boot smoke** (agent-browser, seed 6, ZERO console errors): boots
  with the re-balanced Ember deck — Pixi canvas renders, all 75 cardPool fetches
  200 (incl. sv01-191 Rare Candy), the coin toss advances into a clean 7-card deal
  (no mulligan storm). Files: actions.ts, registry.ts, turn.ts (placeEvolution),
  cardplay.ts (rareCandy + bridge + rareCandyOptions), index.ts, testFixtures.ts,
  rareCandy.test.ts (new) + GameHud.tsx, demoDecks.ts/.test.ts,
  GameHud.cardplay.dom.test.tsx.
- **2026-07-18** (build #12) — **P3-M4 slice 6: triggered Abilities** (§9, D27;
  built solo — full context loaded — then a 2-agent Opus review that the shared
  usage limit CUT SHORT). §9 Abilities that FIRE on a game event get a
  **`TriggeredAbility`** entry (`CardProgram.triggered`: `{name, trigger, program,
  optional?, activeOnly?}`) run through the shared interpreter by a new
  **`triggers.ts`**, wired at THREE scan points: **`onPlayToBench`** (turn.ts
  playBasicToBench — a turn play, not a setup placement), **`onEvolve`** (turn.ts
  evolve, after the evolve-below-HP KO check), **`betweenTurns`** (flow.ts
  runCheckup, after the §13 ticks, before the KO sweep). **Board triggers PARK on
  the existing `effect:choose`** (settleTrigger ≡ cardplay settleRun) and resume
  to turn:action via `resolveEffect` — so a Flamigo benched by a DRAG parks
  identically to a Trainer button and the **web needs no new dialog**
  (EffectChooseDialog is now origin-agnostic; only 2 logFromEvents rows added).
  **`betweenTurns` triggers are NON-PARKING** (heal-each / a fixed counter) and
  run synchronously in the one Checkup reduction; Trevenant's counter that goes
  lethal is KO'd by the shared `collectKnockOuts` sweep (a double KO rides its
  §14 tie guard). **Optional triggers AUTO-FIRE** (pure-upside set; "up to"
  searches still take none). New ops: **`healEach`**, **`damageActive`** (PUTS
  counters — NOT attack damage, so no W/R AND **no Bouffer-style reduction**);
  `healChosen.amount` → `number|"all"`; a `byName` search filter. New event
  `ABILITY_TRIGGERED`; `COUNTERS_PLACED` source `"ability"`. Representative set
  (real, verified vs local D1): Flamigo (sv02-170 Insta-Flock, onPlayToBench),
  Arboliva (sv01-023 Enriching Oil, onEvolve), Garganacl (sv02-123 Blessed Salt,
  betweenTurns), Trevenant (sv03-012 Forest Miasma, betweenTurns Active-only) —
  NOT in the demo decks (auto-fire would perturb the seed-tuned hands;
  test-covered, slice-4/5 precedent). engineVersion 0.8.0 → 0.9.0. **Review (2
  Opus agents — rules+flow / wire+web) CUT SHORT by the shared usage limit
  (reset pending):** partial. Before dying the rules agent CONFIRMED 1 bug —
  `damageActive` applied the defender's `damageReductionAfterWR`, so Trevenant's
  counter on a Bouffalant (Bouffer −20) placed 0 → **fixed** (a PUT counter is
  not attack damage, so it lands flat — the poison/burn-tick rule) +
  regression-pinned (sv03-174 in TRIGGER_DECK). Remaining areas SELF-verified:
  the turn-gate makes settleTrigger's done→turn:action always correct; the §14
  double-KO path is the unchanged shared sweep; the web viewer-follow +
  origin-agnostic dialog (read useLocalGame/GameHud). **A `/code-review` re-run
  after the limit resets is the logged follow-up.** **Deferred:** on-KO triggers
  (fire during the OPPONENT's turn mid-KO-sweep), parking mid-Checkup, the
  multi-target snipe (Hawlucha/Meowscarada) + `settleRun`→`resolveMidTurnKnockOuts`.
  **Verification:** `bun run check` green (1002 → **1019**: triggered.test.ts 16
  + 1 log row). No live /play smoke (representatives not demo-reachable; the
  review's browser pass was cut). Files: effects.ts, events.ts, registry.ts,
  interpreter.ts, triggers.ts (new), turn.ts, flow.ts, index.ts, testFixtures.ts,
  triggered.test.ts (new) + logFromEvents.ts/.test.ts, GameHud.tsx (comment).
- **2026-07-18** (build #11) — **P3-M4 slice 5: Special Energy** (D26; built solo
  — full context loaded — then a 2-agent Opus review). Special energies
  provisioned a name-derived 1 Colorless; slice 5 models their rules text as
  data. **`EnergyProgram`** (`CardProgram.energy`: `{provides,
  demoteWithOtherSpecial?, onAttach?}`); **`providedEnergy(state, pokemon)`**
  (continuous.ts) is the ONE provision read site — basic → its type, authored
  special → its units (a concrete type, the `ANY_ENERGY` **wildcard**, or
  several; Luminous demotes to {C} with another special attached), unauthored
  special → the Colorless fallback. **`costMet`** (attack.ts) upgraded for the
  wildcard (allocate to typed needs first, then Colorless — brute-force-verified
  optimal). BOTH the engine cost check AND the HUD payability now call
  `providedEnergy` → **the D18 duplicated payability is gone**. **Jet Energy's
  on-attach switch** (attachEnergy → the newly-exported `switchInto`) moves a
  benched holder to Active. Representative: Jet (sv02-190) + Luminous (sv02-191);
  no Double Turbo in the SV catalog, so multi-provide here is the wildcard kind
  (the `provides` array + matcher still support a future multi-unit energy).
  Demo decks: Ember Jet, Tidal Luminous (different per deck). engineVersion 0.7.0
  → 0.8.0. **Review:** rules+matcher agent CLEAN — brute-forced the matcher
  (13,640 cases, 0 mismatches) and confirmed provision / the Luminous demote /
  the Jet switch; wire+web agent found **1 MEDIUM** — Jet's switch compacts the
  bench, so the ENERGY_ATTACHED **log** (host resolved by index) named the wrong
  Pokémon → **fixed** (resolve by uid) + regression-pinned — plus a LOW
  stale-JSDoc + a stale comment, both fixed. **Verification:** `bun run check`
  green (983 → **1002**: 16 specialEnergy.test.ts + 2 HUD-DOM payability + a log
  host regression). **Live /play smoke** (seed 6, ZERO console errors): boots
  with the re-ingested decks, both special energies fetch 200; the attach
  gestures are the Pixi session-eater so covered by the engine + HUD-DOM + log
  tests + the reviews. Files: cards.ts, registry.ts, continuous.ts, attack.ts,
  turn.ts, interpreter.ts, index.ts, testFixtures.ts, specialEnergy.test.ts +
  GameHud.tsx, logFromEvents.ts/.test.ts, GameHud.cardplay.dom.test.tsx,
  demoDecks.ts/.test.ts.
- **2026-07-18** (build #10) — **P3-M4 slice 4: the Knock Out generalized off
  the Active** (D25; built solo — full context loaded — then a 2-agent Opus
  review, both CLEAN). Two reaches the Active-only + turn-ending KO flow could
  not: **bench spread/snipe damage** and a **mid-turn KO that resumes the
  actor's turn**. `knockOut` KOs any in-play Pokémon by uid (bench KO → discard
  stack, compact bench, prize but no promotion); **`collectKnockOuts`** is the
  ONE post-damage board sweep (prizes-first, §14 tie guard when both seats lost
  a Pokémon) shared by `finishAttack` / `runCheckup` / the mid-turn path — §14
  stays single-sourced. A new **`resumeTurn` PendingStage** + `resolveMidTurnKnockOuts`
  resolve a KO mid-turn then hand the turn back to the actor. **`evolve`** now
  runs the KO check → **closes D24's evolve-below-HP gap** (the pinned
  characterization test flipped to assert the KO). A **`spreadDamage`** op
  (interpreter, derived from a 6th anchored sentence) does flat damage to each
  opponent Benched Pokémon — a benched reduction passive/Tool still applies
  (Bouffer −20), the attacker's Active-only bonus does not — and the interpreter
  only PLACES it, leaving every KO to flow.ts. Web: the sole source change is
  `projection.ts koParkActiveSeat` treating `resumeTurn` as in-turn (the log/HUD
  need nothing — a benched uid resolves the same, the opponent's mid-turn prize
  pick rides the existing `waitingOn` flip). engineVersion 0.6.0 → 0.7.0.
  **Review:** rules+flow agent PROVED the tie guard necessary + sufficient and
  found no defects across 7 risk areas; wire+web agent found none either. 2
  informational notes only (a future Active-only reduction passive; a deliberate
  dead defensive branch). **Verification:** `bun run check` green (974 → **983**;
  8 new `knockout.test.ts` + a mid-turn-park projection test + the flipped
  characterization test). **Live /play smoke** (agent-browser, seed 6, ZERO
  console errors): boots with the re-ingested sv01–03 demo decks — canvas
  renders, all cardPool fetches succeed, the coin-toss action drives
  engine→projection→HUD clean; the new mechanics aren't demo-reachable (no spread
  card; the evolve-below-HP window needs a contrived board) so are covered by the
  engine + web tests + the clean reviews (slice-2 precedent). Files: flow.ts
  (knockOut/collectKnockOuts/resolveMidTurnKnockOuts/resumeTurn), types.ts,
  attack.ts, turn.ts, effects.ts, interpreter.ts, registry.ts, testFixtures.ts,
  knockout.test.ts, stadiumTool.test.ts + projection.ts/.test.ts.
- **2026-07-18** (build #9) — **P3-M4 slice 3: persistent zones — the shared
  Stadium (§7.3) + Pokémon Tools (§7.4) via a continuous-modifier pipeline**
  (built solo — full context loaded — then a 2-agent Opus review; the first
  three Fable 5 review agents died on the usage limit mid-flight and were
  re-spawned on Opus 4.8 after a `/model` switch, so the review is Opus's).
  **Shape (D24):** persistent-zone Trainers are NOT interpreter programs —
  their effects are CONTINUOUS, so a new `packages/engine/src/continuous.ts` is
  the ONE place a rule read consults them: `effectiveRetreatCost` (retreat),
  `effectiveAttackCost` (§8.2), `effectiveMaxHp` (the KO test `isLethallyDamaged`
  in flow.ts + the web `battle.hp`), `passivesOf` (§8.5 — a defender's post-W/R
  reduction now aggregates a printed passive WITH attached Tools; an attacker's
  pre-W/R bonus). It unifies D23's passive hook (Tools + printed passives feed
  one read site). **Stadium** = a single shared `GameState.stadium` {uid, owner}
  played via `playStadium` (one/turn via `TurnAllowances.stadiumPlayed`;
  replace-on-play discards the predecessor to its OWNER's pile; the same-NAME
  ban compares names so the sv02-171/sv03-229 "Artazon" reprints can't
  self-replace; allowed on turn 1). **Tool** = a new `attachTool` action (Tools
  carry a target, so NOT playTrainer): one/Pokémon, uncapped, no allowance, no
  detach — it rides the stack through evolution/switch and discards with a KO
  (the `InPlayPokemon.tools` slot M1 reserved is finally populated). Unauthored
  Stadium/Tool → loud `TRAINER_NOT_SIMULATED`. 4 new error codes, `DAMAGE_DEALT`
  gained `bonus`, new events TOOL_ATTACHED / STADIUM_DISCARDED. **Web:**
  Stadiums are BOTH a HUD button AND a drag onto the shared slot
  (`moveToAction`/`gamePlacementPredicate` gained the one non-own drop target,
  `owner:"global" zone:"stadium"`); Tools attach by drag onto an own Pokémon
  (the energy-attach gesture); the projection renders the shared Stadium public,
  `battle.hp` reads the continuous max HP, HUD retreat/attack costs read the
  effective ones; new log rows + a pre-W/R `· boosted` breadcrumb. Representative
  set (verified vs local D1): Beach Court (sv01-167) / Pokémon League HQ
  (sv03-192) / Vitality Band (sv01-197) / Bravery Charm (sv02-173), DIFFERENT per
  demo deck so the replace path is reachable live. engineVersion 0.5.0 → 0.6.0.
  **Review (2 Opus agents — rules+integration / wire-safety+web-lockstep):**
  wire-safety PROVEN clean (33 hostile `attachTool`/`playStadium` inputs — zero
  throws, zero mutation; every event payload a copy; continuous.ts total on real
  states); lockstep + HUD gating + demo-deck counts confirmed. Two findings: (a)
  the `· boosted` log breadcrumb printed AFTER weakness though it applies BEFORE
  — reordered to §8.5 pipeline order; (b) **the deferred evolve-below-HP KO gap**
  — Bravery Charm is the one effect that can LOWER effective max HP on evolution,
  so a damaged charmed Basic evolving below the new stage's HP should KO the
  instant it evolves (§8.1), but `evolve` runs no KO check and the engine's KO
  flow is Active-only + turn-ending. An Active in that state is cleaned up at the
  next Checkup; a benched one is NOT. A mid-turn KO that RESUMES the actor's turn
  is new flow machinery, so it is DEFERRED with the bench-KO generalization —
  documented at turn.ts/registry.ts/simulator.md and PINNED by a characterization
  test so a future fix flips it deliberately, not silently. **Verification:**
  `bun run check` green (948 → **974 tests** — 18 new engine cardplay covering
  Stadium replace/same-name/one-per-turn + the four continuous effects + Tool
  attach/carry-over/KO-discard/wire-safety/purity, plus new projection/log/
  placement-lockstep/HUD-DOM tests). **Live /play smoke (agent-browser, seed
  frozen to 6, ZERO console errors):** DROVE both new gestures to resolution —
  Beach Court DRAGGED onto the shared stadium slot ("Stadium: Beach Court",
  persisted through two turns + hot-seat flips) which dropped Growlithe's retreat
  button from "Retreat (2)" to "Retreat (1)" LIVE (the continuous discount in the
  HUD), then Vitality Band DRAGGED onto Growlithe ("Growlithe (1 tool)", log row
  "attached Vitality Band → Growlithe"). The shared zone, Tool attachment,
  projection and continuous retreat read all confirmed end-to-end on the real
  Pixi board. Local D1 already held sv01+sv02+sv03 (no re-ingest this session).
- **2026-07-18** (build #8) — **P3-M4 slice 2: Trainers + Abilities + the
  effect-op interpreter/registry** (built solo — full context loaded — then a
  high-effort 8-angle review; no correctness bugs, 2 findings fixed). The real
  first appearance of D8's op-program system (D20's deriver was the sliver).
  **Engine:** M3's attack-private `runEffectSteps` replaced by ONE shared
  resumable interpreter (`interpreter.ts`, `runProgram → done|parked`);
  `EffectStep`→`EffectOp` grew the board/deck ops (draw/discardHand/shuffle/
  searchDeck→bench|hand/switchActive/gust/healChosen). The id-keyed **registry**
  (`registry.ts`) sits above the deriver (`programFor(id)?.attack ??
  derive(text)`) and is the sole Trainer/Ability source. Mid-effect decisions
  PARK via a new **`effect:choose` Phase** with a JSON continuation
  (`{pendingOp, rest, ctx}`) — replayable, outside the KO/win tail (no in-scope
  effect KOs). New actions **playTrainer** (Item §7.1 / Supporter §7.2 + §4
  first-turn ban; card discards up front; `trainerPlayable` rejects
  no-legal-target gust/switch before committing), **useAbility** (activated;
  §9 Active-only + once-per-turn per-Pokémon flag in
  `TurnAllowances.abilitiesUsed`), **resolveEffect** (wire-checks every choice —
  D14 never-throw extended to the effect layer). **Passive** abilities are a
  pipeline hook, not the interpreter (Bouffalant "Bouffer" −20 after W/R →
  `DAMAGE_DEALT.reduction`). 10 new error codes, 6 new events (+"effect"
  DrawReason). **Web:** Trainers/Abilities are HUD buttons (the drag layer
  no-ops on `effect:choose`), `effect:choose` → chooseCards/choosePokemon
  dialog → resolveEffect; §4/§7.2/§9 gating mirrored, engine owns fine legality
  (D19 pill); projection maps the new phase (exhaustive switch caught it at
  compile time); `logFromEvents` rows for all six events; `presentStatuses`
  lifted to types.ts (shared retreat/evolve/switch). **Representative set**
  (real ids, live-verified): Professor's Research/Nest Ball/Boss's Orders/Switch/
  Potion/Energy Search + Chien-Pao ex (*Shivery Chill*) + Bouffalant
  (*Bouffer*); both demo decks share the Trainers, Tidal runs Chien-Pao, Ember
  Bouffalant. Broad coverage = a later opt-in Workflow (user's call). **Review
  fixes:** `searchMove` now clamps to bench space BEFORE removing from the deck
  (removal set = placement set — the M1 card-safety lesson; was guarded but
  fragile), and `presentStatuses` dedup. Deferred: the `effect:choose` search
  candidates leak deck uids in the projection (P4 hidden-info, unobservable in
  hot-seat). **Verification:** `bun run check` green (914 → **948 tests**: 28
  engine cardplay incl. parking/forced-resolve/wire-safety/purity, 5 DOM
  integration tests driving the real GameHud→engine→dialog→resolveEffect flow).
  **Live /play smoke (agent-browser):** boots clean with the new decks — full
  60-card cardPool (all Trainers + Chien-Pao + Bouffalant) fetched from the live
  api, canvas renders, ZERO console errors across setup + two turns; setup drags
  work; the **TurnPanel renders the Trainer buttons live with correct §4/§7.2
  gating** (Boss's Orders disabled turn 1, enabled p1 turn 2; Switch enabled).
  All 8 new ids resolve via `GET /cards/:id` with the exact fields the engine
  reads. NOT driven to a fully resolved effect in-browser — the dealt hands
  lacked gust/search preconditions and the Pixi bench-drag coordinate hit-test
  is the documented session-eater; the resolution path is exhaustively
  unit/DOM-tested. Local D1 already held sv01+sv02+sv03 (no re-ingest needed
  this session). engineVersion 0.5.0.
- **2026-07-17** (build #7) — **P3-M4 slice 1: evolution** (built solo — full
  context loaded — then an 8-angle high-effort review; no correctness bugs
  found). Engine: the `evolve` action (turn.ts) uses the `stack`/`turnPlayed`/
  `tools` fields M1 reserved for exactly this. It places an Evolution card
  (`evolveFromOf(card) !== null`) on the stack top of an own in-play Pokémon
  whose top card NAME equals the card's `evolveFrom` (§10), carrying
  damage/energy/tools and clearing Special Conditions + markers
  (`POKEMON_EVOLVED` + a `STATUS_CLEARED` reason:"evolved" on the new top). The
  timing is deliberately **two** checks (D22): `turnPlayed >= state.turn`
  (came into play this turn / already evolved this turn) PLUS the §4/§10
  first-turn ban (`state.turn === (seat === firstPlayer ? 1 : 2)`) — turnPlayed
  can't make the second because setup Pokémon carry 0. No KO check (evolving
  never KOs). Every wire value runtime-checked (BAD_TARGET / BAD_BENCH_INDEX /
  the string-index trap), purity-tested. 18 engine tests (happy active+bench,
  Stage 2 chain, mismatch, not-an-evolution, both too-soon cases, both
  first-turn bans, carry-over, allowances, wire-safety). **Web:** no projection
  change (it already reads the stack top, so the evolved card + carried damage
  render for free); `moveToAction`/`gamePlacementPredicate` route a Pokémon
  dropped ONTO an own occupant to `evolve` (Active or occupied bench index),
  keeping a free-bench drop as `playBasicToBench` — the SAME indexed-vs-frame
  disambiguation energy-attach uses (confirmed by reading the drop layer's
  `parsePlacement`: occupied slots carry `data-card-index`, the frame carries
  none). Lockstep property extended over a real turn-3 evolvable board (a live
  evolve applies OK end-to-end). `logFromEvents` rows for both events. Demo
  decks gained real lines (Ember Fuecoco→Crocalor→Skeledirge, Tidal
  Buizel→Floatzel) so /play can evolve. **Review (8 angles, high effort):** no
  correctness bugs; 3 reported items — (a) a Basic dropped on an OCCUPIED bench
  slot now routes to evolve→NOT_AN_EVOLUTION rather than benching, CONFIRMED a
  non-regression by reading `parsePlacement` (the bench frame is a separate
  index-less container, so "add to bench" still works); (b) the evolve
  projection-identity pop (CardModel id changes basic-uid→evolution-uid → Pixi
  remounts, not a morph) — animation follow-up, damage/conditions correct; (c)
  no demo evolution line — now added. Suite 892 → **914**; `bun run check`
  green (tsc + biome + vitest). **Session trap:** the `@luminous/engine`
  workspace symlink was MISSING from node_modules (only schema linked) —
  `bun install` restored it (cascade TS2307 across the web app until then).
  And local D1 (apps/api) had drifted to sve/sv06.5/swsh10.5 ONLY (the
  documented trap struck again) — the demo decks' sv01/sv02/sv03 ids 404 until
  a re-ingest, which this session ran. **Browser e2e PASSED (evolve driven
  live):** with Date.now frozen to a seed found offline (p1 opens with a
  Fuecoco + a Crocalor by turn 3), drags were synthesized as real PointerEvents
  against the DOM `[data-card-anchor]`/`[data-card-drop-zone]` elements (the
  Pixi visuals track them; hit-test is by coordinate) — placed both Actives,
  passed to turn 3, dropped Crocalor on Fuecoco → "evolved Fuecoco → Crocalor"
  in the log, the Active re-rendered as Crocalor (HUD shows its HP + attacks),
  clean console. Traps for the next drive: /play's Pass/attach controls are
  aria-label-only buttons (empty textContent — click by `aria-label`, not
  text), and the seed is `Date.now()` (freeze it in-page for a reproducible
  hand). The synthetic-PointerEvent drag recipe (down/move on the playmat root,
  up on window) is the reliable way to drive the Pixi board.
- **2026-07-17** (build #6) — **P3-M3: special conditions + Pokémon Checkup +
  the text-derived effect deriver** (two sequential build agents — engine,
  then web against the as-built event contract — then an 8-finder/7-verifier
  review, three parallel fix agents, and a browser e2e). Engine: the
  M1-reserved `SpecialConditions` slot is live (Active-only); checkup runs
  inside `advance` (NO new phases) in §13 order with rng-threaded flips; KOs
  resolve after the batch via the lifted shared `knockOut` (+
  `isLethallyDamaged`, `activeTop`), parking on the existing ko:* interrupts;
  double-KO ties via speculative evaluateWin (§14 single-sourced); asleep/
  paralyzed gate attack+retreat (engine-exported `isImmobilized`), confusion
  flips with self-KO through the shared `finishAttack` epilogue; benching
  cures. **D20**: `deriveAttackEffect` — five anchored catalog sentences →
  EffectStep programs (applyStatus/heal/coinFlipGate) executed post-damage;
  everything else keeps ATTACK_EFFECT_SKIPPED. 8 new events. Web (**D21**):
  CardModel.battle co-location (5-hop statuses side-table DELETED), status
  chips opposite the damage chip, HUD reason lines, log rows for all events,
  demo decks swapped (Numel sv03-031 ×3, Luvdisc sv02-047 ×3 — for Growlithe
  031 / Cetoddle 058 copies). **Review headliners (10 reported, all fixed):**
  the rules doc ITSELF was wrong on paralysis timing — official wording
  clears only "Paralyzed since the beginning of your last turn", so
  self-paralysis must survive its own checkup; deriver now refuses
  self-Paralyzed + §12/§13.4 corrected at the source (the D15 pattern,
  found by a verifier reading the actual rulebook PDFs). Also: the skip-event
  log said "effect not simulated" for a case where it executed (renderer now
  keys on `effect !== null`); stale activePlayer during between-turns KO
  parks (pending-queue discriminator → activeSeat null); cloneCard aliased
  `battle` + sandbox drags kept chips on the bench (cure-on-bench in the
  mock path too); double-KO prompt order (prizes now before promotes); §14
  tie-guard duplication (speculative-apply); immobilization/lethality
  predicates deduped (3 copies each); the Yawn fixture rewrite had deleted
  the only pure-text skip-payload test (restored via "Lullaby"). REFUTED
  with proof: knockOut's null-guard (correct under never-throw), the
  double-spread "efficiency" claim (wrong arithmetic), interpreter-seam
  extraction (premature — M4 restructures it anyway). **E2e browser PASS,
  zero app bugs:** both status flavors applied with chips + verbatim log
  rows, full burn lifecycle (2 ticks, tails then heads cure, chip removed),
  asleep lock (buttons disabled + reason line) through 3 tails flips to
  wake-up, two KO→prize→promote flows, chips hit-tested above the Pixi
  canvas on the live board, clean console. Suite 825 → **892**; `bun run
  check` green. **Session traps:** the usage limit killed the web build
  agent and 3 of 7 verifiers mid-flight — all resumed via SendMessage with
  zero rework (6th session the pattern holds); /play promote+retreat are
  DIALOGS not drags (drag reports done, no-ops), chips are
  pointer-events:none (hit-tests skip them) → both in the verify skill.
- **2026-07-17** (build #5) — **P3 wire-up: the playable local hot-seat game
  page** (two parallel build agents, then a browser e2e, then an 8-finder /
  6-grouped-verifier review whose 10 reported findings were ALL fixed by four
  parallel fix agents). (A) `getCard` re-added + `fetchCardPool` (D18:
  `/cards/:id` fan-out — CardBrief lacks combat blobs; no api change so no
  gated deploy). (B) `Playmat` → presentational `PlaymatView` (+ mock
  wrapper at /simulator "Sandbox"); `/play` = pregame → `useLocalGame`
  (pure reducer over `applyAction`, viewer follows `waitingOn`) →
  phase-switch `GameHud` → `moveToAction` drag translation → `logFromEvents`;
  demo decks (sv01 Fire vs Water, live-verified ids); damage chips + pile
  counts threaded from the projection. **Browser e2e: a full game played to
  the win overlay** (setup drags, hot-seat flips, payability gating,
  weakness ×2, KO → prize dialog → forced auto-promote, no-Pokémon win).
  **React bug of the session** (found live, root-caused in jsdom): TurnPanel
  and PrizeDialog shared `key={seatKey}` as fragment siblings — on key
  change React's `mapRemainingChildren` dedupes by key, so the shadowed old
  fiber is never deleted: mounted-but-orphaned panels with stale content and
  LIVE buttons dispatching real actions, zero console errors. Fixed with
  panel-prefixed keys, then made structurally impossible by the phase-switch
  composition; regression in `LocalMatch.dom.test.tsx`. **Review headliners
  (all verifier-confirmed, all fixed):** damage chips painted BELOW the Pixi
  canvas (`backdrop-blur` in FRAME_CLASS made every frame a stacking
  context trapping z-61 under the z-60 canvas — blur moved to a `before:`
  overlay; verified live via computed-style stacking walk); hot-seat setup
  flip leaked the first player's face-down placements (redaction moved INTO
  the projection, D17 rev — it's the same filter P4 will apply); rejection
  pill survived the viewer flip (ok-actions now clear `lastError`);
  phase-unaware `canPlace` afforded engine-impossible gestures → the
  placement-predicate seam (D19, property-tested lockstep with
  moveToAction); disabled pass-button styling was Tailwind
  emission-order-dependent (probed with getClassOrder — two of three
  conflicts resolved wrongly; now `disabled:` variants); stale saved-deck
  slot after session expiry; `waitingSeatOf` deduped into the projection's
  `phaseViewOf`; card-pool cache (rejects self-evict, 404s stable);
  live-region pile chips silenced + deck/discard counts added to
  BoardSummary; shared `TransientErrorPill` (+XIcon) for /play + /decks;
  GameHud → exhaustive phase switch, dialogs mount==open, one retreat
  derivation, shared `energyPalette`. One finding REFUTED: moveToAction's
  "unreachable" owner guard is reachable via Stadium drops — guards kept.
  Deferred (verified, in "/play follow-ups"): HUD-reads-raw-GameState (P4),
  pile zones in the animation layer, CardModel.battle, O(n²) log remap,
  overlay re-render memoization, useDeckLibrary, fetch pipelining. Suite
  751 → 825; `bun run check` green. **Session traps:** the usage limit
  killed agents TWICE (all 8 review finders, later all 4 fix agents) — all
  12 resumed via SendMessage with zero rework (4th/5th time the pattern
  holds); agent-browser clicks silently no-op'd after a page reload (eval
  IIFE clicks are the fallback; one `drag` hung 120 s) → recipes written
  into the verify skill; **local D1 had silently LOST sv01/swsh10.5** (only
  sve+sv06.5 remained — `.wrangler` state wipe; the verify skill's set list
  was stale) → re-ingested sv01+sv02+sv03 (767 cards, ~90 s) for the demo
  decks, and the skill now says to check `d1 execute` instead of trusting
  the doc; the "consumption sketch in the projection module" that D17/
  progress cited never existed — citations fixed (guidance = inline
  comments). — **P3-M2 (attacks/KO/prizes/win, D16) + the
  engine→playmat projection (D17)**, two parallel build agents then an xhigh
  review (10 finder angles → 9 grouped verifiers → gap sweep; 15 findings
  reported, every confirmed one fixed in-session by two fix agents).
  (A) Engine M2: staged turn tail (`pending` queue + `advance()` in new
  `flow.ts`; `ko:takePrizes`/`ko:promote` park phases, forced picks
  auto-resolve), attack flow (typed costs w/ Colorless wildcards, §4
  first-turn ban, §8.5 weakness→resistance order), KO cleanup via shared
  `discardFromStack`, prize/promotion choice actions, `evaluateWin` →
  `GameOutcome` win/tie. (B) Projection: per-viewer `GameProjection`
  (drop-in playmat `BoardState` + piles/pokemon/waitingOn/pendingDecision/
  outcome), structural hidden-info redaction, uid-keyed animation identity.
  **Review headliners** (the xhigh pass paid a second time): two
  never-throw violations in M1 code the M1 review missed (`attachEnergy`
  `target:null` and retreat `discardEnergy:{length:1}` both THREW out of
  `applyAction` — probe-proven); `energyProvidesOf` misparsing the
  catalog's own "Basic Darkness/Metal Energy" prints → typed attacks
  permanently unpayable; schema-documented `"+20"` additive weakness
  silently applied as ×2 (→ `DamageModifier` model); `hp:0` rows
  instant-KOing undamaged Pokémon; the projection guessing the wrong
  actor during `ko:promote` + surfacing no pending decision/outcome/damage
  (→ the `activePlayer`/`waitingOn` split). Also: `BASIC_ENERGY_TYPES`
  hoisted to `@luminous/schema` (Fairy added; builder derives its palette),
  win-check consolidated into shared resolve-and-resume helpers,
  `turnTail()` extracted, `PHASE_DESYNC` cross-check hardening. Deferred
  (traps list): stable opaque ids for opponent-hand backs (P4 design),
  image-null → card-back mapping (wire-up slice), ingest columns for ex
  suffix / energy provision / weakness normalization. Suite 683 → 751;
  `bun run check` green. **Session traps:** the usage limit killed 7/10
  finders and the engine fixer mid-flight — ALL resumed via SendMessage
  with zero rework (third session this pattern holds). **The api deploy
  permission gate fired for the THIRD session** — the auto classifier
  rejects `db:migrate:remote` unless the user names the deploy explicitly;
  it genuinely needs the user. **Deploy resolution (same session, after the
  user ran the command):** migration 0003 was ALREADY applied remotely (the
  gate had only ever blocked the Worker upload); `bun run deploy` shipped
  Worker `9b1ec1d1`. Read-only prod smoke green (/health, /cards, /decks →
  401); the WRITE smoke was gate-blocked until the user explicitly asked,
  then passed in full: creates carry `position` (min−1 prepend), foreign-id
  reorder → `400 {"error":"unknown deck id(s)","ids":[…]}`, legit reorder →
  204, persisted, `updated` not bumped (D13 verified in prod). Throwaway
  decks deleted; smoke account remains.
- **2026-07-14** (build #3) — **P3 milestone 1: the engine core** (one build
  sub-agent + a 10-angle review). `packages/engine` is now a real engine
  (D14): pure JSON `GameState` with the mulberry32 `rngState` inside it,
  `applyAction → {ok, state, events} | {ok:false, error}` that never throws
  and never mutates, uid card instances over an injected `cardPool`, seats as
  labels (coin winner *chooses* first), choices-are-actions with mandatory
  steps auto-resolving, and semantic events as the animation/wire contract.
  Surface: setup (shuffle, flip, hands, mulligans, compensation, placements,
  prizes), turn loop + mandatory draw + deck-out loss, 1 energy/turn, Basics
  to bench (cap 5), retreat (named energy pays the exact cost), pass.
  Then an **xhigh review (10 finder angles)** — worth the cost, it found real
  bugs the suite was green over:
  (a) **wire-decoded string indices destroyed cards** — `bench["1"]` resolves
  (string key!) so the guard passed, but `i === index` never matched: the
  energy left the hand and attached to *nothing*; retreat's
  `slice(index + 1)` string-concatenated to `slice("11")` and **deleted every
  benched Pokémon** past the promoted slot. (b) an unvalidated `first` seat
  landed in `firstPlayer` and threw inside `startTurn` *several actions
  later*. (c) `applyAction` returned **undefined** for an unknown action type
  — the never-throw contract P4 rests on didn't hold at the wire. Lesson,
  now written into `simulator.md`: **TS types are not input validation.**
  (d) **the mulligan-compensation RULE was wrong** — it paid only a player who
  hadn't mulliganed. Each player draws 1 per *opponent* mulligan and
  mulliganing yourself forfeits nothing, so **both** seats can be owed. The
  error came from `reference/ptcg-rules.md` §3.5 itself ("the non-mulliganing
  player") — **the reference doc was fixed at the source** (D15) and the draw
  is now clamped so nobody can draw below their 6 prizes. (e) event payloads
  **aliased state arrays** (PRIZES_SET *was* the state's prize array) and the
  caller's action arrays; (f) `setupDrawExtra` advanced the phase emitting
  **zero events** (an event-only P4 client would hang on the prompt forever);
  (g) `shuffle` silently skipped swaps, biasing the permutation. All fixed +
  regression-tested. Also folded in: the 4×-duplicated turn gate → one shared
  `turnGate`, create/action errors → one `ErrorCode` union, poison modeled as
  a counter amount (§12) not a bool, `RETREATED` now carries the bench
  re-index (`promotedFrom`/`benchedTo`) so animators don't re-derive it.
  Suite 623 → 683; `bun run check` green; committed `d34146c`.
  **Session traps:** the Fable 5 usage limit killed the build agent mid-flight
  and later 4 of 10 review finders — all resumed from transcript via
  SendMessage with zero rework (same recovery as the 2026-07-14 build #1
  session; this is now a reliable pattern). **The api deploy was blocked by
  the permission gate for the SECOND session running** — it needs the user.
- **2026-07-14** (build #2) — **P2-M1 e2e pass + task 17** (single-agent).
  (A) FilterRail browser-driven end-to-end (agent-browser vs wrangler dev +
  vite): facets-fed vocabularies, server kinds (`stage=Stage2`), the EX/Mega
  mixed-kind client remainder (wire drops the kind dim; "60 of 79 loaded"
  caption; Load more → page 2), text search (`poison` → 8 right cards;
  numbers aren't searched — damage lives outside the text fields), HP bounds
  (+ inverted range → clean empty state), set + serie filters, **real**
  serie→set narrowing (ingested swsh10.5 locally to get a 2nd serie),
  legalOnly toggle, sort=hp-desc, DeckStats, the Radiant add-time guard
  (deckWideRemaining blocks a 2nd Radiant), and structured legality
  ("Radiant Blastoise is not legal in Standard"). **Verdict: PASS, zero app
  bugs.** The "Load more is dead" scare was agent-browser: clicks DON'T
  auto-scroll inner overflow containers (silent no-op), `fill ""` doesn't
  clear — both now in the recreated `.claude/skills/verify/SKILL.md` (the M9
  recipe was lost with a worktree). Real findings: cel25 ingest aborts
  (cel25-17 ability lacks `name` upstream; all-or-nothing by design → logged
  as follow-up); post-ingest /facets|/sets|/series stay KV-stale ≤1h (flush
  recipe in the skill). (B) **Task 17**: `position` INTEGER on decks+folders
  (D13 — global per-user slots; creates take min−1; nest moves keep the
  slot), migration 0003 with name-order backfill, `GET` lists order by it,
  bulk atomic `POST /decks/reorder` + `/folders/reorder` (≤500 absolute
  assignments, foreign id → 400 naming it, `updated` NOT bumped),
  `unknownCardIds`→`unknownIds`, api client `reorderDecks/Folders`, web
  `applyReorder` now returns `{items, changes}` (slot-permutation keeps the
  array position-sorted) and `Decks.tsx` persists via `persistReorder`
  (failure → pill + resync, the folder-delete precedent). E2e-verified:
  keyboard move → 204 → order survives reload (decks AND folders); probe
  400 correct. Suite 607→623; `bun run check` green. **Api deploy pending**
  — `db:migrate:remote` hit the session permission gate; deploy + smoke is
  the resume point. Local D1 now also holds swsh10.5 (88 cards, serie swsh).
- **2026-07-14** (build) — **P2 milestone 1** (four sub-agent slices + 8-angle
  review + fix pass; committed `b983170`, api deployed `05d46657` +
  prod-smoked same session): filters, panel stats, legality, and the
  full M9 backlog. (A) api: `GET /cards` gains repeatable `id` (≤100, one-call
  deck hydration; chunked IN + in-memory ordering twin), `nameExact`,
  repeatable `stage`/`trainerType`/`energyType`, `serie`, `illustrator`,
  `text`; new `GET /facets`; `CardBrief` += `legal`; KV → `catalog:v3:` with
  bypass for >512-byte keys AND any `?id=` request. (B) M9 backlog cleared:
  guarded `patchWithRollback`, `useDeckLibrary`, api-client-owned 401
  recovery (`setSessionRecoveryHandler`, coalesced probe, retry-once),
  data-layer folder lift-up (parallel PATCHes), visible self-expiring
  error pill (nonce re-announce), `StatusPanel`/`StatusSpinner`, hydration
  self-retry (1s→30s backoff, attempt-unbounded), unknown-id tiles with
  Remove, `src/test/` helpers (fetchStub/fixtures/domShims), glass.ts consts.
  (C) filters server-side with facets-fed options (`useCatalogOptions`);
  kinds → wire params (EX/Mega-only client remainder); hardcoded
  vocabularies deleted. (D) `DeckStats` (supertype counts + type bar) in
  DeckPanel; `Format.legalFlag` unifies `legalOnly` + `isLegalInFormat`;
  Radiant corrected to deck-wide 1 (official rule), Prism Star 1/name.
  Then an 8-angle review (3 correctness, reuse/simplification/efficiency/
  altitude/conventions) → 10 verified findings, ALL fixed in-session — the
  serious two: a **dropped hydration retry** when a batch failed after its
  effect run was disposed (fixed via module-level `liveHydrators` registry;
  failure maps merged + leak fixed) and the **nameExact import regression**
  for names with no print matching the stripped key (fixed: layered
  key→raw→substring resolution). Also: 401 session-expiry no longer raises
  the /decks error pill; LIKE `%`/`_` now escaped api-side; `?id=` requests
  skip KV; dead `getCard` removed; FilterRail/useCardSearch/DeckPanel
  memoized; ACE/Radiant dedup via `deckWideRemaining`. Deferred follow-ups →
  "P2-M1 follow-ups" in `workstreams/deck-builder.md`; D11 revised + D12
  added in `decisions.md`. Suite 528→607; `bun run check` green. NOT
  e2e-driven; api deploy must precede/accompany the web ship (new endpoints).
  Session trap: a usage-limit reset killed 7 review finders mid-flight —
  resumed via SendMessage with zero rework.
- **2026-07-13** (build) — **P1 milestone 9** (four sub-agent slices +
  multi-agent review): the frontend swap. (A) typed zod-free client
  `src/lib/api.ts` (types-only `@luminous/schema` imports, ApiError,
  `credentials:"include"` everywhere) + CSP now derived from
  `VITE_API_ORIGIN` via `loadEnv` (scrydex gone repo-wide). (B) builder on
  the server catalog: api gains repeatable `type`/`rarity` + `sort` +
  extended `CardBrief` (D10; KV `catalog:v2:`); web adapter
  `builder/catalog.ts`, paginated `useCardSearch`, session `cardStore` +
  per-id deck hydration (silent-drop fixed), async server-matched import,
  art via `/assets/cards/{id}` (playmat ids remapped to tcgdex scheme).
  (C) auth: root `AuthProvider` (me() boot), /login + /register (glass form,
  OAuth probe → friendly 503 copy), `AccountButton` corner control.
  (D) decks/folders on the API: optimistic mutations with field-level
  rollback, create-awaits-server, folder-delete lift-up (PATCHes then
  DELETE), builder deck load + debounced serialized PATCH (`deckSaver`),
  localStorage deck store retired; D11 scope trims. E2E-verified via
  agent-browser against wrangler dev (recipe → `.claude/skills/verify/`);
  verification caught two real bugs fixed in-session: **StrictMode
  double-mount permanently disposed the ref-cached saver** (→ effect-owned
  `useDeckSaver`, regression test) and the **register redirect race**
  (render-time `<Navigate to="/">` outran `navigate(from)` — unified).
  Then a 4-finder + 6-verifier + sweep review over the diff: 25+ confirmed
  findings; the 10 serious ones fixed in-session (saver drop-on-unmount
  during in-flight PATCH, name/count caps that could brick saves, auth
  last-writer races, one-off-401 eternal spinner, import-dialog dismissal
  race, `//` redirect guard, hasMore convergence, hydration remount race);
  the rest logged as the **M9 review backlog** in
  `workstreams/deck-builder.md`. Suite 451→528; `bun run check` green.
  NixOS/dev traps: browse dev via `localhost:5173` (CORS `APP_ORIGIN`), the
  cargo `agent-browser` binary is broken (use the Nix-profile one).
- **2026-07-09** (build) — **P1 milestone 8** (sub-agent): lobby Durable
  Object + client WS transport. `LobbyDO` (hibernation API, per-socket
  `serializeAttachment({playerId})`, auto ping/pong) runs the shared
  `lobbyReducer` unchanged; zod wire schemas in
  `packages/schema/src/lobby/wire.ts` with compile-time `Equals<>` proofs
  against the TS types; `lobbyCode` moved into the package. One alarm serves
  disconnect-grace (5 s), countdown→in-game, and empty-lobby TTL (10 min →
  deleteAll). Client `channel.ts` now WebSocket (backoff 400 ms→8 s, send
  queue, ping-as-heartbeat); `useLobby` internals rewritten (server is the
  authority now) but public API + all UI components untouched; API origin
  reader in `src/lib/apiOrigin.ts` (`VITE_API_ORIGIN`). Notable traps fixed:
  zod split out of `protocol.ts` to keep it off the web online chunk
  (97 kB→29 kB); WS route mounts BEFORE hono/cors (101 responses have
  immutable headers). Two-client e2e transcript all green; suite 400→451.
  M7 was committed + deployed + live-smoked this session (deck CRUD in prod).
- **2026-07-09** (build) — **P1 milestone 7** (sub-agent): deck/folder
  persistence API. `packages/schema/src/decks/` (Deck/DeckSummary/Folder +
  create/patch requests); `apps/api/src/decks/` (map/validate/routes);
  `requireUser` middleware extracted from `/auth/me` into
  `apps/api/src/auth/requireUser.ts` (shared session gate). All 9 endpoints
  session-gated; ownership scoping → 404 (no existence leaks); folder-cycle
  guard; card lists validated against the catalog via chunked IN queries
  (D1's 100-bound-params cap → 33-row insert chunks inside one `db.batch`);
  wholesale cards replacement on PATCH; empty PATCH → 400. Suite 343→400.
  M6 auth was committed + deployed + live-smoked this session (register/
  login/me/logout all correct in prod). Note: local D1 had only 123 cards
  (the sub-agent ingested sv01 locally to match test ids — local and remote
  D1 contents drift by design).
- **2026-07-09** (build) — **P1 milestone 6** (sub-agent): auth. Email/password
  + server sessions in `apps/api/src/auth/` — PBKDF2-SHA256 (WebCrypto,
  self-describing `pbkdf2$iters$salt$hash`, dummy-verify timing parity),
  session cookie `Secure; SameSite=None` with **sha256(token)** as the DB row
  id, app-wide CORS (`APP_ORIGIN` var), KV fixed-window rate limits (429 +
  Retry-After), Discord/Google OAuth (state cookie, account-takeover guard:
  unverified-email match → 409; routes 503 until secrets set), verify-email /
  reset-password are 501 pending an email-provider decision. No new
  migration (M3 tables fit). Domain `User` + request schemas in
  `packages/schema/src/auth/`. Suite 273→343. `.dev.vars` gitignored. §3.5
  rewritten as-built. Also this session: **full remote ingest completed**
  (19 sets / 3,698 cards, ~10 min) and M5 deployed + smoke-tested live
  (catalog totals, KV hit, R2 asset miss→hit in production).
- **2026-07-09** (build) — **P1 milestone 5** (sub-agent): public catalog read
  API + the **canonical domain `Card`** (D5) in `packages/schema/src/catalog/`
  (unprefixed names; flat shape, consumers narrow on `category`; `image` is
  OUR asset base path `/assets/cards/{id}`, quality appended by clients).
  Routes in `apps/api/src/catalog/`: `GET /cards` (name/category/type/rarity/
  set/regulationMark/hpMin/hpMax/legal filters; page/pageSize≤100 envelope
  with total), `/cards/:id`, `/sets[?serie=]`, `/sets/:id` (+its cards),
  `/series`; all boundary-parsed through the domain schemas; KV cache-aside
  (binding `CACHE`, TTL 3600, normalized keys, only 200s) with
  `x-luminous-cache`. `@hono/zod-validator@0.8` works with zod 4 (hono range
  bumped to ^4.12). Suite 242→273; wrangler-dev transcript against the real
  123-card local D1 all correct. Uncommitted; deploy + remote ingest pending
  → resume point.
- **2026-07-09** (build) — **P1 milestone 4** (sub-agent) + **D9 logged**:
  ingest pipeline (`apps/api/src/ingest/` sql/map/upserts + 31 tests;
  CLI `apps/api/scripts/ingest.ts` — `--sets|--serie`, `--remote`, `--dry-run`)
  and the lazy R2 asset proxy (`/assets/cards/:id/:file`,
  `/assets/sets/:id/:file`; cache-aside, `x-luminous-cache: hit|miss`).
  Migrations 0001/0002 swap `*_r2_url` → origin `*_url` columns (two-step
  drop-then-add avoids drizzle-kit's interactive rename prompt in non-TTY).
  Local ingest of sve+sv06.5 (123 cards) verified incl. idempotent rerun and
  FK integrity; wrangler-dev curl transcript confirms miss→hit mirroring and
  the 404 allowlist. Suite 242 tests. R2 bucket `luminous-assets` + KV plans
  per §8.5 next. **NixOS quirk:** `wrangler dev` needs
  `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` for workerd origin
  fetches (production + node-side CLI unaffected). Worker deployed (bindings
  DB + ASSETS live); remote migrations/ingest pending → resume point.
- **2026-07-09** (build) — **P1 milestone 3**: Drizzle schema + D1 migrations
  (sub-agent). `apps/api/src/db/{catalog,users,schema}.ts` — 9 tables per
  §5.3 (updated where reality differed: `series.release_date` added,
  `sets.updated` dropped, `abilities_json` added; `variants_detailed`/
  `pricing`/`boosters`/dp-era extras deliberately not persisted). Migration
  `drizzle/0000_tired_sentry.sql` applied to **local** D1; FK enforcement
  verified. D1 database `luminous` created on the account (EEUR,
  id `735f0fb5-cdc3-494d-8b97-74a8ade0124a`); wrangler.jsonc binds it as `DB`
  with `migrations_dir: "drizzle"`; remote apply verified (9 tables live).
  **Notes for M4 (ingest):** insert series→sets→cards (FKs); upsert,
  never delete+reinsert cards (`deck_cards.card_id` RESTRICT); missing
  upstream `legal` → false/false; JSON columns are Drizzle `mode: "json"` —
  pass raw objects, don't pre-stringify; catalog timestamps ISO text, user
  timestamps epoch-ms integers.
- **2026-07-09** (build) — **P1 milestone 2**, via two sequential sub-agents:
  (a) lobby vocabulary moved — `types.ts` + `lobbyReducer.ts` (+ its 11 tests)
  now live in `packages/schema/src/lobby/`, 7 web importers switched to
  `@luminous/schema` (pure move, clean git renames); (b) tcgdex Zod schemas
  authored in `packages/schema/src/tcgdex/` — discriminated union on card
  `category`, 12 verbatim live fixtures, 19 tests, plus a live sweep script
  (`packages/schema/scripts/validate-live.ts`, outside tsconfig on purpose)
  that validated 390 models over 370 requests with 0 failures. Reality-vs-doc
  corrections folded into §5.1 (notably: `variants_detailed`, `wPromo`,
  `abilities[]`, nullable pricing blocks, tcgplayer dynamic print-run keys).
  `bun run check` green (203 tests) + production `vite build` green. Root
  `package.json` now depends on `@luminous/schema`; the package declares
  `sideEffects: false` so the web bundle tree-shakes unused zod schemas.
- **2026-07-09** (build) — **P1 milestone 1**: Bun-workspace monorepo scaffolded.
  Root `package.json` gained `workspaces: ["apps/*", "packages/*"]` (web app
  stays at root for now, per spec). New: `apps/api` (Hono 4 Worker,
  `wrangler.jsonc`, `GET /health`), `packages/schema` (Zod 4;
  `healthResponseSchema` proves the cross-package import), `packages/engine`
  (stub per D7). Root `tsc -b` references, biome scope, and vitest globs now
  cover all three; `bun run check` green (184 tests). `/health` verified via
  `wrangler dev` + curl, then deployed to
  `https://luminous-api.jofrescari.workers.dev` (user-approved).
  Notes: bun nests workspace deps in each package's own `node_modules`;
  packages export TS source directly (`exports: "./src/index.ts"`, no build
  step); wrangler 4.109 wants `@cloudflare/workers-types` **v5** (peer dep).
- **2026-07-09** — Defined all major decisions (D1–D6); wrote the backend/data
  spec; set up this docs-based continuation system + roadmap. Kicked off
  sub-agents to (a) research the PTCG ruleset → `reference/ptcg-rules.md` and
  (b) map the deck-builder code → `workstreams/deck-builder.md`.
  - Both sub-agents completed: `reference/ptcg-rules.md` (528 lines, SV Standard
    era, engine-oriented) and `workstreams/deck-builder.md` (code map + 19-task
    P2 plan) are written. Continuation system is fully populated.
- **2026-07-09** (design) — Added **D7** (engine lives in `packages/engine`,
  shared by web + api) and **D8** (composable, data-driven card effects: primitive
  op programs over archetype templates + a semantic event stream for animation).
  Queried live tcgdex cards to ground it; expanded `workstreams/simulator.md`.
  Follow-up for P1: add an `abilities_json` column to the `cards` table in
  `workstreams/backend-data.md`.
