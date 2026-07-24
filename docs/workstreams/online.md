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
    - **2b-iii-c — the hidden-candidate prompts (NEXT):** chooseCards (deck search / discard retrieval / hand
      cost) + attachCards (deck/top). Their candidates are the CONTROLLER's own deck/top cards — hidden
      info — so the redacted prompt must carry a server-resolved `RedactedCard` per candidate and go
      controller-only (the answerer gate already withholds; add the identity payload). Once ALL prompt
      kinds are dialoged, put **`resolveEffect` on `SUPPORTED_MATCH_ACTIONS`** (the allowlist invariant)
      — this is the point the SEQUENCING CONSTRAINT in match.ts guards, before real decks (increment 3).
    - **2b-iii-d — the online event log + rejection pill:** per-RECIPIENT EVENT redaction
      (`CARDS_DRAWN`/`MULLIGAN_REVEALED` reveal hidden uids — `events.ts:8`) + an event→log stream for
      the online board (`logFromEvents` is per-viewer already; `OnlineMatch` feeds `NO_LOG` today), and a
      rejection pill (the DO drops a rejected action silently today).
- **3:** real deck selection (resolve `deckId`→60 ids server-side), reconnect/timeouts,
  concede/rematch, spectate, and surfacing a match-start FAILURE to players (the load-failure
  wedge below).

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
