# Simulator engine (as built)

`packages/engine` (`@colorless/engine`) plays a game of the Pokémon TCG. The web app runs it for
local play (`src/game/localHost.ts`) and the lobby Durable Object runs it as the authority for
online matches (`apps/api/src/lobby/match.ts`). The rules spec is `reference/ptcg-rules.md`; the
engine's coding rules are in `conventions.md` "Code & quality". The July plan and the milestone
notes are in `archive/simulator-history.md`.

## Approach
1. **Rules first.** `reference/ptcg-rules.md` is the spec: setup, turn structure, zones, status
   conditions, KO/prizes, win conditions, first-turn restrictions, weakness/resistance math.
   Code cites it by section (`§8.1`).
2. **Deterministic core.** A pure, seedable state machine:
   `GameState → Action → GameState` (+ emitted events for the UI/log). No
   randomness except a **seeded RNG** (shuffle, coin flips) so games are
   replayable and testable. The RNG state is `GameState.rngState`: every new
   game, local or online, starts from `freshRngState()`, a ChaCha20 keystream
   under a 256-bit CSPRNG key (security audit MI1). A bare number is the old
   mulberry32 generator. Local saves made before the switch carry it and replay
   on it unchanged, and numeric seeds stay for tests, fixtures and `bun run bench`.

## Engine as built

**Turn structure.** `createGame` (`setup.ts`) deals and opens setup. `GameState.phase` says who
must act and how: `setup:chooseFirst`, `setup:drawExtra`, `setup:place`, `turn:action`,
`ko:takePrizes`, `ko:promote`, `effect:choose` and `gameOver` (`types.ts`; `phaseView.ts` is the
one exhaustive switch over it). Whatever runs between player decisions (end of turn, the Pokémon
Checkup, the next turn's draw, KO prizes and promotion, on-KO and on-damaged triggers) is queued
as `PendingStage`s in `GameState.pending` and drained by `advance` (`flow.ts`), so a Knock Out can
stop the tail for a decision and resume it.

**The action pipeline.** `applyAction(state, action)` (`index.ts`) is the only reducer. It never
throws or mutates its input, including for malformed actions from the wire: a refusal is
`{ok: false, error}`. It dispatches on `action.type` to `setup.ts`, `turn.ts` (attach, bench,
evolve, retreat, end turn), `cardplay.ts` (Trainers, Tools, Abilities, `resolveEffect`),
`attack.ts` (attack, prizes, promote), `bench.ts` and `flow.ts` (concede), then runs `postStepChecks`
(`stateChecks.ts`) and `advance` when stages were queued. A choice is an action; anything with no
choice in it (mulligan redraws, prize setting, the turn-start draw) resolves inside the reducer.
Every state change is described by the `GameEvent`s it returns (`events.ts`).

**Where a card's behaviour comes from.** `programFor(id)` (`registry.ts`) returns the card's
`CardProgram` (`programTypes.ts`): op lists for its attacks, Trainer effect, Abilities and
triggers, plus passive, Stadium and Special Energy shapes. It reads `REGISTRY[id]`, then the row
of the card's print_key group through `PROGRAM_ALIAS` (`registryAliases.generated.ts`), so a
same-name, same-text reprint plays like its canonical printing. An attack with no program row is
read from its printed text by the deriver (`effects.ts`, the `deriveAttack*` readers). Trainers
and Abilities have no deriver. A card's `damage` field is a number, or a number with a `+`, `×`
or `?` marker that the effect text resolves (`parseAttackDamage`, `cards.ts`).

**Coverage.** What the engine cannot run is reported, never guessed. An unprogrammed Trainer is
refused (`TRAINER_NOT_SIMULATED`), an attack text no reader takes still deals its base damage and
emits `ATTACK_EFFECT_SKIPPED`, and a Special Energy with no program plays as {C}.
`simulationGaps(card)` lists these per card; the deck builder shows it.

**Effects, choices and prompts.** `interpreter.ts` is the one place an op program changes state.
`runProgram` steps the ops (`stepOp`; the arm bodies are in `ops/*.ts` and the helper modules
beside it). The op contract is `EffectOp` (`effectTypes.ts`), and each op declares in `OP_TRAITS`
(`ops/traits.ts`) whether it parks. An op that needs a decision parks: the phase becomes
`effect:choose` with a `prompt` and a `cont`, a plain-JSON continuation (`effectPrompt.ts`), so a
parked game persists and replays. The answering seat sends `resolveEffect`; `answerOp` reads the
answer and `resumeProgram` runs the rest. A choice with only one legal answer resolves without a
prompt. The interpreter may place damage but never resolves a Knock Out: `settleProgram` and
`collectKnockOuts` (`flow.ts`) do. Passives, Tools and Stadiums are a read model in
`continuous.ts` (no events, no RNG); triggered Abilities are scanned in `triggers.ts`.

**What clients see.** `redactGame(state, seat)` (`redact.ts`) builds the `RedactedGame` one viewer
may see: no opponent hand, deck order or prize contents, no RNG state. `logFromEvents` (`log.ts`)
turns events into the seat-keyed log, and `cuesFromEvents` (`cues.ts`) attaches the animation cues
both table sources play. Clients read prompts and phases from the redacted game, never
`pendingOp`.

**Persisted state.** `GAME_STATE_VERSION` and `migrateGameState` (`persist.ts`) version a stored
game; the lobby's `MATCH_RECORD_VERSION` is the same number. `persistShape.test.ts` fails when the
persisted shape changes without a bump. A local save is replayed from its actions and is dropped
when `engineVersion` changes.

**Module map.** `packages/engine/src` is flat, plus `ops/`, `deriver/` and `fixtures/`. Test
helpers are in `fixtures/`, exported through `testFixtures.ts` as `@colorless/engine/testing`; deck
rules and card classes without the interpreter are `@colorless/engine/rules`. Test-only tables
(`bannerPool.ts`, `paradoxPool.ts`, `refusedPrintings.ts`, `censusAttackCorpus*.ts`,
`catalogManifest.ts`) are not exported from the package.

| Area | Modules |
|---|---|
| Entry, state, actions | `index.ts`, `types.ts`, `actions.ts`, `events.ts`, `setup.ts`, `mulligans.ts` |
| Turn and attack flow | `flow.ts`, `turn.ts`, `cardplay.ts`, `attack.ts`, `bench.ts`, `damageCalc.ts`, `stateChecks.ts`, `outcome.ts` |
| Effects | `interpreter.ts`, `ops/`, `effectTypes.ts`, `effectPrompt.ts`, `effectTargets.ts`, `boardCondition.ts`, `promptText.ts`, `triggers.ts`, `triggerLookup.ts`, `continuous.ts` |
| Card programs and text | `registry.ts`, `registryBuilders.ts`, `registryAliases.generated.ts`, `printGroups.ts`, `programTypes.ts`, `effects.ts`, `deriver/`, `cardText.ts`, `simulationGaps.ts` |
| Card data | `cards.ts`, `cardClasses.ts`, `banners.ts`, `fossils.ts`, `deckRules.ts`, `rules.ts` |
| Output | `redact.ts`, `phaseView.ts`, `log.ts`, `cues.ts`, `persist.ts`, `rng.ts` |

## Writing a card program

Find the work in `simulationGaps(card)` or the "Deferred" list in `reference/card-revision.md`.
Take the printed text from the card's row in the local D1 catalog (`attacks_json`,
`abilities_json`, `effect`) and quote it exactly.

1. **An attack text** may need no row: if one of the `deriveAttack*` readers in `effects.ts` takes
   it, or can with a small widening, change the reader and every card with that wording follows.
   Trainers, Abilities, Tools, Stadiums and Special Energy always need a program.
2. **The program** goes in `registry.ts`: a `CardProgram` const named for the card or mechanic,
   with the printed text as its doc comment, built from existing `EffectOp`s and the
   `registryBuilders.ts` shapes. Add one `REGISTRY` row (`"sv01-181": NEST_BALL`) on one printing;
   its same-name, same-text reprints follow. If that printing is not the group's canonical one
   (`canonicalPrinting`, `printGroups.ts`), or after an ingest, run
   `bun scripts/registry-aliases.ts`. A twin with another name or different text has its own
   print_key and needs its own row.
3. **A new op**, when no composition of existing ops says it: a variant in `EffectOp`, its entry in
   `OP_TRAITS`, a `stepOp` arm (body in `ops/*.ts`) and, if it parks, an `answerOp` arm (a missing
   one fails to compile), its prompt in `effectPrompt.ts` and caption in `promptText.ts`. A new
   prompt kind crosses the wire: `redact.ts`, the schema's `RedactedEffectPrompt`, the clients.
4. **Persisted shape.** A new required field on persisted state, or on an op that can park, fails
   `persistShape.test.ts`: bump `GAME_STATE_VERSION` and give the old version a migration step
   (`conventions.md` "Code & quality"). Optional fields and new union members do not bump it.
5. **The test** is a suite in `packages/engine/src` named for the mechanic. Build the card with its
   real id and printed text (`trainerCard`, `battler` from `./testFixtures`) so `programFor` finds
   the row, play it through `applyAction` from a `driveSetup` board, cover each clause and refusal,
   and `roundTrip` a parked state. `censusAtHead.test.ts` pins the built counts (`BUILT`), so a
   newly built text moves them.
6. **Mutants.** Add rows to `scripts/mutation/mutants.ts` for the mistakes an author would make (a
   neighbouring row's real code copied in), with `decision` naming the `decisions.md` entry and
   `expectKilledBy` your suite (`bun scripts/mutation/reanchor.ts --write` fills in `symbol`).
   Run each with `bun run mutants --only <id>` until it is KILLED (`conventions.md` "Mutants are
   DECLARED").
7. **Version.** A behaviour change bumps the minor version in `packages/engine/package.json` and
   `engineVersion` in `index.ts` together, so local saves recorded under the old rules are dropped
   rather than replayed. Grep the old version string for its other sites (`bun.lock`, a mutant
   row's `find`, a few test titles).
8. **A reading the spec does not settle** is recorded as a reading in the test and the
   `decisions.md` entry, not left as a silent guess.
9. Run `bun run check`, then write a dated `decisions.md` entry and run `bun run docs:index`.

## Testing
- Unit tests per rule and per card, plus seeded play-forward sweeps (`walkGame`, `fixtures/walk.ts`)
  and the real-card fuzz (`actionFuzzReal.test.ts`).
- The action/event log doubles as test fixtures and as the online wire format.
