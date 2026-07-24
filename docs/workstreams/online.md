# Workstream: Online Matches (Phase 4)

Goal: two players on different machines play a real game, with the **P3 engine**
running authoritatively server-side.

**Depends on:** P3 engine + P1 lobby Durable Object.

## Status — P4 kickoff (2026-07-23)

**Started** (P3 engine broad enough at 0.39.0). **Milestone 1 (WS transport + lobby
over the DO) is already DONE** (P1 M8) — this workstream is really Milestone 2+.

**Increment 1a — DONE:** the engine is wired into `apps/api` (`@luminous/engine`
dependency added; imports + runs in the Worker/DO package, proven by tests). New pure
seam `apps/api/src/lobby/match.ts` — `startMatch({seed, hostDeck, guestDeck, cardPool})`
wraps `createGame`, fixing the seat mapping **host → p1, guest → p2** (`SEAT_OF_SLOT`);
`match.test.ts` pins the mapping, determinism, and deck-size rejection. 1693 → 1696 tests.

**Increment 1b — DONE:** the DO seam. `LobbyDO`'s constructor now takes `env` (for D1);
new pure `loadCardPool(db, ids)` (`apps/api/src/lobby/cardPool.ts` — chunked `db.batch(inArray)`
→ `mapCardRow`, mirroring `guardUnknownCards`; the row→pool fold `poolFromRows` is unit-tested).
At the in-game handoff inside `alarm()`, a new private `handoffToMatch()` loads the pool,
mints an RNG seed (`crypto.getRandomValues`), calls `startMatch`, and persists a `MatchRecord`
`{seed, state}` under storage key `"match"` — BEFORE the in-game snapshot broadcasts (crash-safe
ordering; a mid-flip crash re-runs the handoff). Idempotent via a `MATCH_KEY`-exists guard.
Fixed placeholder decks in `match.ts` (`FIXED_MATCH_DECKS`: host = Sneasel `sv06.5-013` +
Water Energy, guest = Mareep `sv01-066` + Lightning Energy; 60 each, distinct per seat) +
`FIXED_MATCH_CARD_IDS` (the 4 distinct ids the DO resolves from D1). 1696 → 1702 tests.

**Increment 1c — DONE:** the redactor + wire + read-only client (D60, engine 0.40.0). The
match now CROSSES THE WIRE and renders. New PURE **`redactGame(state, seat) → RedactedGame`**
(`packages/engine/src/redact.ts`) — the per-viewer hidden-information filter, run server-side once
per socket, so no full `GameState` ever leaves the DO. **`RedactedGame`** is a `@luminous/schema`
wire type (`match/redacted.ts`, Zod source-of-truth, viewer-relative you/opponent): opponent hand a
count of positional-id backs (never the engine uid), prizes + decks counts, discards + Stadium
public, in-play redacted to anonymous backs during setup (no battle row → no HP leak), the
mid-effect prompt STRIPPED. Its subtle phase derivation (`phaseViewOf`) was MOVED out of the web
projection into the engine (`phaseView.ts`) so the projection and the redactor share ONE source
(verified byte-identical; the whole local suite stays green). The DO broadcasts each socket its view
on the in-game FLIP (a per-viewer fan-out `broadcastMatch`, gated on the countdown→in-game
transition) and on RECONNECT (`sendMatchIfInGame` in the three hello branches), keyed by
`matchSeatOf` (host→p1, guest→p2). `{kind:"match", game}` joins the lobby server-message union (Zod
+ exactness proof). Client: `useLobby` gains a `match` state (set on the frame; cleared when the
lobby leaves in-game so a rematch starts clean); a new **`OnlineMatch`** feeds the same `PlaymatView`
a `projectionFromRedacted(game)` in place of `MatchPlaceholder` — READ-ONLY (no-op drag/pass,
deny-all placement) until increment 2 drives turns. The wire round-trip is pinned to reconstruct
EXACTLY the local `projectGameState` board (the guard against the two redactors drifting). 1702 →
1719 tests, `bun run check` green.

**Increment 2a — DONE:** the authoritative action transport + the online SETUP flow (D61, engine
0.40.0). The match is now INTERACTIVE (setup + basic turn drags + pass). A new `{kind:"action",
action}` client frame (schema — `wireActionSchema` = `z.looseObject`, loosely typed on purpose: the
DO rebinds the seat and relies on `applyAction`'s totality) carries an engine `GameAction`. The DO's
new `case "action"` handler binds the action to the SOCKET's own seat via `matchSeatOf` (never the
client-claimed `action.seat` — a client can't act for its opponent), runs the pure
`applyMatchAction(record, seat, action)` (persist-before-broadcast), and re-fans each socket its
redacted view. `RedactedGame` gained a redacted **`phase`** (the action-routing discriminant —
setup:chooseFirst / drawExtra`{owed}` / place`{ready}` / turn:action / ko / effect / gameOver;
`pendingDecision` was folded into it and derived client-side). `moveToAction` + `placement.ts` were
refactored to a transport-agnostic context (`phaseKind` + `isViewerTurn` + `isReady`) so local AND
online drive ONE tested drag router / drop gate (the placement.test.ts lockstep unchanged). Client:
`useLobby.sendAction`; a new `OnlineHud` (chooseFirst / drawExtra / place-ready panels, gated on
`waitingOn === "you"`); `OnlineMatch` now wires drags → `moveToAction` → `sendAction`, pass →
`endTurn`, and the shared placement predicate. 1719 → 1730 tests, `bun run check` green.

**Increment 2b-i — DONE:** the attack + KO loop (engine 0.40.0). The online match now plays TO A
WIN with the fixed basic decks. `RedactedPhase.turn:action` gained an **`attacks`** field — a new
`RedactedAttack` (`index`/`name`/`cost`/`damage`/`playable`), the `@luminous/schema` wire type. The
engine's `redactPhase` fills it via a new **`redactedAttacksOf(state, viewerSeat, turnSeat)`**: the
viewer's OWN Active's printed attacks, each with a server-computed **`playable`** that folds §8.2
payability (under the Stadium's continuous cost, `effectiveAttackCost`+`providedEnergy`+`costMet`),
the §4 first-turn ban and the §12 immobilize gate — EXACTLY the local `TurnPanel`'s `disabled`, so
the client adds no engine logic. Populated ONLY for the turn owner (the opponent's view of the same
`turn:action` carries `[]`), own Active only (public), so nothing hidden leaves the DO. The DO's
`SUPPORTED_MATCH_ACTIONS` grew by **`attack`/`takePrizes`/`promote`** (with the pure-damage fixed
decks these never reach `effect:choose`, so no soft-lock; `resolveEffect`/`retreat`/`useAbility` stay
blocked). `OnlineHud` gained an **AttackPanel** (bottom-right, mirroring the local `TurnPanel`) and
the **ko:takePrizes / ko:promote dialogs** (centered overlays) — the ko dialogs need NO new wire data
(count rides the phase, own prizes-count/bench ride the board). `EnergyDots` extracted to a shared
`src/features/game/EnergyDots.tsx` (GameHud + OnlineHud, one source). The `turn:action`
round-trip-equality (`projectionFromRedacted` ≡ `projectGameState`) still holds — `attacks` never
enters the `GameProjection` (`decisionFromPhase` keeps `turn:action`→null). engine 0.40.0 (a
transport/read surface, not a rule change); 1731 → **1740** tests, `bun run check` green.

**Review (1 read-only adversarial reviewer): NO HIGH, NO MED** — the server-side payability is a
faithful mirror of the local `TurnPanel`'s `disabled` (same `providedEnergy`/`effectiveAttackCost`/
`costMet` + `state.turn===1` + `isImmobilized` + `attacksOf` indexing), leaks nothing (turn-owner +
own-Active + viewer-public data), the dispatched action shapes match the engine handlers, the
prize/bench indices align 1:1 with the index-stable redaction, and the round-trip equality holds.
**FIVE LOWs — two FIXED, three RECORDED:** (FIXED) an orphaned EnergyDots doc comment left in
GameHud; (FIXED) the ko `Dialog` is now a native `<dialog>` (top-layer + focus-trap, matching the
local HudDialog). RECORDED (deliberate):
(L1) `OnlineHud`'s TakePrizesDialog/PromoteDialog/AttackPanel restate GameHud's PrizeDialog/
PromoteDialog/TurnPanel markup — the SAME "restate the redaction per surface, each independently
tested" choice as the board redactor (D60); the two read different shapes (full `GameState` vs the
redacted wire), so only the shape-neutral `EnergyDots` was extracted. If a third consumer or a
picker-behavior change appears, extract the presentational grid/rows then. (L2) `AttackPanel` shows
only the §4 first-turn note, not the §12 immobilize/confusion notes the local `TurnPanel` renders —
harmless now (the fixed pure-damage decks never inflict status) and a natural part of 2b-ii (the
retreat/immobilize surface), where the wire already carries `battle.conditions`. (L3) the DO's
allow-`attack` no-soft-lock guarantee is plan-ordering, not structural — see the SEQUENCING CONSTRAINT
in `match.ts` (real decks/increment 3 must not precede the 2b-iii effect dialog).

**Increment 2b-ii — DONE:** the online RETREAT (D63, engine 0.40.0). The turn HUD can now attack,
KO-loop AND retreat with the fixed decks. Scoped to RETREAT ALONE (the fixed basic decks have no
abilities and no non-Stadium trainers, so those surfaces can't be exercised end-to-end — CUT and
deferred to real deck selection / increment 3). `RedactedPhase.turn:action` gained a **`retreat`**
field — a new `@luminous/schema` **`RedactedRetreat`** (`cost`/`can`), NULLABLE (null for the
non-acting viewer, mirroring `attacks: []`). The engine's `redactPhase` fills it via a new
**`redactedRetreatOf(state, viewerSeat, turnSeat)`**: the viewer's OWN Active's CONTINUOUS retreat cost
(§7.3 Beach Court discount) + a server-computed **`can`** folding the §12 immobilize gate, the
once-per-turn `retreated` allowance, a non-empty Bench and enough attached energy into ONE boolean —
EXACTLY the local `TurnPanel`'s `canRetreat` (§11), so the online client adds no engine logic.
Turn-owner + own-Active only, so nothing hidden leaves the DO (the energies to discard and the Bench to
promote to were already public on the board). The DO's `SUPPORTED_MATCH_ACTIONS` grew by **`retreat`**
— and unlike `attack`, retreat carries NO sequencing caveat: the engine's `retreat` handler
(`turn.ts:333`) only discards energy + promotes a Bench Pokémon, returning `ok(next)` with the phase
UNCHANGED (never parks at `effect:choose`), so it is soft-lock-safe with ANY deck; it validates every
field defensively (`discardEnergy` an array of exactly `cost` attached uids, a real bench index), so a
crafted frame rejects, never crashes. `OnlineHud`'s AttackPanel gained a **Retreat (cost) button**
(disabled off `retreat.can`) + a **`RetreatDialog`** (the local HUD's, restated over the wire shape),
and the `Dialog` helper an optional `onDismiss` so retreat is dismissable while the ko:* dialogs stay
mandatory. The `turn:action` round-trip equality still holds (`retreat` never enters `GameProjection` —
`decisionFromPhase` keeps `turn:action`→null). 1740 → **1747** tests, `bun run check` green.
**Review (1 read-only adversarial reviewer): NO defects at HIGH, MED, or LOW** — `can` is
field-for-field identical to the local `canRetreat`, `redactedRetreatOf` is null for the non-actor (no
leak), the handler is soft-lock-safe (phase-unchanged) and totally validating, the dispatched
`discardEnergy` uids are engine uids (`redactedCardOf.id`) that match the handler's membership check,
the bench indices align 1:1 with the index-stable redaction, and the round-trip pin holds; the reviewer
independently ran the 91 affected tests green.

**Increment 2b-iii-a — DONE:** the effect:choose prompt SEAM + the `mayDraw` dialog (D64, engine
0.40.0). The mid-effect decision PROMPT now crosses the wire redacted per-viewer. **2b-iii is SPLIT**
(7 `EffectPrompt` kinds, several needing hidden-card resolution — see the sub-slices below); 2b-iii-a
lands the seam with the ONE prompt with no card references AND the only one whose answerer is the
non-controller: **`mayDraw`** (Ortega). New `@luminous/schema` **`RedactedEffectPrompt`** (discriminated
union, `mayDraw` arm = `count`/`note`); `RedactedPhase.effect:choose` gained **`prompt` NULLABLE**. The
engine's `redactPhase` fills it via **`redactedPromptOf(phase, viewerSeat)`** — non-null ONLY for the
answering seat (`phase.answerer ?? phase.seat`), **STRICTER than `phaseViewOf`'s hot-seat `withheld`**
(the wire delivers a payload to one client, so a controller-answered prompt goes to the controller
alone; the two coincide when `answerer` is set, ALWAYS for mayDraw); `redactPrompt` maps mayDraw and
returns null for the 6 controller-answered kinds via an EXHAUSTIVE switch. `decisionFromPhase`
reconstructs the mayDraw decision (`effectDecisionFromPrompt`), so **`projectionFromRedacted ≡
projectGameState` now holds for a mayDraw park** (both viewers) — the round-trip pin no longer excludes
`effect:choose` wholesale. `OnlineHud` gained an `effect:choose` case + a **`MayDrawDialog`** (each
button IS the answer → `resolveEffect{mayDraw, draw}`; mandatory, no dismiss). **`resolveEffect` STAYS
OFF `SUPPORTED_MATCH_ACTIONS`** — the invariant is "`resolveEffect` on the set ⟺ EVERY prompt kind is
dialoged", and only mayDraw is; the fixed pure-basic decks can't reach `effect:choose`, so the dialog is
built + tested ahead of its allowlist flip. 1747 → **1754** tests, `bun run check` green.
**Review (1 read-only adversarial reviewer): NO HIGH, NO MED** — the answerer gate is airtight under a
complete case analysis (defined answerer ⟺ mayDraw ⟹ never gated out; undefined answerer ⟹ a controller
kind ⟹ null to everyone), so ONLY `{mayDraw,count,note}` or `null` ever crosses the `effect:choose`
wire — private candidates never cross; the round-trip is genuinely reproduced; the exhaustiveness guards
are real. TWO LOWs — **1 FIXED** (the schema/redactor docs claimed `redactedPromptOf` "mirrors
`phaseViewOf` exactly" — false for controller-answered parks, corrected), **1 RECORDED** (deliberate):
the `MayDrawDialog` dispatches `resolveEffect`, which the DO rejects, and the dialog is mandatory — IF a
mayDraw park were reachable online the answerer would strand; unreachable with the fixed decks (no
Ortega), and the fix is the allowlist flip in 2b-iii-c, not making an owed decision dismissable —
putting `resolveEffect` on now would be a WORSE strand at an un-dialoged park. See D64.

**Increment 2b-iii-b — DONE:** the PUBLIC-REF effect prompts (D65, engine 0.40.0). The
choosePokemon / choosePokemonMulti / moveEnergy / discardEnergy family now crosses the wire and
gets online dialogs — their candidates are all in-play `PokemonRef`s and attached-Energy uids
ALREADY public on the redacted board, so NO hidden-card resolution is needed (the wire carries the
refs/uids, the client resolves display identity against the board it already has). `RedactedEffectPrompt`
gained the four arms (plus `RedactedPokemonRef` — absolute-seat, and `RedactedDiscardScope` /
`RedactedEnergyOffer`); the refs are ABSOLUTE (unlike the viewer-relative board) because they must
round-trip to the engine's own `PokemonRef` AND ride the dispatched `resolveEffect` back verbatim
(the DO rebinds the ACTING seat, never a choice's target refs) — not a leak (the board is public and
the viewer knows its own seat). The engine's `redactPrompt` maps them via `redactedRefOf` /
`redactedOfferOf` / `redactedScopeOf` (FRESH copies, no alias — the purity contract); still
answerer-only, but these are CONTROLLER-answered, so the wire is STRICTER than `phaseViewOf`
(which keeps the prompt for both viewers) — the prompt reaches the controller alone. `decisionFromPhase`
reconstructs the full `EffectPrompt` field-for-field, so **`projectionFromRedacted ≡ projectGameState`
now holds for a public-ref park for the ANSWERER's view** (the opponent's is deliberately unequal —
its prompt is withheld on the wire; the round-trip pin is scoped accordingly). `OnlineHud` gained the
four dialogs (restated over the wire shape, the D62/D63 restate-per-surface choice, reading names off
the board via `pokemonAt`/`refName`/`energyName`) routed through a new `EffectChooseDialog`.
**`resolveEffect` STAYS OFF `SUPPORTED_MATCH_ACTIONS`** — the invariant is "`resolveEffect` on the set
⟺ EVERY prompt kind dialoged", and chooseCards/attachCards (2b-iii-c) still aren't; the fixed
pure-basic decks can't reach `effect:choose`, so the dialogs are built + tested ahead of the allowlist
flip (D64's pattern). 1754 → **1767** tests, `bun run check` green.
**Review (1 read-only adversarial reviewer): NO defects at HIGH, MED, or LOW** — the answerer gate is
character-for-character `phaseViewOf`'s `waitingSeat` gate (so a non-null prompt reaches exactly the
`waitingOn === "you"` seat), and the absolute-seat refs/uids are a strict SUBSET of the face-up board
that already crosses to that viewer (no leak); the fresh-copy purity holds (test-asserted `.not.toBe`);
`effectDecisionFromPrompt` reconstructs every arm field-for-field (round-trip pinned to the answerer's
view, with the opponent's deliberate divergence also asserted); the four `resolveEffect` dispatches
match the engine `EffectChoice` union + the local `GameHud` dispatches verbatim; `pokemonAt`/`energyName`
are null-safe (worst case a cosmetic uid fallback, unreachable for a face-up board); `resolveEffect`
stays off the allowlist so no strand; and each dialog is behaviorally identical to its local twin (the
declinable-gap Confirm, the moveEnergy decline/sole-source/sole-dest, the discardEnergy scope + refused-
at-cap). The reviewer independently ran `bun run check` green.

**Increment 2b-iii-c — DONE:** the HIDDEN-CANDIDATE effect prompts + the allowlist flip (D66, engine
0.40.0). chooseCards / attachCards now cross the wire and get online dialogs — the LAST two prompt
kinds — so **`resolveEffect` goes ONTO `SUPPORTED_MATCH_ACTIONS`** (the invariant: on ⟺ every prompt
kind dialoged). Unlike the public-ref family, their candidates are the CONTROLLER's own deck / looked-
at-top / hand / discard cards — the deck ones HIDDEN even from the controller until the effect REVEALS
them — so `RedactedEffectPrompt`'s two new arms carry a **`RedactedCard` per candidate** (identity keyed
by the engine uid the answer dispatches back), plus chooseCards `min/max/dest` and attachCards
`targets`(refs)/`max`/`maxPerTarget?`. The engine's `redactPrompt` now takes `state` and resolves each
candidate uid via `redactedCardOf` (the same public-card builder, fresh objects) — sent to the answerer
ALONE, which is where the answerer gate stops being a convenience and becomes the HIDDEN-INFO barrier: a
deck uid must never appear in the opponent's snapshot (it doesn't — their prompt is null and their view
of both decks is a count; pinned by a leak test). `decisionFromPhase` recovers the engine `string[]`
uids from the `RedactedCard[]` (`c.id`), so the answerer-view round-trip still holds. `OnlineHud` gained
`ChooseCardsDialog` (min-gated cost vs "up to", dest-driven verb) + `AttachCardsDialog` (the two-step
pick-card→pick-target loop, sole-target auto-commit, per-target cap) reading identities straight off the
prompt; the shared `effect:choose` render now **keys on the prompt** (`JSON.stringify`) so a second
same-kind park (Ultra Ball's hand cost → deck search, both chooseCards) REMOUNTS with fresh picks —
closing the stale-state parity gap the 2b-iii-b dialogs shared with the local `promptKey`. **API DO:**
`SUPPORTED_MATCH_ACTIONS` += `resolveEffect`; it is soft-lock-safe on ANY deck — `applyAction` rejects it
off an effect:choose park (unreachable with the fixed decks) and validates the choice against the parked
prompt (`validateChoice`) on one, so a crafted frame rejects, never crashes. With every prompt kind
dialoged, the effect-dialog precondition on real deck selection (increment 3) is now MET. 1767 →
**1774** tests, `bun run check` green.
**Review (1 read-only adversarial reviewer): NO defects at HIGH, MED, or LOW** — scrutinizing the two
highest-stakes properties hardest: (LEAK) `redactPrompt` — the only code that resolves a candidate uid
to a `RedactedCard` — is reached ONLY when viewer === controller (the answerer gate); the redacted board
carries card identities in exactly two places (`board`, `phase.prompt`), and BOTH decks are a count for
both viewers (so even the controller gets only the effect-surfaced candidates, not their deck order), so
there is no third leak vector; the leak-barrier test's `allIds` covers every zone a card id can appear in
a p2 snapshot AND asserts `phase.prompt` null; a discard-retrieval candidate reaching the opponent via
the PUBLIC discard is expected-public, not a leak (the test uses hidden DECK uids). (ALLOWLIST) the
`resolveEffect` handler rejects off-park (`BAD_PHASE`), checks the answerer with the SAME `answerer ??
seat` expression `phaseViewOf` uses (so the prompt can't land on a screen that can't act — mayDraw
included, since the DO rebinds to the answerer's own socket seat), and `validateChoice` is totally
defensive (every branch type-checks, never throws); the loose wire schema doesn't strip the answer
payload. The round-trip recovers the engine uids from `c.id` and preserves `maxPerTarget` optionality
(tested with + without); the dialogs are faithful restatements of the local twins; the `JSON.stringify`
key remounts the child dialog correctly and is strictly MORE discriminating than the local `promptKey`
(deterministic, no spurious remount). Two informational non-defects RECORDED (both deliberate + already
commented): the online key omits seat+turn (safe/stricter in the single-viewer online context — a note
if it ever goes hot-seat), and the server-side `maxPerTarget: undefined` key is dropped by the wire.
The reviewer independently ran `bun run check` green.

**Increment 2b-iii-d-i — DONE:** the rejection pill (D67). **2b-iii-d is SPLIT** into d-i (this — the
rejection pill) and d-ii (the online event log, a bigger multi-package refactor: `logFromEvents` + the
log types must move from `apps/web` into shared packages so the DO can build rows server-side, then
accumulate them in `MatchRecord` and broadcast them). d-i closes the silent-drop gap the DO code flagged
("increment 2b adds the rejection pill"): a refused game action now surfaces to the ACTOR as a transient
pill instead of vanishing. New `@luminous/schema` server frame **`{kind:"reject-action", reason}`**
(added to `LobbyMessage` + `lobbyServerMessageSchema` with the exactness proof; server-only — the client
schema refuses it). **`applyMatchAction` now returns a discriminated `MatchActionOutcome`**
(`{ok:true,record} | {ok:false,reason}`) instead of `MatchRecord | null`: the reason is a generic string
for an off-allowlist type and the ENGINE's own `error.message` for an illegal move (safe to surface — it
describes the actor's own move/phase, never the opponent's hidden zones). The DO's `case "action"` sends
`reject-action` to the acting socket on `!ok` (the board already reflects only accepted state, so nothing
else changes). Client: `useLobby` gained **`actionError: {reason, nonce}`** (bumped per rejection so a
repeat re-announces, cleared by the next accepted `match` frame — the local `useLocalGame`
clears-lastError-on-ok rule over the wire); `OnlineMatch` renders the shared **`TransientErrorPill`** with
the nonce+TTL dismiss pattern lifted verbatim from `GamePage`. 1774 → **1777** tests (wire schema
accept/refuse, `applyMatchAction` reason, 3 OnlineMatch DOM pill cases), `bun run check` green.
**Review (1 read-only adversarial reviewer): NO HIGH** — the info-leak check is clean: every engine
`err(...)` that names a card confirms the uid is in the ACTOR's own hand or names a public in-play
Pokémon first (none resolves a name from an opponent's hidden zone), `validateChoice` echoes only the
client-supplied uid (never the candidate set), and the DO sends `reject-action` ONLY to the acting socket
(`this.send(ws, …)`, no broadcast; an unseated socket returns before `applyMatchAction`). **1 MED, FIXED:**
a nonce-collision — `useLobby` restarts its per-error nonce at 1 after clearing `actionError` on an
accepted move, and `OnlineMatch`'s `dismissedNonce` never cleared, so a rejection AFTER a dismissed-then-
succeeded sequence collided (`nonce === dismissedNonce`) and the pill silently didn't show — exactly the
gap this slice closes; fixed by resetting `dismissedNonce` when `actionError` goes null (+ a DOM test
pinning the reject→dismiss→accept→repeat-nonce path). **1 LOW, RECORDED:** a crafted-frame rejection can
surface developer-facing engine text (e.g. "the ko:takePrizes phase disagrees with the pending queue
head") — actor-only, no leak/crash, cosmetic. **Pre-existing sibling NOTED (out of scope):** the local
`GamePage`/`useLocalGame` pill shares the same latent nonce-reset defect (less reachable in hot-seat);
deferred, not touched by this online slice.

**Increment 2b-iii-d-ii — DONE:** the online event log (D68) — the last of 2b-iii-d. Online play now
shows the game log (previously `NO_LOG`), built server-side and broadcast to both clients. **The move
(the multi-package refactor 2b-iii-d anticipated):** the pure GameEvent→rows formatter `logFromEvents`
(+ `formatElapsed`, `STATUS_LABELS`, `LogContext`) moved from the web (`src/features/game/logFromEvents.ts`)
INTO **`@luminous/engine`** (`log.ts`, exported from the barrel) — it reads engine events/state and now
runs in TWO places (the /play client AND the DO), so the engine is its single home, the `redactGame`
precedent (D60). The wire log types live in **`@luminous/schema`** (`match/log.ts`, Zod source-of-truth):
**`SeatLogEntry`** (seat-keyed — `who` ∈ p1/p2/system) + `LogSegment`. **The layering** (the board's:
schema=wire, engine=producer, web=wire→render): the log is broadcast SEAT-KEYED and **identical to both
clients** — it is LEAK-SAFE regardless of viewer (counts for hidden draws/prizes, face-down setup
placements unnamed, every named card resolved off PUBLIC state — the module header's invariant, unchanged
by the move), so there is nothing to redact per-viewer, only to RELABEL; the p1/p2→you/opponent relabel
(`viewLogEntries`) stayed in the web (`src/features/game/viewLog.ts`, the `projectionFromRedacted` twin),
run client-side over the viewer's own `game.seat`. **Wire:** the `{kind:"match"}` frame grew
**`log: SeatLogEntry[]`** (`LobbyMessage` + `matchMessageSchema`; the exactness proofs still hold) — it
rides the FRAME, not `RedactedGame`, because it accumulates across the whole game and can't be rebuilt
from a single snapshot's state (so `RedactedGame`/`redactGame`/the round-trip pins are UNTOUCHED).
**API:** `MatchRecord` grew **`startedAt`** (the "+MM:SS" origin), **`names`** (host→p1/guest→p2 display
names for the log's system rows), and **`log`**; `applyMatchAction` takes a **`now`** arg (the pure
reducer stays clockless — the DO stamps `Date.now()` once per action, the `useLocalGame` pattern) and
APPENDS the accepted events' rows. The DO's `handoffToMatch(snapshot)` seeds startedAt/names/initial-log
from createGame's events at +00:00; `broadcastMatch` sends `record.log` whole to each socket (a reconnect
gets the full backlog). **Client:** `useLobby` gained a `matchLog` state (set with `match` on the frame,
cleared with it on leaving in-game); `OnlineMatch` renders `viewLogEntries(log, seat)` into PlaymatView.
engine RULES UNCHANGED (a transport/read surface); 1777 → **1782** tests (wire log accept/refuse/round-trip,
a match.test log-append + elapsed-stamp + reject-untouched, the engine log suite moved with a seat-keyed
assertion, a web `viewLog` relabel test, an OnlineMatch DOM log-render case). `bun run check` green.
**Unlike D64–D67, this surface IS exercisable end-to-end with the fixed decks** (they emit shuffles / the
coin flip / draws / attacks / KOs — a real log), so a two-client browser run would verify it (not done —
test-only so far).
**Review (1 read-only adversarial reviewer): NO HIGH, NO MED** — the headline LEAK property (one identical
`record.log` to both sockets) HOLDS under a per-arm classification of `formatEvent`: every row names
nothing / a seat label / a COUNT for a hidden zone (draws, prizes, hand costs, deck searches, top-looks) /
a genuinely-PUBLIC in-play card; the two deliberately-naming events were verified at their emit sites —
`HAND_REVEALED` (interpreter.ts, the whole hand revealed publicly first) and `CARD_TO_BOTTOM_OF_DECK`
(bottomed face-up after that reveal) — and face-down SETUP benching stays `POKEMON_PLACED` (unnamed) vs
mid-game `POKEMON_BENCHED` (named, face-up). Seat-keying/relabel (`game.seat` = the viewer's own absolute
seat, opposite for the two clients), record lifecycle (drop on the in-game→not transition, no
in-game→different-guest path, reconnect resends the leak-safe backlog), purity (`applyMatchAction` returns
a FRESH log array, never mutates, `now` threaded — pinned by the prefix-unchanged test) and the exactness
proof / round-trip (RedactedGame not in the diff) all hold. **2 LOWs, both RECORDED (not fixed):** (1) a
`MatchRecord` written by PRE-slice code (`{seed,state}`) read across THIS deploy lacks the new fields → NaN
elapsed + a `names[…]` TypeError on a system row, and `log:undefined` → a client render throw; NARROW (a
match in-flight across one deploy, dev-only fixed decks), self-heals on abandon+rematch, the acknowledged
no-DO-migration gap — deferred to increment 3's storage hardening (default the missing fields on read, or
reset on shape mismatch). (2) the whole log re-broadcasts every action (O(n²) bandwidth over a match) —
the deliberate simplicity tradeoff (a reconnect gets the backlog for free), a later delta/paginate pass.
See D68.

**Increment 3a — DONE:** real deck selection at the match handoff (D69). The lobby now loads each player's
OWN chosen deck from D1 instead of the fixed placeholder decks — the first authenticated surface in an
otherwise account-less lobby. **Increment 3 is SPLIT** (it was large): 3a (this — resolution + the failure
surface), 3b (the online ability + non-Stadium trainer HUD, so an ability/trainer-heavy deck is fully
drivable), 3c+ (reconnect/timeouts, concede/rematch, spectate). **The auth boundary (the crux):** the lobby
stays account-less for SEAT identity (anonymous playerIds), but the `/ws` upgrade now resolves the FORWARDED
`session` cookie to an account (`resolveUserIdFromCookie`, read-only) and stashes it on the SOCKET
(`attachUserId` — DO-only, never on the broadcast snapshot). At handoff the DO reads each player's chosen
deck **OWNER-SCOPED** (`loadPlayerDeck` — `WHERE decks.id = <client deckId> AND decks.userId = <the socket's
authenticated userId>`), so a crafted `select-deck` naming another user's deck id resolves to nothing (the
same 404-as-missing the deck routes give), and an anonymous socket (null userId) is refused before any query.
**Contents come from D1, never the client** (the client sends only an opaque `deckId`), so a client can't
forge an illegal 60. `startMatch`/createGame stays the authoritative validator (60 + a Basic; the
persistence layer enforces neither). **The failure surface (the load-failure wedge, finally closed):**
`handoffToMatch` now returns `{ok}|{ok:false,reason}`; the alarm flips to in-game ONLY on success — on
failure it `resetAfterFailedStart` (un-readies both → back to `selecting`, breaking the countdown re-fire)
and broadcasts a new `{kind:"match-error", reason}` server frame to both, so players see WHY (not signed in
/ deck not theirs / malformed) and can re-pick + retry (no MatchRecord was written, so the retry re-attempts
cleanly). Client: `useLobby.matchError` renders it on the versus screen. `FIXED_MATCH_DECKS` removed.
1782 → **1787** tests (deckIdsFromRows + the loadPlayerDeck auth guards, attachment userId round-trip,
resetAfterFailedStart, the match-error wire accept/refuse; the fixed-deck tests removed), `bun run check`
green. **3b GAP (loud):** with real decks, abilities + non-Stadium trainers (Supporters/Items) are now
reachable, but the online HUD has no affordance for them (`useAbility` stays OFF the allowlist; only the
Stadium DRAG sends `playTrainer`), so a deck that NEEDS one to progress can STALL — a missing affordance,
not an engine soft-lock, and the next sub-slice. **Still unverified:** a real browser two-client run
confirming the SameSite=None session cookie actually reaches the DO on the cross-origin WS handshake (the
code path forwards it; the browser behavior is standard but untested here).
**Review (1 read-only adversarial reviewer): NO HIGH** — the five ranked properties all HOLD: (1)
DECK-OWNERSHIP AUTH — the owner-scoped `WHERE decks.id AND decks.userId` is correct and a socket's `userId`
only ever comes from a valid `session` cookie, so you can only load a deck owned by the account whose token
you hold (a crafted `deckId` reads as missing; anonymous/null-deck refused pre-query); (2) userId
confidentiality — grep-confirmed absent from every schema, read in exactly one place (`userIdOf`), never
sent; (3) session resolution — read-only, rejects forged/expired/no-cookie; (4) failure surface — in-game is
unreachable without a MatchRecord (the wedge is closed), no alarm re-fire loop, retry unblocked; (5) no
regressions (no dangling `FIXED_MATCH_*`, MatchRecord shape unchanged). **1 MED — FIXED in-session as
3a-sec (a PRE-EXISTING leak 3a ELEVATED):** seat identity was bearer-only (the D60 L2 gap) — every `state`
frame broadcasts the seats' PUBLIC `playerId`s, and a socket replaying one was reseated by `helloDecision`
(no account check) and handed that seat's redacted HAND via `sendMatchIfInGame` (the deck stays a count, so
the decklist itself does NOT leak). Harmless with fixed decks; a real competitive leak once the hand is
real. **2 LOWs — RECORDED (not fixed):** (a) `userIdOf` returns the first same-`playerId` socket regardless
of userId, so two live sockets with different userIds (a mid-lobby login change) can pick the wrong account →
a spurious `match-error` (recoverable; fix = prefer a non-null-userId socket); (b) `match-error` broadcasts
the actor-specific reason to BOTH — a trivial sign-in-state disclosure (the name is public; fix = actor-only
specific reason, generic to the other). **Non-defects confirmed:** cookie forwarding preserves headers to
the DO (but verify LIVE — if the cookie did NOT survive, every authed user would resolve anonymous and NO
match could start); attachment set-order / hibernation; no alarm socket-set race (DO input-gating); empty/
oversized decks fail safe through `startMatch`. See D69.

**Increment 3a-sec — DONE (folded into the same session):** seat authentication — closes the review MED. A
new pure **`seatClaimAllowed(boundUserId, userId)`** (`= boundUserId === null || boundUserId === userId`) +
a DO-only **`SEAT_USERS_KEY`** map (`playerId → account`, never broadcast). The `hello` handler binds a
playerId to its account on the FIRST authenticated claim, and refuses any later hello replaying that playerId
whose socket `userId` doesn't match — so a socket echoing a seat's public `playerId` without its session
can't take the seat (nor be handed its redacted hand). An UNBOUND seat stays bearer-only, which is safe: an
anonymous socket can't load a real deck (`loadPlayerDeck` refuses null `userId`), so it never reaches an
in-game match with a hand to protect — and conversely an in-game seat is ALWAYS bound (handoff requires both
authed), which is exactly what closes the leak. 1787 → **1790** tests (`seatClaimAllowed`). **Review (a
second read-only reviewer, scoped to this fix): the leak is CLOSED** — no `hello` path reaches a match
emitter for a seat bound to a different account, and the other emitters (`broadcastMatch`, the alarm flip)
redact per `attachedPlayer`, which only a gated hello sets — **and no legit flow is broken** (ordinary
reconnect + the anonymous→authenticated upgrade both pass; `deleteAll` clears the map on empty-lobby). **3
LOWs, all BY-DESIGN:** a player who LOSES their session mid-lobby can't rejoin their bound seat (the intended
boundary; low-probability — 30-day sessions, and a cookie that drops on reconnect was absent on the initial
claim too, leaving the seat unbound); a same-tab account SWITCH is locked out for the lobby's lifetime
(recoverable in a new tab); `SEAT_USERS_KEY` grows unpruned across repeated guest-takeovers (bounded, TTL-
cleared).

**Match-record lifecycle (locked earlier — 2a):** the persisted match outlives EXACTLY the
match it describes. `handoffToMatch` writes `MATCH_KEY` once; `commit` drops it on the
`abandonsMatch(prev, next)` transition — any commit that takes the lobby OUT of in-game (only
`removeGuest` does: a guest's `bye` or the host's kick). Without this, a rematch in the same
lobby would hit the idempotency guard and reuse the previous pairing's `GameState`/seed — a
HIGH the review caught. The empty-lobby `deleteAll()` also clears it. Invariant: `MATCH_KEY`
present ⇒ phase in-game (the reverse can briefly fail on the load-failure path below).

**The handoff SEAM** (now wired): `apps/api/src/lobby/lobbyDO.ts` `alarm()`, the ONLY place
`phase` becomes `"in-game"` (countdown ends, both ready + both sockets live). It now starts
the match; the client still renders `MatchPlaceholder` (`src/features/online/LobbyRoom.tsx:259`)
until 1c broadcasts the redacted view.

**Known gaps carried into 1c/2 (review LOWs, deliberate):**
- **Load-failure wedge:** if `startMatch` fails (only when the D1 pool is incomplete — all 4
  fixed ids are confirmed present locally), `handoffToMatch` logs and returns without a record,
  but the lobby STILL flips to in-game (no game). Self-heals on the next abandon+rematch (no
  `MATCH_KEY` was written). Increment 2 must surface match-start errors to players.
- **Vacuous deck test:** `match.test.ts` builds the pool with synthetic Basics, so it pins deck
  size + pool coverage but NOT that the 4 ids exist/are-typed-right in the real catalog. A
  Worker-pool integration test resolving them through `loadCardPool` against a seeded D1 would
  close it (deferred — no D1 in the current vitest setup).

**Architectural decisions (D-log a real one when they lock):**
- **Redaction lives in the engine; the wire type in schema. DONE (1c, D60).** The engine
  produces ONE full-information `GameState` (redaction is explicitly "P4's job" — `events.ts:8`,
  `setup.ts:262`). The prior redactor was CLIENT-side + playmat-coupled
  (`src/features/game/projection.ts`), unusable by the DO. So 1c added the PURE
  **`redactGame(state, seat) → RedactedGame`** (`packages/engine/src/redact.ts`), with
  **`RedactedGame`** the wire type in `packages/schema` (`match/redacted.ts`). **No full
  `GameState` (opponent hand/deck/prizes) crosses the wire** — pinned by redact.test.ts's
  "LEAKS NOTHING" barrier + the projectionFromRedacted round-trip equality. The subtle phase
  derivation (`phaseViewOf`) MOVED into the engine (`phaseView.ts`), shared by the projection +
  the redactor (one source, no drift).
- Seats: host→p1, guest→p2 (minted at handoff — the lobby has no p1/p2). The DO keys each
  socket's redaction off `matchSeatOf(snapshot, playerId)` (`slotOf` → `SEAT_OF_SLOT`).
- **Fixed test decks + a server card pool** for now: lobbies are account-less
  (`lobby/routes.ts`) and store only opaque `deckId`/`deckName`, not the card list, and
  the deck routes are session-gated — so the DO can't resolve a player's saved deck yet.
  The DO builds `cardPool` from D1 (`env.DB` + `catalog/map.ts` `mapCardRow`); NOTE the
  `LobbyDO` constructor currently takes only `state` — **add `env` to it** for D1 access.

**Next increments (was "Slice 1", now split):**
- **1b — the DO seam. DONE** (see Status above): `env` on the constructor, `loadCardPool`,
  `handoffToMatch` persisting a `MatchRecord` under `MATCH_KEY`, fixed placeholder decks.
- **1c — the redactor + wire + read-only client. DONE** (see Status above): `redactGame`
  (engine) + `RedactedGame` (schema) + the `{kind:"match", game}` server message; the DO
  broadcasts each socket its redacted view on the flip + reconnect; `useLobby.match` +
  `OnlineMatch` render a read-only `PlaymatView` in place of `MatchPlaceholder`.
- **2a — the action transport + the online setup flow. DONE** (see Status above): the
  `{kind:"action"}` client frame, the DO's seat-bound `applyMatchAction` + re-broadcast, the
  redacted `phase`, the shared `moveToAction`/`placementPredicateFor`, `useLobby.sendAction`,
  `OnlineHud` + interactive `OnlineMatch`. Setup + basic turn drags + pass are playable online.
- **2b — the turn:action HUD + the ko/effect dialogs. SPLIT** (2b was too big for one increment —
  the heavy panels read the FULL GameState, unsafe over a projection). Sub-slices:
  - **2b-i — the attack + KO loop. DONE** (see Status above): the online match now plays TO A WIN with
    the fixed basic decks. `RedactedPhase.turn:action` gained an **`attacks`** list (a new
    `RedactedAttack` — `index`/`name`/`cost`/`damage`/`playable`), computed server-side in
    `redactedAttacksOf` (redact.ts) with §8.2 payability + the §4 ban + §12 immobilize folded into one
    `playable` flag — populated ONLY for the turn owner (opponent gets `[]`), own Active only, so no
    leak. The DO allowlist (`SUPPORTED_MATCH_ACTIONS`) grew by `attack`/`takePrizes`/`promote`.
    `OnlineHud` gained an AttackPanel + the ko:takePrizes / ko:promote dialogs (the ko dialogs need NO
    new wire data — count is on the phase, own prizes/bench on the board). `EnergyDots` extracted to a
    shared module (GameHud + OnlineHud). Pure-damage fixed decks never reach effect:choose, so no
    soft-lock.
  - **2b-ii — online RETREAT. DONE** (see Status above): `RedactedPhase.turn:action` gained a nullable
    `retreat` (`RedactedRetreat` — `cost`/`can`) filled by `redactedRetreatOf` (redact.ts), mirroring
    the local `canRetreat`; `SUPPORTED_MATCH_ACTIONS` grew by `retreat` (soft-lock-safe with any deck);
    `OnlineHud` gained a Retreat button + RetreatDialog. **Abilities + non-Stadium trainers were CUT
    and DEFERRED to increment 3** — they read the FULL GameState (`programPlayable`/`conditionHolds`/
    `handCostUnmet` — `index.ts:288-320`) AND the fixed decks have neither, so a wire surface for them
    can't be exercised end-to-end until real deck selection. When it lands: put the playable
    ability/trainer options + their greyed/reason on the wire without leaking (prize counts / the
    Stadium owner / the hand), and grow the allowlist by `useAbility`/`playTrainer` (Stadium already
    drives via the 2a drag).
  - **2b-iii — the effect:choose DIALOG + prompt. SPLIT** (7 `EffectPrompt` kinds; the ref-family needs
    board-relative resolution, the deck-search family needs server-side `RedactedCard` resolution of the
    controller's private cards — too big for one increment). Sub-slices:
    - **2b-iii-a — the prompt SEAM + the `mayDraw` dialog. DONE** (D64, see Status above): the redacted
      **`RedactedEffectPrompt`** (schema, `mayDraw` arm only) rides `RedactedPhase.effect:choose.prompt`
      NULLABLE; `redactedPromptOf` (redact.ts) sends it ONLY to the answering seat (`phase.answerer ??
      phase.seat`), STRICTER than `phaseViewOf`'s hot-seat `withheld`; `decisionFromPhase` reconstructs
      the mayDraw decision so the round-trip now EQUALS the local projection for a mayDraw park;
      `OnlineHud` gained a `MayDrawDialog`. `resolveEffect` STAYS OFF the allowlist (only mayDraw is
      dialoged). mayDraw first because it has no card refs AND its answerer is the non-controller
      (Ortega), so it lands the whole seam + makes the answerer/leak gate load-bearing.
    - **2b-iii-b — the public-ref prompts. DONE** (D65, see Status above): choosePokemon /
      choosePokemonMulti / moveEnergy / discardEnergy. Their candidates (in-play PokémonRefs,
      attached-Energy uids) are ALL on the public redacted board, so the wire carries the refs (absolute
      seat — `RedactedPokemonRef`) + uids and the client resolves display identity against the board it
      already has — no hidden-card resolution. `RedactedEffectPrompt` gained the four arms; `redactPrompt`
      maps them (fresh copies); `OnlineHud` gained the four dialogs (via `EffectChooseDialog`). These are
      controller-answered, so the round-trip pin holds for the answerer's view only (redact.ts's gate is
      stricter than the hot-seat projection — see the note there). `resolveEffect` still OFF the allowlist.
    - **2b-iii-c — the hidden-candidate prompts. DONE** (D66, see Status above): chooseCards (deck search /
      discard retrieval / hand cost) + attachCards (deck/top). Their candidates are the CONTROLLER's own
      deck/top cards — hidden info — so `RedactedEffectPrompt`'s two arms carry a server-resolved
      `RedactedCard` per candidate (identity keyed by the answer-dispatched uid), sent controller-only via
      the answerer gate (now the load-bearing hidden-info barrier — a leak test pins that no deck uid
      reaches the opponent). `redactPrompt` takes `state` + resolves via `redactedCardOf`;
      `decisionFromPhase` recovers the uids (`c.id`); `OnlineHud` gained `ChooseCardsDialog` +
      `AttachCardsDialog`, and the `effect:choose` render now KEYS on the prompt so a same-kind re-park
      resets picks. With every prompt kind dialoged, **`resolveEffect` is now ON `SUPPORTED_MATCH_ACTIONS`**
      (soft-lock-safe — the engine rejects it off a park and validates the choice on one). The effect-dialog
      precondition on real decks (increment 3) is MET.
    - **2b-iii-d — the online event log + rejection pill. SPLIT** (two features of very different size):
      - **2b-iii-d-i — the rejection pill. DONE** (D67, see Status above): a refused game action now
        surfaces to the actor as a transient pill. New `{kind:"reject-action", reason}` server frame;
        `applyMatchAction` returns `{ok,reason}` instead of `MatchRecord | null`; the DO sends it on `!ok`;
        `useLobby.actionError` + `OnlineMatch`'s `TransientErrorPill` (the GamePage nonce+TTL pattern).
      - **2b-iii-d-ii — the online event log. DONE** (D68, see Status above): `logFromEvents` (+
        `formatElapsed`/`STATUS_LABELS`/`LogContext`) moved into `@luminous/engine`; the wire log types
        (`SeatLogEntry`/`LogSegment`) into `@luminous/schema` (`match/log.ts`); the `{kind:"match"}` frame
        grew `log: SeatLogEntry[]`. `MatchRecord` grew `startedAt`/`names`/`log`; `applyMatchAction` takes
        a `now` arg and appends the accepted events' rows; `handoffToMatch` seeds the initial log; the DO
        broadcasts `record.log` (seat-keyed + leak-safe → same array to both, no per-viewer redaction).
        `viewLogEntries` (the seat→viewer relabel) stayed in the web (`src/features/game/viewLog.ts`);
        `useLobby.matchLog` + `OnlineMatch` render it. The `LogEntry`/`LogSource` RENDER types stayed in
        the playmat (zero cross-package imports). Confirmed the log rides the FRAME, not `RedactedGame`
        (it can't be rebuilt from one snapshot), so the redactor + round-trip pins are untouched.
- **3 — real decks + the rest of online. SPLIT** (it was large):
  - **3a — real deck selection + the failure surface. DONE** (D69, see Status above): the `/ws` upgrade
    authenticates the forwarded session cookie → a per-socket userId; the handoff loads each player's
    chosen deck OWNER-SCOPED from D1 (`loadPlayerDeck`), drops `FIXED_MATCH_DECKS`, and on a resolution
    failure resets the lobby to selecting + broadcasts `{kind:"match-error"}` instead of wedging in-game.
  - **3a-sec — seat authentication. DONE** (D69, folded in): binds a playerId to the account that first
    claimed it (`seatClaimAllowed` + a DO-only `SEAT_USERS_KEY`), refusing a hello that replays a bound
    seat's public playerId without its session — closes the D60 L2 bearer-only-seat HAND leak that real
    decks made meaningful. A second review confirmed the leak closed with no legit reconnect broken.
  - **3b — the online ability + non-Stadium trainer HUD (NEXT):** real decks make abilities +
    Supporters/Items reachable, but the online HUD has no button for them and `useAbility` is off the
    allowlist, so such a deck can stall. Put the playable ability/trainer options + their greyed/reason on
    the wire (they read the FULL GameState — `programPlayable`/`conditionHolds`/`handCostUnmet`,
    `index.ts:288-320` — WITHOUT leaking prize counts / the Stadium owner / the hand), add the OnlineHud
    buttons, and grow `SUPPORTED_MATCH_ACTIONS` by `useAbility` (Stadium already drives via the 2a drag).
  - **3c+ — reconnect/timeouts, concede/rematch, spectate**, and the DO-storage-migration hardening the
    2b-iii-d-ii LOW deferred (default missing MatchRecord fields on read).

## What already exists (reuse it)
The lobby was built to swap transports without UI changes:
- `src/features/online/net/types.ts` — LobbySnapshot / LobbyMessage / LobbyIntent.
- `src/features/online/net/lobbyReducer.ts` — the authoritative reducer.
- `src/features/online/net/channel.ts` — the transport seam (currently
  BroadcastChannel).
These types + reducer move into `packages/schema` in P1 so the DO and client
share one source of truth.

## Plan
1. **Transport swap:** implement a WebSocket `channel.ts` against the lobby DO
   (`/lobby/:code/ws`). Lobby behaviour is unchanged — the DO runs the existing
   reducer.
2. **Match handoff:** when both players are ready, the DO transitions from lobby
   to **match**: it instantiates the P3 engine, deals, and drives the game.
3. **Authoritative engine in the DO:** the server owns the RNG seed and hidden
   info (hands, deck order, prizes); clients send intents and render the
   snapshots/events the DO broadcasts — the host-authoritative model the client
   already assumes.
4. **Reconnect / hibernation:** `PlayerState.id` already supports reconnect;
   handle DO hibernation + snapshot resync.
5. **Later:** spectate, per-recipient hidden-info filtering, anti-cheat.

## Milestones
1. WS transport + lobby over the DO (no game yet).
2. Lobby → match handoff; engine instance per lobby.
3. Per-player hidden-info snapshots + intent validation.
4. Reconnect, timeouts, concede/rematch.
