# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-26 — build session #59 (**P4 3c-v — the forfeit deadline on the WIRE, and the
opponent's countdown**). The last silent path in the match lifecycle. 3c-ii could forfeit an abandoned player
and 3c-iv made a graceful leave do it instantly, but an UNGRACEFUL drop (a crash, a killed tab, a dead
network) still waited in total silence: the player who was still there watched a motionless board for 90
seconds and was then handed a win with no account of what had been decided. **The decision is WHERE the
deadline lives.** It moved out of the DO's private `ABANDON_KEY` storage list and onto
**`PlayerState.forfeitAt`** — a `@luminous/schema` WIRE type — so the number the opponent's countdown renders
is literally the number the alarm fires on, and the two cannot drift. The snapshot beat the `match` frame as
the carrier for three converging reasons: the arming moment (a disconnect grace expiring in `alarm()`) already
commits a snapshot and sends no match frame; a forfeit is lobby/transport state the engine knows nothing
about; and a reconnecting client gets it for free with the state it already receives. Mirroring it while
`ABANDON_KEY` stayed authoritative was rejected outright — two sources for one deadline is exactly how a
countdown ends up promising something the server won't do. **The invariant that makes it safe is `connected`
⇒ `forfeitAt === null`**, and it is enforced STRUCTURALLY: `setSeatConnected` takes the deadline as a final
argument defaulting to null (so you cannot write one without deciding the other), and
`seatGuest`/`reseatHost`/`makePlayer` clear it. That REPLACES 3c-ii's `clearDisconnectTimers`, whose entire
reason for existing was the fear that a future branch would cancel one timer and leave the other armed:
"mark them present" and "don't forfeit them" are now a single indivisible write instead of two calls.
`forfeitAbandoned` dissolved into the alarm, which judges due deadlines on the FINAL snapshot and consumes
them in the same commit. **A second, quieter piece: `readSnapshot`.** `SNAPSHOT_KEY` has no version gate, so
adding a field would have made every in-flight lobby unreadable across the deploy; it is now read through a
normalizer that fills fields added since the write — deliberately the OPPOSITE of D72's `MatchRecord` answer,
because a lobby snapshot is a handful of scalars with no embedded engine state (a missing field has exactly
one sensible value, and being wrong is cosmetic), and the guard is on the field's TYPE, not on nullishness,
because it feeds `Math.min` in the alarm scheduler where an `undefined` would set NaN. **Client:** a
top-centre `OpponentAwayBanner` — "Opp disconnected — forfeits in 1:30", ticking; "forfeiting…" past zero
rather than a frozen 0:00 (the server's alarm is what ends it and may lag the client clock); "waiting for
them to reconnect…" when no clock is armed; hidden once the game is over. engine RULES UNCHANGED (0.41.0);
1841 → **1853** tests. `bun run check` green. Built solo with full context; **self-reviewed, no independent
reviewer this session** (offered — `/code-review` is user-triggered). **BROWSER-VERIFIED on two real clients,
all three paths:** killing a client outright raised the banner at +5s with a full 1:30, counted it down live,
and fired the forfeit at zero ("You win! / The match was forfeited.") — which is also the proof that moving
the deadline did not break the scheduling D73 nearly shipped broken; and a GENUINE RECONNECT (the same tab
navigated away and back, so the playerId survived in sessionStorage) cleared the banner at once and left the
match running well past the original deadline, i.e. the returning player was NOT forfeited. Zero page errors.
**FOUND, RECORDED, NOT FIXED (pre-existing, in online.md):** a **half-open socket is invisible to the
server** — `setWebSocketAutoResponse` answers keepalives without waking the DO and nothing watches for pings
that STOP arriving, so a player whose network dies without a TCP close is never marked disconnected and never
forfeits. (Playwright's `set offline on` reproduces it: the established WS stays open and the DO never
notices. Every ordinary exit — tab close, browser kill, navigation, reload, crash — does produce a close
event, which is why this has never bitten.) Closing it needs server-side liveness and is its own slice.
**NEXT (resume point):** **rematch** — 3c-iv deliberately left an in-game lobby with no exit but the host's
kick, and `endMatch` (3c-i) is already the primitive.
See D76 + `workstreams/online.md`. Below: the P4 3c-iv header (kept for continuity).

---
### Prior header (P4 3c-iv — leaving a running match forfeits it, kept for continuity)
**Last updated (was):** 2026-07-26 — build session #58 (**P4 3c-iv — leaving a running match now FORFEITS it**).
The last way an online match could end with **no result at all**. A `bye` — the frame EVERY leave sends, the
Back control's confirm and `useLobby`'s unmount alike — still took the pre-P4 path: a **guest's** freed the
seat, which takes the lobby out of in-game, which makes `commit` delete `MATCH_KEY`, so the opponent's board
and game simply **VANISHED mid-play** with nothing said; a **host's** parked their seat and left the guest to
wait out the full 5s + 90s abandonment clock for a player who had explicitly said goodbye. Now the DO
**concedes for the leaver first**, through a new private **`concedeSeat(snapshot, seat, now)`** extracted from
`forfeitAbandoned` — so a graceful leave and the 90s timeout are LITERALLY the same code path, and produce the
same `GameOutcome`, the same log row and the same overlay as a pressed Concede (3c-iii). **The seat-keeping
half is the real decision, and it answers the question 3c-iii deferred** ("does the leaver stay seated long
enough for the other player to SEE the result?"): the new pure **`applyBye(snapshot, slot)`** (logic.ts) KEEPS
the seat for BOTH slots while the lobby is in-game, and falls back to the old free-the-guest / park-the-host
semantics otherwise. Freeing it would have undone the concede a frame after it landed — the same
`abandonsMatch` → record-delete → blank board — so the concede would have been pointless. It covers a
**FINISHED** game too, deliberately: a real leave is often **TWO `bye` frames** (an explicit `leave()` plus the
unmount's), and under a live-only rule the second would have voided what the first correctly ended; likewise
the loser clicking Back must not yank the winner's own result off screen. **Cost, accepted and recorded:** a
lobby that has been in-game now has no route back to `selecting` except the host's kick — rematch is the next
slice and `endMatch` (3c-i) is already its primitive, and "your board vanished" is the worse failure.
**Client:** the Back confirmation now tells the truth BEFORE it acts — `BackToMenu` takes an overridable
**`LeaveConfirmCopy`** (default = the local /play wording) forwarded through **`PlaymatView.leaveConfirm`**,
and the online match sets it to "Leaving forfeits the match — your opponent wins immediately." while the game
is live, dropping to a plain goodbye once it is over; silently turning "Back" into "you lose" was the one part
of this change a player must never meet unannounced. engine RULES UNCHANGED (0.41.0 — a transport + copy
slice); 1835 → **1841** tests. `bun run check` green. Built solo with full context; **self-reviewed, no
independent reviewer this session** (offered — `/code-review` is user-triggered).
**BROWSER-VERIFIED the same session (two real clients, two accounts, two D1 decks, one WS lobby) — and it had
to be, since the DO class itself has NO tests: `applyBye` is unit-tested but the `bye` → `concedeSeat` wiring
is not.** BOTH directions were driven to a result, with a REAL hit-tested click on Back (not a synthetic
`.click()`): (1) the **HOST** left mid-match → the guest, who touched nothing, immediately got "You win! /
The match was forfeited." with the board intact and the `<winner> wins — the opponent forfeited` log row —
where before they'd have waited out the full 95s clock; (2) the **GUEST** left mid-match → the host got the
same, and critically was NOT dropped to the "Waiting for an opponent to join…" screen with the game gone,
which is exactly the void this closes. The Back dialog read "Leave the match? / Leaving forfeits the match —
your opponent wins immediately." on both. Zero page errors on either client. (Both runs left during SETUP,
which also re-confirms the engine's any-phase concede legality from D74.) **NEXT (resume point):** the
opponent-facing **"forfeits in 0:45" countdown** — now the only path that still waits silently is an
UNGRACEFUL drop (a crash/tab-kill, the 3c-ii clock), and the deadline needs to reach the wire.
See D75 + `workstreams/online.md`.

---
### Prior header (P4 3b-ii + 3c-i/3c-ii/3c-iii — Rare Candy online, record versioning, forfeit + concede, kept for continuity)
**Last updated (was):** 2026-07-26 — build session #57 (**P4 3b-ii, 3c-i, 3c-ii, 3c-iii — the online Rare Candy, the MatchRecord version gate, the abandonment forfeit and the Concede control; plus a two-client browser run and the Pass-turn fix**). Five things landed this session; the Rare Candy header below is the first, and 3c-i (D72) / 3c-ii (D73) / 3c-iii (D74) are summarised in the Resume point. Rare Candy
(§7.1) now plays online, closing the ONE narrow affordance gap 3b deliberately carried (D70): the wire trainer
list omitted it and `rareCandy` was off the DO allowlist, so a Rare-Candy-dependent deck could still STALL on
that single play. **Why it needed its own sub-slice:** it is the one hand Trainer that is not a plain button —
it EVOLVES instead of running a program, and its decision is a PAIR (which Basic in play, which Stage 2 in
hand) that no single dispatch carries and no `effect:choose` prompt can express (a prompt picks from ONE
candidate list), which is why the local HUD gives it a bespoke two-step dialog. **Wire:** `RedactedTrainer`
gained **`rareCandy: boolean`** (still a Trainer row — just the one whose click OPENS A DIALOG) and
`RedactedPhase.turn:action` gained **`rareCandy: RedactedRareCandyOption[]`** (`target` the seatless
`PokemonTarget` the action dispatches back / `basicUid` / `basicName` / `stage2: {uid,name}[]`). The pairings
ride the PHASE, not the row, because they don't depend on WHICH copy is played (the row supplies only the
`uid`) — mirroring the local decomposition 1:1 (`TrainerOption.rareCandy` + a separately-computed options
list), which keeps the fidelity check a field-for-field comparison. **Engine:** `redactedTrainersOf` stopped
skipping Rare Candy and now mirrors the local `playableTrainers` exactly, INCLUDING its three deliberate
scope-outs — `trainerPlayableIf` / the §7.5 hand cost / the whiff `programPlayable` gate are evaluated only on
the Item/Supporter path (cardplay.ts reads them only in `playTrainer`'s Item/Supporter branch; the `rareCandy`
action consults none, so greying on one would DISAGREE with the engine) — with its §7.1 gate the lazily
computed `rareCandyOptions(...).length > 0`, the local's own shape. New **`redactedRareCandyOf`** maps
`rareCandyOptions` to the wire: the ENGINE stays the legality authority (the §4 ban, Basic-in-play +
came-into-play-this-turn, and the Basic→Stage 1→Stage 2 chain BRIDGE — a `state.cardPool` scan the client could
never run), so a listed pair is always legal and the client adds no rule logic; the `target` is rebuilt fresh
(the no-alias purity contract / D70's LOW fix). **The consistency invariant:** both are computed in the SAME
`redactPhase` call on the same state, so a LIT row always has ≥1 pairing and a greyed row always has [] — no
dead dialog is reachable. **Leak posture identical to 3b:** actor-gated ([] for the opponent), and everything
named is the actor's own in-play stack top (public) + own hand (already face-up on their own wire).
**Client:** `OnlineHud`'s trainer row branches on the flag, and a new `RareCandyDialog` restates the local one
over the wire shape (sole-Basic pre-select, Cancel always, Back only when the Basic pick was a real choice).
**API DO:** `SUPPORTED_MATCH_ACTIONS` += **`rareCandy`** — soft-lock-safe on any deck: `turnGate` rejects it
off a turn:action without throwing, the handler re-validates every wire value, and on accept it evolves
through the SHARED `placeEvolution`, whose only parks are an on-evolve triggered Ability's effect:choose (all
7 kinds dialoged, 2b-iii-c) and the evolve-below-HP mid-turn KO (dialoged, 2b-i) — **no NEW park surface**,
since plain `evolve` has been on the allowlist since 2a and reaches the identical tail. Round-trip untouched
(`decisionFromPhase` keeps turn:action→null) — pinned with a POPULATED `rareCandy` list. engine RULES
UNCHANGED (0.40.0 — a transport/read surface); 1803 → **1812** tests. `bun run check` green. Built solo with
full context; **self-reviewed, no independent reviewer this session** (offered — `/code-review` is
user-triggered). **RECORDED (pre-existing engine gap, not introduced here):** `stage2EvolvesFromBasic`
resolves the bridge Stage 1 against the SHARED `cardPool` (both decks), so a player whose own deck runs no
copy of the bridge Stage 1 but whose OPPONENT does gets a lit dialog they otherwise wouldn't — a faint
decklist inference; it is the documented ingest-debt gap in cardplay.ts, identical in local hot-seat, and
fixing it is an engine/ingest change, not a transport one. **With this, every turn affordance the local HUD
offers has an online counterpart.** **VERIFIED IN A REAL BROWSER (same session):** a two-client run
(two accounts, two D1 decks, one WS lobby) drove Rare Candy end-to-end — Fuecoco → Skeledirge, skipping
Crocalor — and confirmed the 3a session cookie survives the cross-origin WS upgrade, the event log renders
+ relabels on both clients, the 3b ability/trainer greying is faithful (incl. the once-per-turn self-grey),
and the deck-search candidates reach the controller ALONE. Zero page errors. The run also surfaced one
PRE-EXISTING bug (the Pass turn button is covered by the turn panel in BOTH /play and online — see
`polish.md`; a layout decision, not a P4 regression). **NEXT (resume point):** commit this slice, then
**3c+** — the match LIFECYCLE (reconnect/timeouts, concede/rematch, spectate) + the DO-storage-migration
hardening (the 2b-iii-d-ii LOW), with the Pass-turn fix first.
See D71 + `workstreams/online.md`. Below: the P4-3b header (kept for continuity).

---
### Prior header (P4 increment 3b — the online ability + non-Stadium trainer HUD, kept for continuity)
**Last updated (was):** 2026-07-25 — build session #56 (**P4 increment 3b — the online ability + non-Stadium
trainer HUD**). The online turn HUD now offers activated Abilities + non-Stadium Trainers (Items/Supporters),
closing the loud 3b GAP D69 recorded — real decks (3a) made both reachable but the HUD had no button for
either, so a deck needing one could STALL. **Same server-compute-then-ship pattern as 2b-i/ii's `attacks`/
`retreat`:** the predicates the local HUD reads (`programPlayable`/`conditionHolds`/`handCostUnmet`) touch
the Stadium OWNER, prize counts and the own hand the wire withholds, so the redactor folds them SERVER-SIDE
and ships only the result. **Wire:** `RedactedPhase.turn:action` gained **`abilities`** (`RedactedAbility` —
`target`/`abilityName`/`label`/`disabled`/`reason`) + **`trainers`** (`RedactedTrainer` — `uid`/`name`/
`disabled`/`reason`), each a server-folded playability boolean + a greyed-row reason. **Engine:**
`redactPhase` fills them via new **`redactedAbilitiesOf`/`redactedTrainersOf`** (redact.ts), mirroring
GameHud's `usableAbilities`/`playableTrainers` field-for-field (the §9 Active-only + the once-per-turn
`abilitiesUsed` gate, the §4/§7.2 Supporter timing, the printed `trainerPlayableIf`, the §7.5 hand cost, and
the would-only-whiff gate) — emitted to the ACTING viewer ONLY (`viewerSeat !== turnSeat` ⟹ [], like
attacks), reading only the actor's OWN public board + OWN hand, so nothing hidden leaves the DO and the
opponent's view carries none. `RedactedAbility.target` reuses a new standalone `redactedPokemonTargetSchema`
(the seatless `PokemonTarget` `useAbility` dispatches back), kept SEPARATE from `RedactedPokemonRef` because
extracting the union and referencing it from that ref broke Zod's discriminated inference the 2b-iii
round-trip depends on — a low-risk three-line duplication. **Round-trip untouched:** neither list enters the
playmat projection (`decisionFromPhase` keeps turn:action→null), so `projectionFromRedacted ≡
projectGameState` still holds — pinned with a POPULATED turn:action (a real Chien-Pao ex ability board), the
guard 2b-i/ii used for attacks/retreat. **Client:** `OnlineHud`'s AttackPanel gained the Abilities +
Trainers sections restated from GameHud over the wire shape (the reason on the LI `title` + an sr-only twin,
the disabled greying), dispatching `useAbility`/`playTrainer`. **API DO:** `SUPPORTED_MATCH_ACTIONS` +=
`useAbility` (`playTrainer` was already on for the Stadium drag); soft-lock-safe like `attack`/
`resolveEffect` — a crafted play off its phase is engine-rejected (`turnGate`), and a parking play drives to
completion via the dialoged effect layer (the 2b-iii invariant). **SCOPED — Rare Candy DEFERRED:**
`redactedTrainersOf` omits Stadiums (they play by the 2a board drag) AND Rare Candy (its `rareCandy` action +
a two-step Basic/Stage-2 dialog reading `rareCandyOptions` off the full state is its own wire surface — a
follow-up sub-slice), so no dead button is offered; a Rare-Candy-dependent deck can still stall on that ONE
play (the narrower carry-forward gap). engine RULES UNCHANGED (0.40.0 — a transport/read surface); 1790 →
**1803** tests (redact abilities/trainers passthrough + actor-gate + activeOnly-bench greying + dedup + §4
supporter-ban + Stadium/RareCandy exclusion, a populated-turn:action round-trip, 3 OnlineHud DOM
dispatch/disabled/reason cases, the match.test allowlist update — useAbility now supported + soft-lock-safe
off-phase, rareCandy still refused). `bun run check` green. Built solo with full context; **1 read-only adversarial
reviewer: NO HIGH, NO MED** — all six scrutinized properties HOLD: leak (both folds actor-gated + read only
the actor's own board/hand, so the opponent's view carries none — leak posture identical to
`redactedAttacksOf`), fidelity (both folds are field-for-field the local `usableAbilities`/`playableTrainers`
— no greyed-while-legal / lit-while-illegal drift), soft-lock safety (the `useAbility` handler rejects
off-phase without throwing, and a parking play resolves since every prompt kind is dialoged), round-trip
(neither list enters the projection), dispatch shapes (match the engine actions + local dispatches verbatim,
the DO rebinds the seat), and purity. **1 LOW — FIXED:** a card with TWO activated abilities shared one
`target` literal across its rows (harmless — never mutated, JSON-serialized — but a footgun); now a fresh
per-row rebuild (the `redactedRefOf` precedent). **1 LOW — RECORDED (residual, not a defect):** an Ability
can be the FIRST online play to reach the `moveEnergy`/`discardEnergy`/`choosePokemonMulti` parks (the
fixed/effect-attack decks may never have), so any latent bug in those specific dialogs would surface now —
the reviewer confirmed all three have components + the switch is exhaustive, so no actual break, just newly
reachable surface (the "test-only until a real browser run" caveat). **Still unverified:** a two-client
browser run with an ability/trainer deck (the surface is test-only — the prior fixed decks had neither).
**NEXT (resume point):** commit this slice; the remaining online TURN affordance is the **online Rare
Candy** (a `rareCandyOptions` wire surface + its dialog + the `rareCandy` allowlist entry), after which
**3c+** (reconnect/timeouts, concede/rematch, spectate) + the DO-storage-migration hardening (the
2b-iii-d-ii LOW). See D70 + `workstreams/online.md`. Below: the P4-3a + 3a-sec header (kept for continuity).

---
### Prior header (P4 increment 3a + 3a-sec — real deck selection + seat authentication, kept for continuity)
**Last updated (was):** 2026-07-24 — build session #55 (**P4 increment 3a + 3a-sec — real deck selection at the
match handoff, and seat authentication**). The lobby now loads each player's OWN chosen deck from D1 instead
of the fixed placeholder decks — the first AUTHENTICATED surface in an otherwise account-less lobby — and
the review's one MED (a bearer-only-seat HAND leak) was FIXED in the same session as **3a-sec**. **Increment
3 is SPLIT** (it was large): 3a (this — resolution + the failure surface), 3a-sec (seat authentication —
folded in), 3b (the online ability + non-Stadium trainer HUD), 3c+ (reconnect/timeouts, concede/rematch,
spectate). **The auth boundary (the crux, aligned with the user
— "authenticate the WS"):** seat identity stays account-less (anonymous playerIds), but the `/ws` upgrade
now resolves the FORWARDED `session` cookie to an account (new **`resolveUserIdFromCookie`**, read-only —
no lazy-delete, unlike `requireUser`) and stashes it on the SOCKET (`attachment.ts` gained
`attachUserId`/`attachedUserId`, set BEFORE the hello and each preserving the other) — **DO-only, never on
the broadcast snapshot** (PlayerState has no userId). At handoff the DO resolves each player's chosen deck
**OWNER-SCOPED** (new **`loadPlayerDeck`** — `WHERE decks.id = <client deckId> AND decks.userId = <the
socket's authenticated userId>`, via `this.userIdOf(playerId)` off the live socket), so a crafted
`select-deck` naming ANOTHER user's deck id resolves to nothing (the 404-as-missing the deck routes give)
and an anonymous socket (null userId) is refused before any query. **Contents come from D1, never the
client** (only an opaque `deckId` crosses), so a client can't forge an illegal 60; `startMatch`/createGame
stays the authoritative validator (60 + a Basic). **The failure surface (the load-failure wedge, finally
closed):** `handoffToMatch` returns **`{ok}|{ok:false,reason}`**; the alarm flips to in-game ONLY on
success — on failure it **`resetAfterFailedStart`** (un-readies both → back to `selecting`, breaking the
countdown re-fire) and broadcasts a new **`{kind:"match-error", reason}`** server frame to both, so players
see WHY (not signed in / deck not theirs / malformed) and retry cleanly (no MatchRecord was written).
Client: **`useLobby.matchError`** on the versus screen. `FIXED_MATCH_DECKS` removed. **3a-sec (the seat-auth
fix):** a new pure **`seatClaimAllowed(bound, userId)`** + a DO-only **`SEAT_USERS_KEY`** (playerId→account)
map — the `hello` handler binds a playerId to its account on the FIRST authenticated claim and refuses any
later hello replaying that playerId without the matching session (so an impersonator can't take the seat or
its redacted hand); an unbound anonymous seat stays bearer-only (and can't reach an in-game real-deck match
anyway). 1782 → **1790** tests (+ `deckIdsFromRows`, the `loadPlayerDeck` auth guards, attachment userId
round-trip, `resetAfterFailedStart`, the match-error wire accept/refuse, `seatClaimAllowed`; fixed-deck
tests removed). `bun run check` green. **3b GAP (loud):** with
real decks, abilities + non-Stadium trainers (Supporters/Items) are reachable but the online HUD has NO
affordance for them (`useAbility` off the allowlist; only the Stadium DRAG sends `playTrainer`), so such a
deck can STALL — a missing affordance, not an engine soft-lock, the next sub-slice. **Still unverified:** a
real browser two-client run confirming the SameSite=None session cookie reaches the DO on the cross-origin
WS handshake (the code path forwards it; the browser behavior is standard but untested here). Built solo
with full context; **1 read-only adversarial reviewer: NO HIGH** — all five ranked properties HOLD:
deck-ownership auth (you can only load a deck owned by the account whose session TOKEN you hold — a crafted
`deckId` reads as missing, an anonymous/null-deck socket is refused pre-query), userId confidentiality
(grep-confirmed absent from every schema — never on the wire), session resolution (read-only; rejects a
forged/expired/absent cookie), the failure surface (in-game unreachable without a MatchRecord, no alarm
re-fire loop, retry unblocked), and no regressions (no dangling `FIXED_MATCH_*`). **1 MED — FIXED
in-session as 3a-sec (a PRE-EXISTING leak 3a ELEVATED):** seat identity was bearer-only (the D60 L2 gap) — a
socket replaying a seat's PUBLIC `playerId` reseated and got that seat's redacted HAND, meaningful now the
deck is real. Fixed by binding a playerId to the account that first claimed it (above); **a second read-only
review confirmed the leak is CLOSED** (no `hello` path reaches a match emitter for a seat bound to a
different account; an in-game seat is ALWAYS bound since handoff requires both authed) **with no legit
reconnect broken** (ordinary reconnect + the anonymous→authenticated upgrade both pass) — 3 LOW by-design
notes recorded below. **2 LOWs from the 3a review, RECORDED (not fixed):** `userIdOf` reads an arbitrary
same-`playerId` socket (a spurious `match-error` if two live sockets carry different userIds — a mid-lobby
login change; recoverable), and `match-error` broadcasts the sign-in-state reason to both (trivial — the
name is already public). See D69. Below: the P4-2b-iii-d-ii header (kept for continuity).

---
### Prior header (P4 increment 2b-iii-d-ii — the online event log, kept for continuity)
**Last updated (was):** 2026-07-24 — build session #54 (**P4 increment 2b-iii-d-ii — the online event log**).
Online play now shows the game log (was `NO_LOG`), built SERVER-SIDE and broadcast to both clients — the
last of 2b-iii-d, and the multi-package refactor d-i deferred. **The move:** the pure GameEvent→rows
formatter **`logFromEvents`** (+ `formatElapsed`/`STATUS_LABELS`/`LogContext`) moved from the web
(`src/features/game/logFromEvents.ts`) INTO **`@luminous/engine`** (`log.ts`, exported from the barrel) —
it reads engine events/state and now runs in TWO places (the /play client AND the DO), so the engine is
its single home (the `redactGame` precedent, D60). The wire log types live in **`@luminous/schema`**
(`match/log.ts`, Zod source-of-truth): **`SeatLogEntry`** (seat-keyed — `who` ∈ p1/p2/system) +
`LogSegment`. **The KEY property:** the log is broadcast SEAT-KEYED and **identical to both clients** —
it is LEAK-SAFE regardless of viewer (counts for hidden draws/prizes, face-down setup placements unnamed,
every named card resolved off PUBLIC state — the `logFromEvents` module invariant, unchanged by the move,
and no more revealing than local hot-seat, where one screen already shows both players' rows), so there is
nothing to redact per-viewer, only to RELABEL. The p1/p2→you/opponent relabel (**`viewLogEntries`**)
stayed in the web (`src/features/game/viewLog.ts`, the `projectionFromRedacted` twin), run client-side
over the viewer's own `game.seat`; the `LogEntry`/`LogSource` RENDER types stayed in the playmat (its zero
cross-package imports preserved). **Wire:** the `{kind:"match"}` frame grew **`log: SeatLogEntry[]`**
(`LobbyMessage` + `matchMessageSchema`, the exactness proofs still hold) — it rides the FRAME, NOT
`RedactedGame`, because it accumulates across the whole game and can't be rebuilt from one snapshot's
state, so **`RedactedGame`/`redactGame`/the round-trip pins are UNTOUCHED** (no engine rule change).
**API:** `MatchRecord` grew **`startedAt`** (the "+MM:SS" origin), **`names`** (host→p1/guest→p2 display
names, for the log's system rows) and **`log`**; **`applyMatchAction` takes a `now` arg** (the pure
reducer stays clockless — the DO stamps `Date.now()` once per action, the `useLocalGame` pattern) and
APPENDS the accepted events' rows. The DO's `handoffToMatch(snapshot)` seeds startedAt/names/initial-log
from createGame's events at +00:00; `broadcastMatch` sends `record.log` whole to each socket (a reconnect
gets the full backlog). **Client:** `useLobby.matchLog` (set with `match` on the frame, cleared with it on
leaving in-game); `OnlineMatch` renders `viewLogEntries(log, seat)`. engine RULES UNCHANGED (a
transport/read surface); 1777 → **1782** tests (wire log accept/refuse/round-trip, match.test log-append +
elapsed-stamp + reject-untouched, the engine log suite moved with a seat-keyed assertion, a web `viewLog`
relabel test, an OnlineMatch DOM log-render case). `bun run check` green. **Unlike D64–D67 this surface IS
exercisable end-to-end with the fixed decks** (they emit a real log), so a two-client browser run would
verify it (not done — test-only so far). Built solo with full context; **1 read-only adversarial
reviewer: NO HIGH, NO MED** — the LEAK property HOLDS under a per-arm classification of `formatEvent`
(every row names nothing / a seat label / a COUNT for a hidden zone / a genuinely-public in-play card;
the two naming-reveal events `HAND_REVEALED`/`CARD_TO_BOTTOM_OF_DECK` fire ONLY after a public hand
reveal; setup benching stays `POKEMON_PLACED`-unnamed vs mid-game `POKEMON_BENCHED`-named), so one
identical `record.log` to both sockets leaks nothing; seat-keying/relabel, record lifecycle
(drop-on-abandon, reconnect backlog), purity (fresh array, `now` threaded) and the exactness/round-trip
pins all hold. **2 LOWs, both RECORDED (not fixed):** (1) a `MatchRecord` written by PRE-slice code
(`{seed,state}`) and read across THIS deploy lacks `startedAt`/`names`/`log` → NaN elapsed + a
`names[…]` TypeError on a system row (and `log:undefined` → a client render throw) — narrow (a match
in-flight across one deploy, dev-only fixed decks), self-heals on abandon+rematch, part of the
acknowledged no-DO-storage-migration gap (the fix lands with increment 3's storage hardening); (2) the
whole log re-broadcasts every action (O(n²) bandwidth) — the deliberate simplicity tradeoff (already
in-code-commented), a later delta/paginate pass. See D68. Below: the P4-2b-iii-d-i header (kept for
continuity).

---
### Prior header (P4 increment 2b-iii-d-i — the online rejection pill, kept for continuity)
**Last updated (was):** 2026-07-24 — build session #53 (**P4 increment 2b-iii-d-i — the online rejection
pill**). A refused game action now surfaces to the ACTOR as a transient pill instead of vanishing
silently (the gap the DO code flagged: "increment 2b adds the rejection pill"). **2b-iii-d is SPLIT**
into d-i (this — the pill) and d-ii (the online event log, a bigger multi-package refactor: move
`logFromEvents` + the log types from `apps/web` into shared packages so the DO can build rows
server-side, accumulate them in `MatchRecord`, and broadcast them). **Wire:** a new `@luminous/schema`
server frame **`{kind:"reject-action", reason}`** (added to `LobbyMessage` + `lobbyServerMessageSchema`,
server-only — the client schema refuses it). **API:** `applyMatchAction` now returns a discriminated
**`MatchActionOutcome`** (`{ok:true,record} | {ok:false,reason}`) — the reason is generic for an
off-allowlist type and the ENGINE's own `error.message` for an illegal move (safe: it describes the
actor's own move/phase, never the opponent's hidden zones). The DO's `case "action"` sends
`reject-action` to the acting socket on `!ok`. **Client:** `useLobby.actionError` (`{reason, nonce}` —
bumped per rejection so a repeat re-announces, cleared by the next accepted `match`); `OnlineMatch`
renders the shared **`TransientErrorPill`** with the GamePage nonce+TTL dismiss pattern. engine
UNCHANGED; 1774 → **1777** tests (wire schema accept/refuse, `applyMatchAction` reason, 3 OnlineMatch DOM
pill cases). `bun run check` green. Built solo with full context; **1 read-only adversarial reviewer: NO
HIGH** — the info-leak check is clean (no engine error message names an opponent-hidden card; delivery is
actor-only). **1 MED FIXED:** a nonce collision (reject→dismiss→accept→reject-again silently swallowed the
second pill — useLobby's nonce restarts, OnlineMatch's dismissedNonce didn't clear); fixed by resetting
dismissedNonce when actionError goes null (+ a DOM test over that path). 1 LOW recorded (crafted-frame
engine jargon, actor-only cosmetic); the local GamePage pill has the same latent defect (pre-existing,
out of scope). See D67. Below: the P4-2b-iii-c header (kept for continuity).

---
### Prior header (P4 increment 2b-iii-c — the online hidden-candidate effect prompts + the resolveEffect allowlist flip, kept for continuity)
**Last updated (was):** 2026-07-24 — build session #52 (**P4 increment 2b-iii-c — the online hidden-candidate
effect prompts + the resolveEffect allowlist flip**). `chooseCards` (deck search / discard retrieval /
look-at-top / §7.5 hand cost) + `attachCards` (attach revealed deck/top cards) now cross the wire and
get online dialogs — the LAST two of the seven `EffectPrompt` kinds — so with EVERY kind dialoged
**`resolveEffect` goes ONTO `SUPPORTED_MATCH_ACTIONS`** (the invariant the `match.ts` SEQUENCING
CONSTRAINT has guarded since 2b-i). **Why last:** unlike the public-ref family (D65), their candidates
are the CONTROLLER's OWN deck / looked-at-top / hand / discard cards — the deck ones HIDDEN even from
the controller until the effect REVEALS them — so this is where the answerer gate becomes the
load-bearing HIDDEN-INFO barrier. **Wire:** `RedactedEffectPrompt`'s two new arms carry a
**`RedactedCard` per candidate** (full identity — the reveal — keyed by the engine uid the answer sends
back); chooseCards adds `min`/`max`/`dest`, attachCards adds `targets`(refs)/`max`/`maxPerTarget?`.
**Engine:** `redactPrompt` now takes `state` + resolves each candidate uid via the SAME `redactedCardOf`
the public board uses (fresh objects — purity), sent to the answerer ALONE. The security property: a
deck uid must NEVER appear in the opponent's snapshot, and it doesn't (their prompt is null, their view
of both decks is a count) — a leak barrier drives a real deck-search park and asserts NO candidate uid
crosses to the non-answerer. **Web:** `decisionFromPhase` recovers the engine `string[]` uids from the
`RedactedCard[]` (`c.id`), so the answerer-view round-trip still holds despite the differing shape.
**Client:** `OnlineHud` gained `ChooseCardsDialog` (min-gated cost vs "up to", dest-driven verb) +
`AttachCardsDialog` (pick-card→pick-target loop, sole-target auto-commit, per-target cap), reading
identities off the prompt; the shared `effect:choose` render now KEYS on the prompt (`JSON.stringify`)
so a second same-kind park (Ultra Ball's hand cost → deck search, both chooseCards) REMOUNTS with fresh
picks — the local `promptKey` behaviour, which also closes the latent parity gap in the 2b-iii-b
dialogs. **API DO:** `SUPPORTED_MATCH_ACTIONS` += `resolveEffect` — soft-lock-safe on ANY deck
(`applyAction` rejects it off an effect:choose park and validates the choice on one; `match.test.ts`
updated). With every prompt kind dialoged, the effect-dialog precondition on real decks (increment 3)
is now MET. engine UNCHANGED (0.40.0 — a transport/read surface); 1767 → **1774** tests (a real
deck-search reveal + leak barrier + attachCards reveal/withhold, 1 answerer-view round-trip over
chooseCards + attachCards, 4 OnlineHud DOM, the match.test allowlist update). `bun run check` green.
Built solo with full context; **1 read-only adversarial reviewer: NO defects at HIGH, MED, or LOW** —
the two highest-stakes properties held under scrutiny: (LEAK) the only code that resolves a candidate to
a `RedactedCard` runs ONLY for the controller (answerer gate), identities live in exactly `board` +
`phase.prompt`, and both decks are a count for both viewers, so no deck uid reaches the opponent (leak
test covers every zone + the null prompt); (ALLOWLIST) `resolveEffect` rejects off-park, checks the
answerer with the same expression as `phaseViewOf`, and `validateChoice` is totally defensive — a
crafted frame rejects, never soft-locks. Round-trip/dialog-parity/purity/key all hold; two informational
non-defects recorded (the online key omits seat+turn — safe in single-viewer; the `maxPerTarget:
undefined` key is dropped by the wire). The reviewer independently ran `bun run check` green. See D66.
Below: the P4-2b-iii-b header (kept for continuity).

---
### Prior header (P4 increment 2b-iii-b — the online public-ref effect prompts, kept for continuity)
**Last updated (was):** 2026-07-24 — build session #51 (**P4 increment 2b-iii-b — the online public-ref
effect prompts**). The `effect:choose` PUBLIC-REF family — **`choosePokemon` / `choosePokemonMulti` /
`moveEnergy` / `discardEnergy`** — now crosses the wire and gets online dialogs (the second of three
2b-iii sub-slices, after D64's `mayDraw` seam). **Why this family next:** their candidates are ALL
in-play `PokemonRef`s and attached-Energy uids ALREADY public on the redacted board, so the wire
carries the refs/uids and the client resolves display identity against the board it already has — NO
hidden-card resolution (that is 2b-iii-c's chooseCards/attachCards). **Wire:** `RedactedEffectPrompt`
gained the four arms + a new **`RedactedPokemonRef`** (+ `RedactedDiscardScope` / `RedactedEnergyOffer`).
`RedactedPokemonRef.seat` is **ABSOLUTE (p1/p2), NOT viewer-relative** like the rest of `RedactedGame`,
and deliberately: these refs must round-trip to the engine's own `PokemonRef` AND ride the dispatched
`resolveEffect` choice back to the DO **VERBATIM** (the DO rebinds the ACTING seat, never a choice's
TARGET refs; the engine's `validateChoice` keys on the exact offered refs). Not a leak — every in-play
Pokémon is public post-setup and the viewer knows its own absolute seat (`RedactedGame.seat`); the
client maps `ref.seat === game.seat ? you : opponent`. **Engine:** `redactPrompt` maps the four kinds
via `redactedRefOf` / `redactedOfferOf` / `redactedScopeOf` — FRESH copies (the redactor's no-alias
purity contract, like `copyConditions`). Still answerer-only through the SAME `redactedPromptOf` gate —
but these are **CONTROLLER-answered** (`answerer` undefined ⟹ `answerer ?? seat = seat`), so the wire is
**STRICTER than `phaseViewOf`** (which keeps the prompt for BOTH viewers, harmless there): the prompt
reaches the controller ALONE. `chooseCards`/`attachCards` still return null. **Web:** `decisionFromPhase`
→`effectDecisionFromPrompt` reconstructs the full engine `EffectPrompt` field-for-field, so
**`projectionFromRedacted ≡ projectGameState` now holds for a public-ref park — for the ANSWERER's view
only** (the opponent's is deliberately unequal: the wire withholds the prompt where the local projection
keeps it; the round-trip pin is scoped accordingly). **Client:** `OnlineHud` gained the four dialogs
routed through a new **`EffectChooseDialog`**, each restated over the redacted wire shape (the
D60/D62/D63 restate-per-surface choice) and resolving display names off the board via new
`pokemonAt`/`refName`/`energyName` helpers (mirroring the local staged moveEnergy, grouped discardEnergy,
declinable-gap snipe, and direct-dispatch single pick). **API DO:** `resolveEffect` STAYS OFF
`SUPPORTED_MATCH_ACTIONS` — the invariant is "`resolveEffect` on the set ⟺ EVERY prompt kind dialoged",
and chooseCards/attachCards still aren't; the fixed pure-basic decks can't reach `effect:choose`, so the
dialogs are built + unit/DOM-tested ahead of the allowlist flip (D64's pattern; the `match.ts` SEQUENCING
CONSTRAINT comment is refined). engine UNCHANGED (0.40.0 — a transport/read surface); 1754 → **1767**
tests (6 engine passthrough/answerer-gate/purity cases, 1 answerer-view round-trip over all four kinds,
6 OnlineHud DOM dispatch/gating cases). `bun run check` green. **Still unverified:** a two-client browser
run (the fixed decks can't reach `effect:choose`, so this surface is test-only until real decks — same
as D64). Built solo with full context; **1 read-only adversarial reviewer: NO defects at HIGH, MED, or
LOW** — the answerer gate is character-for-character `phaseViewOf`'s `waitingSeat` gate, the absolute-seat
refs/uids are a strict subset of the face-up board that already crosses to that viewer (no leak),
purity/round-trip/dispatch-shape/board-resolution/allowlist all hold, and each dialog is behaviorally
identical to its local twin; the reviewer independently ran `bun run check` green. See D65. Below: the
P4-2b-iii-a header (kept for continuity).

---
### Prior header (P4 increment 2b-iii-a — the online effect:choose prompt seam + the mayDraw dialog, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #50 (**P4 increment 2b-iii-a — the online effect:choose
prompt seam + the mayDraw dialog**). The mid-effect DECISION PROMPT now crosses the wire, redacted
per-viewer. **2b-iii is SPLIT** (7 `EffectPrompt` kinds — the choosePokemon/moveEnergy/discardEnergy
family needs board-relative ref resolution, the chooseCards/attachCards family needs server-side
`RedactedCard` resolution of the CONTROLLER's private deck cards): 2b-iii-a lands the SEAM with the one
prompt that has no card references AND the only one whose answerer is the NON-controller — **`mayDraw`**
(Ortega's "your opponent may draw a card") — so it makes the answerer/leak gate load-bearing without any
identity resolution; 2b-iii-b the public-ref family, 2b-iii-c the hidden-candidate family (which flips
`resolveEffect` onto the allowlist), 2b-iii-d the event log + rejection pill. **Wire:** a new
`@luminous/schema` **`RedactedEffectPrompt`** (discriminated union, `mayDraw` arm = `count`/`note`, Zod
source-of-truth); `RedactedPhase.effect:choose` gained **`prompt` NULLABLE** (null for the non-answerer
AND a not-yet-dialoged kind). **Engine:** `redactPhase`'s effect:choose fills it via
**`redactedPromptOf(phase, viewerSeat)`** — non-null ONLY for the answering seat (`phase.answerer ??
phase.seat`), **STRICTER than `phaseViewOf`'s hot-seat `withheld`**: the wire delivers a payload to one
client, so a controller-answered prompt goes to the CONTROLLER ALONE (the hot-seat projection may keep
it in both viewers' never-rendered `pendingDecision`); the two coincide when `answerer` is set, ALWAYS
for mayDraw. `redactPrompt` maps mayDraw and returns null for the 6 controller-answered kinds via an
EXHAUSTIVE switch (a new engine prompt kind is a compile error). The answerer gate is the hidden-info
barrier — a chooseCards/attachCards prompt's candidates are the controller's own deck uids, which must
NEVER cross. **Web:** `decisionFromPhase` reconstructs the mayDraw `PendingDecision.effectChoose`
(`effectDecisionFromPrompt`), so **`projectionFromRedacted ≡ projectGameState` now holds for a mayDraw
park (both viewers)** — the round-trip pin no longer excludes `effect:choose` wholesale (the other kinds
stay null on the wire, so their parks still don't round-trip — deliberately scoped). **Client:**
`OnlineHud` gained an `effect:choose` case + a **`MayDrawDialog`** (each button IS the answer →
`resolveEffect{mayDraw, draw}`; mandatory, no dismiss, Draw focused first; no seat name — online has no
hot-seat ambiguity), gated on `acting && prompt?.kind === "mayDraw"`. **API DO:** `resolveEffect` STAYS
OFF `SUPPORTED_MATCH_ACTIONS` — the invariant is "`resolveEffect` on the set ⟺ EVERY effect prompt kind
has an online dialog", and only mayDraw does; the `match.ts` SEQUENCING CONSTRAINT is refined (real decks
must not precede ALL of 2b-iii). With the fixed pure-basic decks `effect:choose` is UNREACHABLE online,
so the dialog is built + unit/DOM-tested ahead of its allowlist flip. engine UNCHANGED (0.40.0 — a
transport/read surface); 1747 → **1754** tests (3 engine answerer-gate/leak, 1 real-Ortega round-trip
both viewers, 3 OnlineHud DOM). `bun run check` green. **Review (1 read-only adversarial reviewer): NO
HIGH, NO MED** — the answerer gate is airtight under a complete case analysis (defined answerer ⟺
mayDraw ⟹ never gated out; undefined answerer ⟹ a controller kind ⟹ null to everyone), so ONLY
`{mayDraw,count,note}` or `null` ever crosses the effect:choose wire — private candidates never cross;
the round-trip is genuinely reproduced; the exhaustiveness guards are real. **TWO LOWs — 1 FIXED**
(the schema/redactor docs claimed `redactedPromptOf` "mirrors `phaseViewOf` exactly" — false for
controller-answered parks, corrected in both), **1 RECORDED** (deliberate): the `MayDrawDialog`
dispatches `resolveEffect`, which the DO rejects, and the dialog is mandatory — IF a mayDraw park were
reachable online the answerer would strand; unreachable with the fixed decks (no Ortega), the fix is the
allowlist flip in 2b-iii-c, and putting `resolveEffect` on now would be a WORSE strand at an un-dialoged
park. See D64. Below: the P4-2b-ii header (kept for continuity).

---
### Prior header (P4 increment 2b-ii — online retreat, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #49 (**P4 increment 2b-ii — online retreat**). The online
turn HUD can now RETREAT. Following the "was Slice 1, now split" discipline, 2b-ii is scoped to RETREAT
ALONE: the fixed basic decks (Sneasel/Mareep + Energy) have no abilities and no non-Stadium trainers,
so those surfaces can't be exercised end-to-end against a real online game — they move to real deck
selection (increment 3). **Wire:** `RedactedPhase.turn:action` gained a **`retreat`** field — a new
`@luminous/schema` **`RedactedRetreat`** (`cost`/`can`), Zod source-of-truth, NULLABLE (null for the
non-acting viewer, like `attacks: []`). The engine's `redactPhase` fills it via a new
**`redactedRetreatOf(state, viewerSeat, turnSeat)`**: the viewer's OWN Active's CONTINUOUS retreat cost
(§7.3 Beach Court discounts) + a server-computed **`can`** folding the §12 immobilize gate, the
once-per-turn `retreated` allowance, a non-empty Bench and enough attached energy into ONE boolean —
EXACTLY the local `TurnPanel`'s `canRetreat`, so the online client adds no engine logic. Turn-owner +
own-Active only, so nothing hidden leaves the DO (the energies to discard and the Bench to promote to
were already public on the board). **API DO:** `SUPPORTED_MATCH_ACTIONS` grew by **`retreat`** — and
unlike `attack`, retreat carries NO sequencing caveat: the engine's `retreat` handler (`turn.ts:333`)
only discards energy + promotes a Bench Pokémon, returning `ok(next)` with the phase UNCHANGED (never
parks at `effect:choose`), so it is soft-lock-safe with ANY deck; it also validates every field
defensively (`discardEnergy` an array of exactly `cost` attached uids, a real bench index), so a
crafted frame is rejected, not crashed. **Client:** `OnlineHud`'s AttackPanel gained a **Retreat (cost)
button** (disabled off `retreat.can`) and a **`RetreatDialog`** (the local HUD's, restated over the
wire shape: pick `cost` attached energies + a Bench Pokémon → dispatch `retreat`); the `Dialog` helper
gained an optional `onDismiss` so retreat is dismissable while the ko:* dialogs stay mandatory. The
`turn:action` round-trip equality still holds (`retreat` never enters `GameProjection` —
`decisionFromPhase` keeps `turn:action`→null). engine UNCHANGED (0.40.0 — a transport/read surface);
1740 → **1747** tests (5 engine retreat-gate cases + 2 OnlineHud DOM cases). `bun run check` green.
**Review (1 read-only adversarial reviewer): NO defects at HIGH, MED, or LOW** — `can` is field-for-field
identical to the local `canRetreat`, `redactedRetreatOf` is null for the non-acting viewer (no leak),
the `retreat` handler returns `ok(next)` phase-unchanged (soft-lock-safe with any deck), the dispatched
`discardEnergy` uids are engine uids (`redactedCardOf.id`) matching the handler's membership check, the
prize/bench indices align 1:1, and the round-trip pin holds. See D63. Below: the P4-2b-i header (kept
for continuity).

---
### Prior header (P4 increment 2b-i — the online attack + KO loop, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #48 (**P4 increment 2b-i — the online attack + KO
loop**). The online match now plays **TO A WIN** with the fixed basic decks: attack → take prizes →
promote. 2b was too big for one increment (the local turn HUD reads the full `GameState`, unsafe over
a projection), so it's SPLIT — 2b-i lands the attack/KO loop; retreat + abilities/trainers (2b-ii) and
the effect:choose prompt+dialog (2b-iii) follow. **`RedactedPhase.turn:action` gained an `attacks`
list** — a new `@luminous/schema` **`RedactedAttack`** (`index`/`name`/`cost`/`damage`/`playable`).
The engine's `redactPhase` fills it via a new **`redactedAttacksOf(state, viewerSeat, turnSeat)`**:
the viewer's OWN Active's printed attacks, each with a server-computed **`playable`** folding §8.2
payability (`effectiveAttackCost`+`providedEnergy`+`costMet`, under the Stadium's continuous cost),
the §4 first-turn ban and the §12 immobilize gate — EXACTLY the local `TurnPanel`'s `disabled`, so
the online client needs NO engine logic. Populated **only for the turn owner** (the opponent's view of
the same `turn:action` carries `[]`), **own Active only** (public), so nothing hidden leaves the DO.
The DO's **`SUPPORTED_MATCH_ACTIONS`** grew by **`attack`/`takePrizes`/`promote`** — with the
pure-damage fixed decks (no status/abilities) these never reach `effect:choose`, so no soft-lock;
`resolveEffect`/`retreat`/`useAbility` stay blocked. **`OnlineHud`** gained an **AttackPanel**
(bottom-right, mirroring the local `TurnPanel`) and the **ko:takePrizes / ko:promote dialogs**
(centered overlays) — the ko dialogs need **NO new wire data** (count rides the phase, own
prizes-count/bench ride the board). **`EnergyDots` extracted** to a shared
`src/features/game/EnergyDots.tsx` (GameHud + OnlineHud, one source). The `turn:action`
round-trip-equality (`projectionFromRedacted` ≡ `projectGameState`) still holds — `attacks` never
enters `GameProjection`. engine UNCHANGED (0.40.0 — a transport/read surface); 1731 → **1740** tests,
`bun run check` green. **Review (1 read-only adversarial reviewer): NO HIGH, NO MED** — the
server-side payability faithfully mirrors the local `TurnPanel`'s `disabled`, leaks nothing
(turn-owner + own-Active + viewer-public), the action shapes match the engine handlers, and the
round-trip equality holds. **FIVE LOWs — 2 FIXED** (an orphaned EnergyDots doc comment in GameHud;
the ko `Dialog` is now a native `<dialog>`), **3 RECORDED** (the restate-per-surface HUD markup, the
omitted §12 immobilize notes, and the plan-ordering soft-lock guarantee) — see D62 / online.md.
Below: the P4-2a header (kept for continuity).

---
### Prior header (P4 increment 2a — the action transport + online setup flow, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #47 (**P4 increment 2a — the action transport +
online setup flow**). The online match is now INTERACTIVE (setup + basic turn drags + pass). A
new **`{kind:"action", action}`** client frame (schema — `wireActionSchema` = `z.looseObject`,
loosely typed on purpose: the DO rebinds the seat and relies on `applyAction`'s totality) carries an
engine `GameAction`. The DO's new **`case "action"`** handler binds the action to the SOCKET's own
seat via `matchSeatOf` (host→p1/guest→p2) — **never the client-claimed `action.seat`, so a client
can't act for its opponent** — gated to a seated player in an in-game lobby with a persisted record,
runs the pure **`applyMatchAction(record, seat, action)`** (persist-before-broadcast), and re-fans
each socket its redacted view. `applyMatchAction` gates to **`SUPPORTED_MATCH_ACTIONS`** (the
2a-drivable subset) so a crafted attack/decision frame can't soft-lock the match in a phase the 2a
HUD can't drive. **`RedactedGame` gained a redacted `phase`** (the action-routing discriminant;
`pendingDecision` folded into it, derived client-side). **`moveToAction` + `placement.ts` refactored
to a transport-agnostic context** (`phaseKind`/`isViewerTurn`/`isReady`) so local AND online drive ONE
tested drag router / drop gate (placement.test.ts lockstep unchanged). Client: **`useLobby.sendAction`**;
a new **`OnlineHud`** (chooseFirst / mulligan-draw / place-ready panels, gated on `waitingOn === "you"`);
**`OnlineMatch`** now wires drags → `moveToAction` → `sendAction`, pass → `endTurn`, and the shared
placement predicate. engine UNCHANGED (0.40.0); 1719 → **1731** tests, `bun run check` green.
**Review (1 read-only adversarial reviewer): NO HIGH, NO MED** — the seat-binding blocks
acting-for-opponent (forge test), the three gates block unseated/not-in-game/no-record,
`applyAction`'s totality holds against hostile payloads, persist-before-broadcast + the DO input gate
prevent desync, the redacted phase leaks nothing (`owed` is the viewer's own), and the refactors are
logically identical. **TWO LOWs:** (L1, recorded) the DO `case "action"` boundary has no direct test
(only the pure `applyMatchAction` does — the DO-shell pattern; it mirrors the tested `intent` handler);
(L2, FIXED) the `SUPPORTED_MATCH_ACTIONS` allowlist. See D61. Below: the P4-1c header (kept for
continuity).

---
### Prior header (P4 increment 1c — the redactor + wire + read-only board, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #46 (**P4 increment 1c — the redactor + wire +
read-only board**). The match now CROSSES THE WIRE and RENDERS. New PURE
`redactGame(state, seat) → RedactedGame` (`packages/engine/src/redact.ts`) is the per-viewer
hidden-information filter the lobby DO runs server-side, once per connected socket — **no full
`GameState` (opponent hand / deck order / face-down prizes / face-down setup placements) ever
leaves the DO**. `RedactedGame` is a `@luminous/schema` wire type (`match/redacted.ts`, Zod
source-of-truth, VIEWER-RELATIVE you/opponent — a payload can't hold both sides' hidden zones):
opponent hand a COUNT of positional-id backs (id `opponent-hand-N`, `cardId:"hidden"` — never the
engine uid), prizes + decks counts, discards + Stadium public, in-play redacted to anonymous backs
during setup (**no `battle` row → no printed-HP leak**), the mid-effect prompt STRIPPED. The engine
restates the web app's playmat redaction against this neutral shape (no image URLs — the client
builds them from `cardId`; no engine imports on the far side); its subtle `phaseViewOf` phase
derivation (turn owner / who-must-act / parked interrupt / outcome) was MOVED out of the web
projection into the engine (`phaseView.ts`) so the projection AND the redactor share ONE source
(verified byte-identical; whole local suite green). The DO broadcasts each socket its own view on
the in-game FLIP (`broadcastMatch`, a per-viewer fan-out gated on the countdown→in-game transition)
and on RECONNECT (`sendMatchIfInGame` in the hello branches), keyed by the pure `matchSeatOf`
(host→p1, guest→p2). `{kind:"match", game}` joins `LobbyServerMessage` (Zod + exactness proof).
Client: `useLobby` gains a `match` state (CLEARED when the lobby leaves in-game so a rematch starts
clean); a new `OnlineMatch` feeds the SAME `PlaymatView` a `projectionFromRedacted(game)` in place
of `MatchPlaceholder` — READ-ONLY (no-op drag/pass, deny-all placement) until increment 2 drives
turns. **The wire round-trip is PINNED to reconstruct EXACTLY the local `projectGameState` board**
(`projectionFromRedacted(redactGame(state, seat))` `toEqual` `projectGameState(state, seat)`) — the
guard against the two redactors drifting. engineVersion 0.39.0 → **0.40.0**; 1702 → **1719** tests,
`bun run check` green (tsc + biome + vitest). **Review (1 read-only adversarial reviewer): NO HIGH
— the reviewer could construct no input that leaks opponent-private data or crashes the redactor;**
`phaseViewOf` byte-identical, the DO fan-out targets the correct seat per socket (unseated sockets
skipped), the flip-gate fires exactly once, reconnect preserves the record, `redactedGameSchema`
matches the engine output field-for-field. **THREE LOWs RECORDED, not fixed:** (L1) the client
channel does no Zod on inbound frames — a malformed `match` frame would throw at render; NOT
opponent-exploitable (only the trusted DO sends server frames, always schema-valid) and consistent
with the untouched `state`/`reject` trust model; (L2) seat identity is bearer-only — the
PRE-EXISTING lobby auth model, unchanged by this diff; (L3) the setup-phase turn glow lights "you" —
cosmetic. See D60. Below: the P4-1b header (kept for continuity).

---
### Prior header (P4 increment 1b — the DO seam, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #45 (**P4 increment 1b — the DO seam**). The
lobby → engine handoff now RUNS server-side. When a lobby's countdown flips it to in-game,
`LobbyDO.alarm()` mints the authoritative engine game ONCE — a new `handoffToMatch()` loads the
D1 card pool (`loadCardPool` — chunked `db.batch(inArray)` → `mapCardRow`, mirroring
`guardUnknownCards`; the pure fold `poolFromRows` is unit-tested), mints an RNG seed
(`crypto.getRandomValues`), calls `startMatch`, and persists a `MatchRecord {seed, state}` under
storage key `"match"` — BEFORE the in-game snapshot broadcasts (crash-safe: a mid-flip crash
re-runs the handoff; idempotent via a `MATCH_KEY`-exists guard). The `LobbyDO` constructor gained
`env` (D1 access — wrangler already passes it). Fixed placeholder decks live in the pure
`match.ts`: `FIXED_MATCH_DECKS` (host = Sneasel `sv06.5-013` + Water Energy, guest = Mareep
`sv01-066` + Lightning Energy; 60 each, distinct per seat so 1c's redaction asymmetry is real) +
`FIXED_MATCH_CARD_IDS` (the 4 distinct ids the DO resolves from D1). Nothing crossed the wire yet
— the client still rendered `MatchPlaceholder` until 1c. engine UNCHANGED (0.39.0); 1696 →
**1702** tests, `bun run check` green (tsc + biome + vitest). **Review (1 read-only adversarial
reviewer): ONE HIGH FOUND AND FIXED** — `MATCH_KEY` outlived the match it described, so a rematch
in the SAME lobby would reuse the previous pairing's `GameState`/seed: a guest's `bye` or a host
kick resets the phase via `removeGuest` (in-game → waiting) but left the record, and the
idempotency guard then refused to mint a fresh game. Fixed by making `commit` drop `MATCH_KEY` on
the pure `abandonsMatch(prev, next)` transition — ANY commit that takes the lobby out of in-game
(the only such path is `removeGuest`), pinned in `logic.test.ts` via the real `removeGuest`.
**TWO LOWs RECORDED, not fixed** (in `workstreams/online.md` + the resume point): the
load-failure in-game wedge (an incomplete D1 pool flips the lobby to in-game with no game;
self-heals on rematch), and the vacuous deck test (pins size + coverage, not real-catalog id
existence).

---
### Prior header (P3-M5 the ANY-target snipe family with conditional W/R — D59, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #44 (**P3-M5: the ANY-target snipe family,
with conditional Weakness/Resistance (D59)**). Resume point's #2. **"This attack does N
damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched
Pokémon.)"** — the WHOLE attack (no `damage` field), a chosen hit on the **Active OR a
Bench** — now SIMULATES. `damageChosen` gained a **`target: "opponentAny"`** mode
(candidates = the opponent's Active + Bench, via new `oppAnyRefs`), and `placeSnipe` an
**Active arm (`snipeActive`)**: a snipe that lands on the ACTIVE runs the §8.5 W/R pipeline
(base → ×Weakness → −Resistance → −reduction), where a Benched target stays FLAT — the
rules' "W/R apply ONLY to the Active" made **conditional on the pick**. Lands **Fezandipiti
ex** sv06.5-038 "Cruel Arrow" (100), **Rotom** sv01-069 "Linear Attack" (20), Paldean Tauros
"Aqua Dive" (60), Bellibolt ex / Kilowattrel (50). Umbreon "Feint Attack" (a different
W/R-immunity wording), Pawmot ex (a discard cost), and Magikarp (a coin flip) stay LOUD. The
Bench arm of `placeSnipe` is UNCHANGED (still flat) — the existing put-counter snipe
(Hawlucha / Meowscarada) and the benched-`deals` families (Wo-Chien, riders) are unaffected
(42 prior snipe tests green). New `ANY_SNIPE_DECK` (BOTH setup Actives pinned to a
`fix-lightning-weak` body, so the Defender is a deterministic ×2-Lightning W/R target); no
web change (`snipeActive` emits the same `DAMAGE_DEALT` shape). engineVersion 0.38.0 →
**0.39.0**; 1683 → **1693** tests, `bun run check` green. **Review (1 read-only adversarial
reviewer): NO HIGH, and NO regression to the shared snipe machinery** (the `placeSnipe` `next`
threading is byte-identical for every opponentBench consumer; `validateChoice` still rejects an
Active pick for a Bench-only prompt). **ONE MED FOUND AND FIXED:** `snipeActive` dropped the
attacker's pre-W/R continuous bonus (Vitality Band's +10, which DOES apply to an Active hit —
my "consistent with the Bench arm" comment was a false equivalence), so Fezandipiti + Vitality
Band would have under-dealt — added `damageBonusBeforeWR` into the pre-W/R term + the `bonus`
event field, pinned by a new test ((20 + 10) × 2 = 60, the bonus inside the weakness multiply).
Narrowness proven (matches ONLY Rotom/Bellibolt ex/Kilowattrel/Paldean Tauros/Fezandipiti;
refuses the discard/flip/different-tail three); the discriminating W/R pair is pinned (the SAME
`fix-lightning-weak` body: 40 as the ACTIVE, 20 Benched). **Recorded (reviewer LOW):**
`snipeActive`'s Resistance/reduction/floor + the Active-KO flow are not INDEPENDENTLY pinned —
a verbatim copy of attack.ts's tested pipeline + the tested benched reduction, analysis-only.
See D59.

---
### Prior header (P3-M5 the flat benched-snipe RIDER family, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #43 (**P3-M5: the flat benched-snipe
RIDER family (D58)**). Resume point's #3, the high-yield cheap step surfaced by D57's
catalog scan. **"This attack ALSO does N damage to 1 of your opponent's Benched
Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"** now SIMULATES —
a SECONDARY snipe after the main damage (which rides the attack's own `damage` field).
It is the SAME count-1 `deals` `damageChosen` op as D57's Covetous Ivy but WITHOUT
`perTakenPrize` (a FIXED N, not Prize-scaled), so it is **ZERO new op/interpreter code
— one regex `ALSO_BENCHED_SNIPE` + one derive case** in effects.ts. Lands ~15 prints
across **Miraidon / Tadbulb / Pawmot / Bellibolt / Decidueye ex / Jumpluff / Orthworm /
Palafin / Pyroar / Dartrix** — a big batch for a tiny diff, exactly why the op was built
to generalize (D57's resume note). Flamigo's "If Flamigo is on your Bench, …" (a
board-condition gate), the "each of" also-SPREAD, "2 of" (count ≠ 1), and "1 of YOUR
Benched" (self-target) each stay LOUD, a different shape. New `ALSO_SNIPE_DECK` (BOTH
setup Actives pinned to fix-bigbody so the Defender survives the main hit with an empty
Bench); no web change. engineVersion 0.37.0 → **0.38.0**; 1673 → **1683** tests, `bun run
check` green. **Review (1 read-only adversarial reviewer, mutation-driven): NO real defects
— every load-bearing field pinned** (`count:1` mutation fails 3 tests; a `perTakenPrize:true`
injection fails 6; the captured amount, `deals`, and main+rider coexistence all pinned).
Narrowness proven EXHAUSTIVELY (of every catalog "also does … damage to" attack, the regex
matches ONLY the 10 intended cards; refuses Flamigo, each-of, 2-of, YOUR-Benched, and
self-damage). ONE comment nit fixed — "also" is not the load-bearing separator from Covetous
Ivy (the whole-sentence anchor is; Covetous Ivy's clause continues past "Pokémon"). See D58.

---
### Prior header (P3-M5 the "×" family's benched-target sibling — Wo-Chien "Covetous Ivy", kept for continuity)
**Last updated (was):** 2026-07-23 — build session #42 (**P3-M5: the "×" family's
benched-TARGET sibling — Wo-Chien ex "Covetous Ivy" (D57)**). Resume point's #1, the
last "for each Prize card your opponent has taken" card. **"This attack does 60 damage
to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken."**
now SIMULATES: its target is one CHOSEN Benched Pokémon (not the Defender), so it is
NOT the pre-W/R fold (D56) but a **`damageChosen`** op — the put-counter snipe
(Hawlucha / Meowscarada) extended with **`deals`** (ATTACK DAMAGE — a `DAMAGE_DEALT`
with the benched reduction passive, like `spreadDamage`, not a flat `COUNTERS_PLACED`
counter) and **`perTakenPrize`** (the amount is `60 × the opponent's TAKEN Prizes`, read
from state in the interpreter via a new `snipeAmount`; 0 taken → no damage AND no pick).
A new anchored derive **`BENCHED_SNIPE_TAKEN_PRIZES`** (the "1 of" vs `SPREAD_EACH_BENCH`'s
"each of" is the whole distinction); the "6 − remaining" Prize formula is now the shared
**`takenPrizes`** helper (types.ts), used by BOTH this and the D55/D56 fold. Lands
**Wo-Chien ex** sv02-027 (Basic, 230 HP); **Chien-Pao ex** "Hail Blade" (a DISCARDED-Energy
count AND a pre-damage park) stays loud, the remaining "×" sibling. New `COVETOUS_IVY_DECK`;
no web change (`DAMAGE_DEALT` on a benched uid renders generically, as `spreadDamage`'s
already does). engineVersion 0.36.0 → **0.37.0**; 1661 → **1673** tests, `bun run check`
green. **Review (1 read-only adversarial reviewer): NO HIGH.** Recompute-at-resolve safety
(no prize moves between park and pick), the 0-guard, the `deals`/`spreadDamage` parity, the
benched-KO-through-`finishAttack` turn-END (not the Ability snipe's resume), regex
narrowness (matches ONLY Wo-Chien of ~20 "to 1 … Benched" catalog attacks — the "also does
N" riders all stay loud), and the `takenPrizes` refactor's value-identity all CONFIRMED.
**ONE MED false-coverage FOUND AND FIXED, plus 2 LOWs:** the "reduction passive" test
benched a passive-LESS body (fix-bigbody), so `dealt = amount − reduction` and the
`reduction` field were unpinned (`dealt = amount` / `reduction: undefined` survived) — closed
by benching real **Bouffalant sv03-174 "Bouffer"** (−20), asserting `{base:60, reduction:20,
dealt:40}`; the purity test moved to the state-rewriting AUTO-TAKE path (was a park, which
never reaches `placeSnipe`); the non-discriminating `weakness:null` is structural (the `deals`
branch hard-codes null — no realistic mutation), left as the honest shape. See D57.

---
### Prior header (P3-M5 the "×"/multiply damage family — Pecharunt ex / Annihilape, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #41 (**P3-M5: the "×"/multiply damage
family — Pecharunt ex / Annihilape (D56)**). Resume point's #1: the sibling of
D54–D55's additive "+" family. **"This attack does N damage for each Prize card your
opponent has taken."** (NO "more") now SIMULATES — the printed "N×" is the PER-unit,
so `per × count` is the WHOLE damage with the printed base **DROPPED** (count 0 → 0
damage), a DISTINCT fold from the additive "+" (which adds `per × count` onto a
printed base). It reuses D55's **`opponentPrizesTaken` count evaluator UNCHANGED** via
a new reader **`deriveAttackDamageMultiplier`** (effects.ts) + regex
**`OPPONENT_PRIZES_MULTIPLY`** (no "more"); attack.ts reads BOTH scaling derivers
(mutually exclusive on the word "more" — multiply only when additive is null), and
**`scaledBase = damageMultiplier !== null ? 0 : base`** drops the base for a multiply
while the additive family keeps it. Lands **Pecharunt ex** sv06.5-039 "Irritated
Outburst" (60×) and **Annihilape** sv01-109 "Rage Fist" (70×) — two pers on one count
source. The bigger "×" siblings stay LOUD: **Wo-Chien ex** sv02-027 (a benched-target
multiply, no `damage` field) and **Chien-Pao ex** (a DISCARDED-Energy count) — the
multiply reader's anchor-guard witnesses (Entei stays the additive one). New
`MULTIPLY_DAMAGE_DECK` (Darkness/Fighting Energy pay {D}{D} / {F}, Fire cannot). **No
web change** — `DAMAGE_DEALT.base:0, scaled:N` renders through the generic `· scaled
+N` breadcrumb. engineVersion 0.35.0 → **0.36.0**; 1653 → **1661** tests, `bun run
check` green. **Review (1 read-only adversarial reviewer): NO HIGH, NO MED, no
surviving mutants.** Catalog narrowness proven EXHAUSTIVELY — of the 4 cards printing
"for each Prize card your opponent has taken", the multiply regex matches ONLY
Pecharunt/Annihilape, refuses Wo-Chien (benched) and Charizard (additive "more").
Base-drop pinned two ways (a count-0 "no DAMAGE_DEALT" test + a count-2 "120 not 180"
test); captured-per pinned by Annihilape's 70 ≠ Pecharunt's 60. **ONE LOW FOUND AND
FIXED:** the Pecharunt fixture's "verbatim" comment omitted its "Subjugating Chains"
Ability — corrected to an honest "printed stats + attack row verbatim; Ability OMITTED
(unexercised, no registry row)", the false-verbatim defect this repo names explicitly.
**Recorded, NOT fixed:** the multiply W/R ordering is not INDEPENDENTLY pinned by a
weak-defender test (every multiply test uses fix-bigbody, no weakness) — but it is the
SAME shared pipeline line as the additive family, already pinned by "folds BEFORE
weakness" (scaled sits inside the weakness multiply), and with `scaledBase` forced to 0
the multiply arm only supplies `scaled`, so it cannot break the order alone (reviewer
LOW — the same call D55 made for its Prize arm). See D56.

---
### Prior header (P3-M5 the count union's SECOND member — opponentPrizesTaken, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #40 (**P3-M5: the count union's
SECOND member — Charizard ex "Burning Darkness" (`opponentPrizesTaken`, D55)**).
Resume point's #1, the cheapest continuation of D54: the additive "+" family's
`DamageCountSource` union gains its second member. **Charizard ex** sv03-125
"Burning Darkness" (180+, "This attack does 30 more damage for each Prize card your
opponent has taken.", verbatim vs the local D1 catalog — all 4 prints identical)
now SIMULATES, folding `30 × (PRIZE_COUNT − state.players[defenderSeat].prizes.length)`
(= the opponent's TAKEN Prizes) into the printed base at the same pre-§8.5 step as
Vitality Band and the self-counter scaler. One new anchored regex
**`OPPONENT_PRIZES_SCALE`** beside `SELF_COUNTER_SCALE`, one new evaluator arm, and
**`scaledAttackDamage`'s signature WIDENED** `(attacker, bonus)` →
`(attacker, bonus, state, defenderSeat)` to reach the opponent's board (D54 recorded
this as owed). **The word "more" is load-bearing:** it separates this ADDITIVE "+"
family from the **"×"/multiply Prize family** ("does N damage for each Prize card
your opponent has taken." — Pecharunt ex, Annihilape, Wo-Chien ex — no "more"),
which folds nothing and STAYS loud (a future reader, a DIFFERENT shape — not a
`count` member). Taken = **6 − remaining** (each player draws from their OWN Prizes
on a KO, §8.1), read at DECLARATION before this attack's own KO awards a Prize
(§8.5 — the "+X before Weakness" base modifier). **Simulating Charizard RETIRED it
as D54's anchor-guard witness**, so the two unsimulated-"+" witnesses (checkup /
logFromEvents) and the scaledDamage discrimination test **MIGRATED to a real
replacement — Entei sv03-030 "Blaze Ball"** (60+, "…for each {R} Energy attached to
this Pokémon.", an attached-Energy count source no reader simulates). `SCALED_DAMAGE_DECK`
gained 4 Entei with `fix-fire-energy` trimmed 20→16 to hold exactly 60. **No web
change** — `DAMAGE_DEALT.scaled` + the `· scaled +N` breadcrumb render generically
over both count sources. engineVersion 0.34.0 → **0.35.0**; 1647 → **1653** tests,
`bun run check` + `vite build` green. **Review (1 read-only adversarial reviewer +
an in-tree mutation self-audit, 6 mutations): NO HIGH.** Rules correctness (opponent
= defender, 6−remaining, declaration timing), regex narrowness (grepped over every
catalog "has taken" / "more damage for each" attack — matches ONLY the 4 identical
Charizard prints, refuses all "×" and self-scalers), deck integrity (=60), the Entei
fixture (verbatim), and the two-case switch exhaustiveness all CONFIRMED correct; the
`6−remaining`, the opponent-seat read, both new-regex anchors, and the "more" keyword
each individually die. **ONE MED false-coverage FOUND AND FIXED, mutation-proven:**
every apply-level Prize test used Charizard's `per: 30`, so a `* bonus.per → * 30`
literal (the value a careless author would most plausibly hard-code — my "captured
per" test ruled out only `* 10`) survived the WHOLE suite. Closed with a synthetic
**per-50 probe** ("Bounty", fix-attacker index 5, base 40 → `{base:40, scaled:100,
dealt:140}` at 2 Prizes taken — the Prize-source twin of D54's "Fury"); the `* 30`
mutant re-run and confirmed dead, and `attack.test.ts`'s out-of-range-index witness
bumped 5→6. The "×"/multiply family (resume #2) is now the named next step, its
refusal already witnessed. See D55.

---
### Prior header (P3-M5 count-scaled attack damage — the additive "+" family, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #39 (**P3-M5: count-scaled attack
damage — the additive "+" family lands (D54)**). The resume point's #3, and the
first reader to turn the DEAD `ATTACK_EFFECT_SKIPPED` damage-modifier path into a
SIMULATED one (`cards.ts` `parseAttackDamage` split `{base, modifier}`; nothing
consumed the modifier until now). **The printed "This attack does N more damage
for each damage counter on this Pokémon."** now folds `per × floor(attacker.damage
/10)` into the printed base BEFORE the §8.5 W/R pipeline. New reader
**`deriveAttackDamageBonus`** (effects.ts, beside `deriveAttackEffect` but
**DISJOINT** from it: this is PRE-damage math the caller computes, NOT an
`EffectOp` the interpreter runs after damage — so a card carries at most one, the
whole-sentence anchor guaranteeing a scaling sentence never also derives an op).
attack.ts computes `base + scaled + bonus` (the scaling at the same pre-W/R step
as Vitality Band) and carries the added HP on the new **`DAMAGE_DEALT.scaled`**
field (present only when >0, the `bonus`/`reduction` pattern); the web log gains a
**`· scaled +N`** breadcrumb reading ahead of `· boosted +N`. Lands **Paldean
Tauros** sv02-028 "Raging Horns" (20+, verbatim vs the real card) and simulates
**`fix-attacker` "Rage"** (10+, the default test attacker — identical text). The
skip condition rebuilt around **`effectSimulated`/`modifierSimulated`** so the
"+"/text is flagged loudly ONLY when genuinely unsimulated; for any non-scaling
card (`damageBonus === null`) it reduces ALGEBRAICALLY to the old condition
(reviewer-verified). **Charizard ex** sv03-125 "Burning Darkness" (180+, "…for each
Prize card your opponent has taken" — a DIFFERENT count source) is DELIBERATELY
left on the skipped path, the **anchor-guard witness** proving the deriver is
narrow; the two "+"-skip witnesses (checkup / logFromEvents) migrated from Rage to
it, and `count` is a union so the Prize-card reader lands as a MEMBER later.
engineVersion 0.33.0 → **0.34.0**; 1636 → **1647** tests, `bun run check` +
`vite build` green. **Review (2 adversarial agents in ISOLATED worktrees, 17
engine mutations): NO HIGH** — the anchor-killers, the pre-W/R fold ordering (a
40-vs-30 test), the "right Pokémon at declaration" read, and the `scaled`-honesty
all genuinely die. **THREE false-coverage MED/LOWs found AND FIXED, each mutation
re-run to confirm the kill:** the fold's `per` operand was untested (`* bonus.per
→ * 10` survived the whole suite — every folded fixture prints per=10) AND the
widened `base + scaled > 0` guard was untested (latent — no base-0 scaler); BOTH
closed by ONE synthetic **base-0, per-20** scaler ("Fury", fix-attacker index 4)
whose fold test asserts `{base:0, scaled:60, dealt:60}` (the `* 10` mutant gives
30, the `base > 0` revert emits no DAMAGE_DEALT); and the `· scaled +N` log
breadcrumb was unpinned (deleting it survived) — closed with a rendered-string
assertion, the `· boosted +N` sibling's technique. A stale "stays on the
ATTACK_EFFECT_SKIPPED path" comment on the Raging Horns fixture was corrected.
The slice's originally-flagged #1 (Sandaconda "rider clause") was **FALSIFIED**
during exploration: its real text ("your opponent shuffles their Active Pokémon
and all attached cards into their deck") needs a brand-new shuffle-into-deck op
plus a persistent-marker subsystem (`markers[]` is a never-read stub), NOT the
`recordAs` the resume note assumed. See D54.

---
### Prior header (P3-M5 damageSelf + the two-seat attack epilogue, kept for continuity)
**Last updated (was):** 2026-07-23 — build session #38 (**P3-M5: `damageSelf` + the
two-seat attack epilogue — the D42 debt paid**). The resume point's #3, flagged
since D42 as "the cheapest thing standing between the engine and a real bug
rather than a latent one" and owed BEFORE any self-damaging attack text.
**Skeledirge** sv01-038 "Blazing Shout" (190 to the defender, then "This Pokémon
also does 30 damage to itself.", verbatim vs D1) is the engine's **FIRST attack
that damages its OWN board**, and its first reader. Two parts. **(1) `damageSelf`**
— a flat self-damage op on the attacker's own Active, emitted as `COUNTERS_PLACED
source "self"` (the confusion self-hit's model, OUTSIDE the §8.5 W/R pipeline: no
Weakness to your own attack, and no reduction — Bouffer reduces the *opponent's*
attack, not your recoil). Consistent with the sibling `damageActive`; never KOs.
**(2) finishAttack's KO sweep widened from the single defender seat to BOTH**, in
`[defender, attacker]` order so §8.1's "the player whose turn it is takes their
Prizes first" holds — the attacker's prize (for the defender KO) queues ahead of
the defender's (for the self-KO), and a **self-KO prizes to the DEFENDER**.
`collectKnockOuts` already carried the machinery (prizes-first grouping, on-KO
triggers, promotions, the §14 double-KO **tie** guard), so the widening is one
argument and the now-dead `koedSeat` on the `attackEpilogue` stage is **dropped**.
This makes the **§14 double-KO TIE reachable from the attack path for the first
time**, and the **§14.2 "self-KO your last Pokémon → you lose (`noPokemon`)"**
loss reachable via an attack — both now tested. Skeledirge's other attack
(Passionate Singing's discard-pile attach) has no rule and stays on the loud
`ATTACK_EFFECT_SKIPPED` path. Web: a new `COUNTERS_PLACED "self"` log row in the
attacker's voice ("Skeledirge did 30 damage to itself"); no projection change
(board damage updates itself). engineVersion 0.32.0 → **0.33.0**; 1627 → **1636**
tests, `bun run check` + `vite build` green. **Review (2 adversarial agents,
mutation-proven): ONE HIGH engine-side, and it is the recurring FALSE-COVERAGE
pattern** — the deriver's `^`-anchor "load-bearing, both of them" test used a
lowercase-"this" leading negative the case-sensitive regex refuses *regardless*
of the anchor, so dropping `^` left all 738 tests green (agent ran the mutation).
Closed with a capital-"This" leading killer; **both anchor drops now fail the
test, each mutation run to confirm.** The MED — the newly-reachable §14.2 self-KO
loss — was pinned proactively (added before the review returned). **The web
reviewer found NO HIGH/MED**: the Skeledirge fixture is verbatim vs D1 (the ×
hexdump-checked), and the "self" row is asserted on text AND `who`. Two LOWs
declared: `damageSelf` reads `ctx.seat`'s Active rather than threading `sourceUid`
(matches `damageActive`; no derivable attack relocates the source before a lone
recoil op), and the `amount <= 0` guard is defensive/untested (mirrors
`damageActive`). See D53.

---
### Prior header (P3-M5 the reveal-and-bottom family, kept for continuity)
**Last updated (was):** 2026-07-22 — build session #37 (**P3-M5: the reveal-and-bottom
family, and the engine's first NON-CONTROLLER decision**). The resume point's
#1, and the first slice in a while that needed a MECHANISM rather than a field.
**Ortega ×2** (sv03-190/-219, Supporter — identical text on both prints,
verified verbatim vs D1): "Your opponent reveals their hand, and you choose a
card you find there and put it on the bottom of their deck. If you put a card
on the bottom of your opponent's deck in this way, your opponent may draw a
card." It is **Miriam's shape with both halves across the table** — a recording
op plus a plain `recordGate` — and each half needed something new. **(1)
`bottomFromOpponentHand`.** The reveal is TOTAL and PUBLIC (new `HAND_REVEALED`
naming every uid: the one hand event in the file that is not count-only,
because a reveal is exactly when those cards stop being hidden), emitted as the
op's first act on the parking AND the auto-resolving path. The bottomed card is
**NAMED** (`CARD_TO_BOTTOM_OF_DECK`, carrying an `actor`) where Dendra's
identical destination stays count-shaped — the event follows the move's
VISIBILITY, and this one happened face up at both ends. The offer **collapses
per interchangeable class**, which is sound here precisely where it is not in
`payFromHand`: that offer names cards in a zone that stays hidden, so its
collapse leaks the hand's duplicate structure; this hand was just shown in
full. **(2) `opponentMayDraw` — the first decision this engine has ever handed
to the seat that did not make the play.** The park carries a `decider`, the
phase files an **`answerer` beside its controller `seat`** (absent when they
agree, so every pre-D52 park serializes byte-identically), and `resolveEffect`
admits only that seat. The turn does not move while they answer: `activeSeat`
keeps reading `phase.seat`, `waitingSeat` follows the answerer. Rules doc
**§9.4**. **Greavard "Underworld Stroll"** (sv01-105) is the attack twin,
**DERIVED** from text rather than authored, because `CardProgram.attack` is
per-CARD and its second attack must stay plain. `programPlayable` gained the
empty-opponent-hand gate (a PUBLIC count — the Catcher/Hammer class; it reads
hand LENGTH and never the filter) and is now **EXPORTED**, so the HUD greys a
dead row with the predicate that rejects it. Web: a new `MayDrawDialog` (the
first prompt shown to the non-controller mid-play), two log rows, no new
projection field. engineVersion 0.31.0 → **0.32.0**; 1576 → **1627** tests,
`bun run check` + `vite build` green. **Review (2 adversarial agents in
ISOLATED worktrees, 87 + 44 mutations): ONE HIGH EACH, and both were FALSE
CLAIMS over untested guards — four slices running now.** Engine-side: the new
deriver rule's test claimed to pin the ANCHORS and both its negatives were
refused by the pattern BODY, so dropping `^`/`$` passed all 722 tests where the
same mutation on two sibling rules dies at once. Web-side: `promptKey`'s
`mayDraw` arm **could not be observed at all** — the dialog is stateless, so
gutting the arm to a constant passed every test; it is deleted, with the
reasoning kept. Three web MEDIUMs changed CODE: the dialog **never named the
deciding player** (and the handoff banner that normally does sits outside the
modal, hence inert — a hot-seat device said "You may draw a card" to whoever
held it); **Escape-swallowing was untested and breaking it soft-locks the
game**; and `pendingDecision` went to both viewers, now withheld from a
non-answerer — deliberately NARROWLY, since reversing D17's contract for every
park is a named P4 job. One finding was a **pre-existing engine contradiction
this slice made user-visible**: the `discardEnergy` arm's comment claimed
Crushing Hammer stays playable while the `coinFlipGate` branch six lines above
descends into `then` for exactly that card (D41) — the descent wins, measured,
and the stale comment is corrected. See D52.

---
### Prior header (P3-M5 healChosen.upTo, kept for continuity)
**Last updated (was):** 2026-07-22 — build session #36 (**P3-M5: `healChosen.upTo`
— §9.1's `min: 0` end lands**). The resume point's #1 for three slices
running, and it is ONE field: the printed "up to N … each" heal. **Saguaro
×3** (sv02-187/-255/-270, Supporter — identical text on every print, verified
verbatim vs D1): "Choose up to 2 of your Pokémon and heal 50 damage from each
of them." The park is the **first `choosePokemonMulti` with `min ≠ max`** —
`{min: 0, max: min(2, in play), declinable: false}` (min: 0 IS the printed
decline, so the "you may" flag stays unset; §8.6 clamps the ask AND the
heading — a lone Active is asked "up to 1"), parked at every non-empty board
per the D47 declinable-snipe rule. **The field is `upTo`, not `count`**,
because `damageChosen.count` means EXACT — the name carries the printed
words, so "choose 1 is not up to 1" stays structural. Candidates are ALL your
Pokémon (no damaged restriction is printed; an undamaged pick heals 0 and
emits nothing), the play is UNGATED (the Potion / Fighting Au Lait shipped
doctrine — the recorded paper divergence vs TPCi's state-change rule, now
three cards wide), and the exact-1 single arm is byte-untouched. **Web: ZERO
source changes** — `ChoosePokemonMultiDialog` was written for this day
("Take none" at zero picks, a denominator-free "Confirm N" for partials), but
every `min ≠ max` branch was an untested DEAD PATH; two DOM tests now drive
the park end-to-end, the partial confirm pinning WHICH ref is dispatched.
engineVersion 0.30.0 → **0.31.0**; 1561 → **1576** tests, `bun run check` +
`vite build` green. **Review (2 adversarial agents in ISOLATED worktrees,
34 + 8 mutations): NO HIGH from either — and engine-side NO false coverage
claim at all, the first such slice in three** (32/34 mutants killed, 2 argued
equivalent: `healUpToNote`'s `"all"` arm is dead code with no printed author,
declared in its own doc; the own-seat guard sits behind pre-validated refs —
the runCheckupTriggers precedent). **The web MED is the recurring shape**:
`promptKey`'s `pokemonMulti` arm was entirely UNPINNED — gutting the key to
the bare string survived every test; LATENT (no live path parks this prompt
twice with no render between), but the key's own doc claims the
discrimination — closed with the attachCards belt technique over all four
segments, verified to kill both survivors. The web table also proved the two
new DOM tests are the SOLE killers of the "up to" surfaces. See D51.

---
### Prior header (P3-M5 EffectContext.sourceUid, kept for continuity)
**Last updated (was):** 2026-07-22 — build session #35 (**P3-M5:
`EffectContext.sourceUid` — the printed "this Pokémon"**). The resume point's #1
and the cheapest structural row on the board, and it is a FIELD, not an op: the
context now names the Pokémon whose effect is running — its top-card **uid**,
set at **every run site that knows it** (`useAbility`, both board-trigger
runners, the KO trigger — where it names a card that has LEFT play, honestly —
and the attacker, by uid rather than "the Active" so it stays truthful if the
program moves it) and **ABSENT for a Trainer program**, whose parked context
stays byte-identical `{seat}` (the §9.2 absent-when-empty promise, applied to a
second field). Constant for the run, rides `EffectContinuation` across parks
(JSON, D14). **First reader: `attachFromDeck.toSelf`**, the THIRD printed target
rule — "attach it to **this Pokémon**" — landing **Pawmot ×2** (sv01-076/-209,
"Electrogenesis"): a **benched Pawmot feeds ITSELF**, the exact sentence no
seat-relative target rule could say. Resolution is by **board TOP uid** — a
source evolved over or gone from play is no longer "this Pokémon", and the op
whiffs into its printed trailing shuffle. The fixture shipped verbatim with
ZERO deviations (independently re-verified against D1 — last slice's banner
lesson, taken). engineVersion 0.29.0 → **0.30.0**; 1526 → **1561** tests,
`bun run check` + `vite build` green. **Review (2 adversarial agents in
ISOLATED worktrees, 43 + 33 mutations): ONE HIGH engine-side, and it is the
recurring pattern — a false coverage CLAIM, not wrong behaviour.** The "board
TOP, not stack membership — deliberately" doc and the shipped evolved-over test
claimed the discrimination, but the stale-uid test sat the uid in the DECK, so
**three wrong implementations** (Active-by-stack-membership,
bench-by-stack-membership, bench-by-base-uid) **passed the entire suite** —
under any of them a source evolved over mid-continuation attaches to the
EVOLUTION. Closed by evolved-over tests on both arms. Its MED: every shipped
board benched Pawmot at slot 0 with one copy, so hard-coded-index-0 and
match-by-catalog-id (a two-Pawmot board resolves the WRONG Pawmot) both
survived — closed, and the two-Pawmot board also pins the per-uid once-per-turn
stamp. LOW worth keeping: `toSelf`'s "mutually exclusive with the other riders"
was a RULE THE CODE DOESN'T ENFORCE — the op doc now states the precedence
honestly (ignores `targetType`/`benchOnly`; `maxPerTarget` would still cap;
authoring it alone is the rule, the doc is the enforcement). 43 mutants: 41
killed (34 by the pre-existing suite, 7 only by its 11 new tests), 2 argued
equivalent — one of them `runCheckupTriggers`' threading, which nothing can
observe today. **Web: NO HIGH; its one behaviour change is a DESIGN fix** —
`AttachCardsDialog` violated the house "a list of one is not a decision" rule
(D44, `MoveEnergyDialog`'s): a sole-target offer (every `toSelf` park, and
Janine over a lone {D} Pokémon) demanded a tap on a target list of one. The
dialog now **COMMITS the attach on the card tap** when there is one target; the
target list never mounts. Its other two MEDs were both untested mirrors: the
`activeOnly` mirror in `usableAbilities` could be deleted with all 1545 tests
green (the exact lit-row-refused-click HIGH of two sessions ago, on a benched
Chien-Pao — pinned both directions), and `promptKey`'s attachCards
`targets`/`max` segments were comment-enforced only (pinned via the belt
technique). See D50.

---
### Prior header (P3-M5 attachFromDeck, kept for continuity)
**Last updated (was):** 2026-07-22 — build session #34 (**P3-M5: `attachFromDeck` — the
deck-SEARCH attach, and a §9.2 gate that asks WHERE**). The resume point named
Janine's Secret Art as one card wanting a per-target deck search; **the catalog
showed five cards printing that sentence**, differing only in the target rule and
a drawback — so the slice is the family's shape, not the card's. One new op:
search your own deck for Energy matching a filter and attach it straight onto your
own Pokémon. It is the deck-search **sibling of `attachFromTop`** and reuses that
op's `attachCards` MAP prompt, because the printed clause is the same one; every
difference falls out of the SOURCE. Two matter: the candidate set is the WHOLE
deck, so it is **COLLAPSED to `max` representatives per interchangeable class**
(D42's key — a Basic Energy keys on what it PROVIDES, since the catalog prints
Basic Darkness Energy under four ids), and there is **no leftovers clause** at all
(nothing ever left the deck), so the printed "Then, shuffle your deck" stays a
trailing `shuffleDeck`. **TWO PRINTED TARGET RULES, one new field:** "in any way
you like" (**Charizard ex ×4**, "Infernal Reign", an onEvolve trigger) is no rider;
"**for each of those Pokémon**" (**Janine's Secret Art ×2**, Supporter) is
`maxPerTarget: 1`. A card prints "in any way you like" exactly when the split is
free, so the absence of the phrase is **not silence but the other rule**. **Janine
parks ONCE, and that is a claim about the card** — her printed first sentence is
not a second decision, because same-type Basic Energy is fungible, so the map
prompt already says the whole thing. (Which is why this slice does NOT consume
§9.1's `min: 0` end after all; Saguaro still wants it.) **§9.2 gained
`recordGate.contains`**, a gate asking not "did the earlier op do anything" but
"did any of it reach the ACTIVE" — two Energy onto the Bench records two uids and
poisons nothing, which is the player's choice to make. engineVersion 0.28.0 →
**0.29.0**; 1446 → **1526** tests, `bun run check` + `vite build` green.
**Review (2 adversarial agents in ISOLATED worktrees, 69 + 46 mutations): one HIGH
each, and BOTH were false CLAIMS rather than wrong behaviour** — which is the
pattern worth carrying forward, because in both cases the claim had papered over
real missing coverage. The engine's HIGH I had already caught mid-session, but the
review found **four** divergences where I found one: `moveEnergy`'s `benchToActive`
route produces a false POSITIVE (attach to the Bench, move it up, get poisoned for
an attach that never touched the Active), which the detach-only framing misses
entirely. Its three MEDIUMs were all real — the prompt's **`max` lied** whenever
`maxPerTarget × targets` was the true ceiling (Janine printed "up to 2" over a
board where 1 was the maximum — the exact dishonesty `attachFromTop`'s clamp
exists to prevent, and the review wrongly read it as deliberate); the **whiff filed
nothing** where its two sibling recording ops file `[]`; and the Charizard fixture
sat under a "verified verbatim" banner with three undeclared deviations, the sharp
one being that **Charizard ex is a {D} Pokémon** that merely attacks with {R}.
15 of 69 mutants survived the suite as first written; the review's 33 new tests
kill 11, three of them serious (a mutant that **duplicates a card**, one that
**throws out of `applyAction`** — a D14 breach — and one filing *picked* rather
than *attached* uids). **The web's two HIGHs were both in the new test file's own
header**: `maxPerTarget` rides `promptKey` was listed as a case "below" and had
none (deleting it from the key left all 1524 tests green, and the failure mode is
a dispatch the engine rejects with a pill that cannot say which pairing was
wrong); and the log test's `texts()` helper **discarded the seat entirely**, under
a test named "names BOTH attaches" that only checked "some row mentions Energy" —
so the self-poison filed under the OPPONENT's seat survived it, and Janine is the
first `STATUS_APPLIED` in the game filed under the controller's own seat. See D49.

---
### Prior header (P3-M5 §9.2 the op→op record, kept for continuity)
**Last updated (was):** 2026-07-22 — build session #33 (**P3-M5: §9.2 — a clause that
reads what an earlier clause DID**). The resume point's #1, and the engine's first
**op→op data flow**. Every op until now was decidable from `GameState` plus the op;
some printed clauses are not, because they ask what *this card's own earlier
sentence* did — and a pile after an effect looks the same whether a card got there
by that effect or was already sitting there. An op now files the uids it ACTUALLY
moved under a named **`EffectSlot`**, and later ops read them: **two readers, one
record** (the D40 shape) — a new **`recordGate`**, the third and last gate, spliced
into the work queue like the other two; and **`discardPileRetrieval.exclude`**.
**Superior Energy Retrieval ×2** is what makes the exclusion load-bearing rather
than cosmetic: its cost pays INTO the very pile its next clause reads, so without
it a player discards 2 Basic Energy and takes the same two straight back — the cost
refunds itself. **Miriam ×3** is the gate ("if you shuffled any cards into your
deck **in this way**, draw 3"), and **Dendra** can finally state its own printed
"if you do" instead of resting on a gate in another file. Two structural calls,
both deviations from the plan: the record rides **`EffectContinuation`, not
`EffectContext`** (an accumulator, sibling to `rest`; the context is a constant read
by ~30 helpers that would hold it going stale), and it is keyed by **slot, not
position** — Janine's Secret Art prints a whole sentence between the action and the
clause about it, and Miriam's adjacent sentences stop being adjacent under the
natural decomposition of "shuffle N into your deck". Absent when empty, so every
pre-§9.2 program parks byte-identically. engineVersion 0.27.0 → **0.28.0**; 1395 →
**1446** tests, `bun run check` + `vite build` green. **Review (2 adversarial agents
in ISOLATED worktrees): NO HIGH engine-side** (49 mutations, 42 killed, 7 argued
equivalent; D14 replay verified through a JSON round-trip at every park, deep-freeze
purity, conservation over five degenerate zone states) — but its sharpest MEDIUM is
that **the slice's headline claim was never exercised**: `resumeProgram`'s
record-seeding could be deleted with all 12 original tests green, because neither
shipped card READS `cont.record` (both record and read inside one `runProgram`), so
the assertions pinned the STORAGE and not the CARRY. **ONE HIGH web-side, and it is
a design gap: the prompt described half the card.** Miriam's dialog said "Shuffle up
to 5 Pokémon…" over a button reading "Take none" and mentioned the 3 cards NOWHERE,
so declining silently forfeited the draw and the turn's only Supporter — the gate's
false arm emits no event either. Every prompt note before §9.2 was the whole printed
effect because an op WAS the whole effect; a recording op is the first that is not.
Fixed in the ENGINE: a parking op that records looks DOWN THE QUEUE for the gate
reading it and appends the printed conditional, so Dendra's cost prompt is now its
printed sentence verbatim — with a describer that stays **silent on anything it has
no phrase for**. Three more web MEDIUMs were **false claims in this slice's own
prose** (what Miriam prints; why the shuffle must precede the draw — runtime-
disproved; and a self-match tripwire whose stated reason this slice rotted by
putting a Supporter on the op), all corrected at the source. See D48.

---
### Prior header (P3-M5 the FLOOR + the deck-bottom payment, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #32 (**P3-M5: the printed number is a
FLOOR, and the hand cost that is NOT a discard**). The resume point's #1, and it
turned out to be one claim wearing two hats: **the printed number and the printed
verb are the ENGINE's to state, not the caller's to infer.** (1)
`choosePokemonMulti` gained **`min`/`max` + `declinable`**. "Put 3 damage counters
on **1** of your opponent's Benched Pokémon" is not "up to 1" — a card prints the
words "up to" when a partial answer is legal — so Meowscarada ex / Radiant
Blastoise could pay an **irreversible** hand cost and then place nothing. Rules
doc **§9.1**. `declinable` is a third field rather than `min: 0` because
Hawlucha's "**you may** choose 2" is **all-or-nothing** (2 or none, never 1 of 2),
and that decline has nowhere else to live: the framework auto-fires optional
triggers, so the pick it governs is the only place a player can say no — which is
why the review's one behavioural reversal was to **park a declinable snipe at
every non-empty Bench** (the draft honoured "you may" only with 3+ Benched
Pokémon, exactly where declining matters least). (2) `discardFromHandCost` became
**`payFromHand`** with a required `to`, and `to: "deckBottom"` lands **Dendra ×3**:
"Put a card from your hand on the bottom of your deck. **If you do**, draw cards
until you have 5." Nothing is discarded and the word "cost" never appears, yet all
three clauses of D46's mechanism are printed on it — a mandatory exact pick, a
benefit conditional on it, and the same play gate written as its contrapositive,
"**other**" included. One field wider, not a second op. `HAND_COST_PAID` carries
`to` and the prompt carries `dest: "deckBottom"`, because **the event follows the
destination's visibility**: a discard becomes public where it lands, a card under
the deck goes hidden → hidden and is never seen again. **Skwovet ×2** ("Nest
Stash") reaches the same destination with the WHOLE hand and needed **no new op at
all** — `handRefresh` with Iono's `toBottom` + `onlyIfAnyMoved`, the first
`handRefresh` on the Ability path. engineVersion 0.26.0 → **0.27.0**; 1363 →
**1395** tests, `bun run check` + `vite build` green. **Review (2 adversarial
agents in ISOLATED worktrees, 86 + 67 mutations): no HIGH engine-side; ONE HIGH
web-side — `usableAbilities` never mirrored the §7.5 gate**, so Meowscarada ex
with no Basic {G} in hand rendered lit and was refused on click with no reason
anywhere; recorded as "deliberate per D29" one slice ago, indefensible now that
the Trainer row and the Ability row share one helper. Eight test holes closed,
each proved by a surviving mutation — most tellingly the **reprint rows** (deleting
3 of the slice's 5 catalog ids left the suite green) and a **padded multi-choice**
(two refs pass the new floor, one is not a candidate — the shape that defeats
all-or-nothing). See D47.

---
### Prior header (P3-M5 discardFromHandCost, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #31 (**P3-M5: `discardFromHandCost` —
the printed COST that parks, and the field it absorbed**). The resume point's #1,
and it was less a new op than a **promotion**: the engine already had this cost as
`AbilityProgram.cost`, a field paid before the program ran, which could only ever
express the case where the answer did not matter (Meowscarada's Basic {G} Energy —
copies are interchangeable, so "the first match" sufficed). Tinkaton's bare "a
card" is the general one, and it PARKS. So the field, its finder and
`ABILITY_COST_PAID` are **gone**, Meowscarada migrated, and the backlog row went
from 4 cards to **9 catalog rows**. Two printed wordings, one mechanism, and the
wording tracks **where the paying card sits**: Trainers say "2 **other** cards"
(Ultra Ball, Earthen Vessel) because the card is in the hand it pays from;
Abilities never say it (Tinkaton, Revavroom, Meowscarada, Radiant Blastoise)
because the card is on the board — exact across the catalog, which is why "other"
is not a field but the played uid excluded in the GATE. **Order is observable:**
Revavroom pays 1 from a hand of 5, THEN draws to 6 — two cards, not one.
`chooseCards` grew a required **`min`** (0 at every printed "up to", `count` here
— the only mandatory card park there has ever been). **The gate VETOES, the
opposite call from D45 one slice earlier**, and the printed text is what decides:
there a per-op veto would have killed a card whose other clause always resolves;
here "You can use this card ONLY IF" states a precondition for the whole play.
Rules doc **§7.5**; engineVersion 0.25.0 → **0.26.0**; 1331 → **1363** tests,
`bun run check` + `vite build` green. **Review (2 adversarial agents, 39 + 28
mutations): no HIGH from engine+rules; ONE HIGH from web+integration — the HUD
never mirrored the new gate**, so Ultra Ball on a hand of `[itself, one other
card]` (the ordinary late-game state, and the moment it is most often dead)
rendered enabled and rejected on click — against the doctrine the same file states
and the suite already pins for the identical error code. Two findings changed the
story rather than just fixing it: the `searchNote` plural bug was **LIVE on a
shipped card** (Chien-Pao ex, four prints, has read "up to 2 **a Basic Water
Energy**" since it was authored), and the Radiant Blastoise filter is now recorded
as a **documented deviation** rather than a settled ruling. See D46.

---
### Prior header (P3-M5 attachFromTop, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #30 (**P3-M5: `attachFromTop` — the
from-the-top ATTACH, and the play gate that had to be REMOVED**). The variant the
`lookAtTopN` slice deferred: look at the top N of your own deck and attach the
Energy you find there **straight onto your Pokémon**, "**in any way you like**".
That phrase is why it is its own op — each attached card names its **own**
destination, so the answer is a **MAP** (card → Pokémon), the first prompt whose
answer pairs each pick with a target of its own (`attachCards`). Any split is
legal, including both Energy on ONE Pokémon. Two consumers differing in **every**
rider the op has: **Electric Generator** (sv01-170, Item — top 5, up to 2 Basic
{L} Energy CARDS, onto your BENCHED {L} Pokémon, leftovers shuffled back) and
**Hydreigon "Tri Howl"** (sv02-140, Ability, once per turn — top 3, ANY number of
Energy cards, onto ANY of your Pokémon, leftovers **DISCARDED**). The **leftovers
clause** is the design point: "shuffle the other cards back" is a trailing
`shuffleDeck` op (they never left the deck, and a shuffle destroys order anyway),
but "**discard** the other cards" must name exactly the looked-at cards that were
not attached — so it is `discardRest` ON the op, and it is charged on **every**
path (whiff, decline, no-target), which is the difference between Tri Howl costing
three cards and costing nothing. New event `DECK_TOP_DISCARDED`. The filter reads
the **PRINT** (`basicEnergy` + type, never `providesEnergy`): these cards sit in a
DECK, attached to nothing — D44's §6.5 from the other side.
`attachEnergyTargets` was **widened, not copied**, into a shared
`AttachTargetRiders` (new member: `benchOnly`). Rules doc extended at **§15.E**.
engineVersion 0.24.0 → **0.25.0**; 1301 → **1331** tests, `bun run check` +
`vite build` green. **Review (2 adversarial agents, engine+rules with 50 mutants /
web+integration; 65 mutations between them): ONE HIGH — the play gate.** The first
draft refused Electric Generator with no Benched {L} Pokémon; but `programPlayable`
is an **AND over ops**, so that vetoed the CARD including its second printed
sentence, which always resolves — against the very ruling cardplay.ts quotes, and
against Great Ball / Nest Ball in this same repo. The op is now **ungated** and
the no-target board is a live path (attach nothing, shuffle). Also fixed: `max`
clamped to `min(printed, candidates.length)`; the prompt keeps "you find there" /
"in any way you like"; four engine test holes each proved by a mutation that
passed all 1323 tests (the cap was never the rule that rejected; a clobber of
Energy already on the Active; append-vs-prepend into a discard pile that was empty
at every seed; and the apply's four wire guards, one of which **destroys a card**
if removed — now driven directly through `applyChoice`); and five web fixes, the
sharpest being that a **pending** pick was `aria-pressed` although Confirm does not
dispatch it, and a dispatch-time filter against the offer, because a stale prompt
key's failure mode is not a bad attach but an **unescapable dialog**. See D45.

---
### Prior header (P3-M5 the providesEnergy filter, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #29 (**P3-M5: the `providesEnergy`
CardFilter — "an Energy that PROVIDES {X}"**). The energy-removal family's last
missing piece, and the **first filter a CARD alone cannot answer**. Two claims:
**PROVISION, NOT PRINT** — "{L} Energy" is not "a Basic Lightning card"; a Special
providing {L} IS one, and a WILDCARD (Luminous) is an Energy of EVERY type; and
**HOST, NOT CARD** — provision is a while-ATTACHED property that Luminous's own
clause makes depend on the holder's other attachments, so the identical card is a
{L} Energy on one board and not on another. `attachedEnergies` answers it per
Energy ON ITS HOST; the card-only pile scanner `matchesFilter` answers **false**
(a card in a pile is attached to nothing), making a mis-authored pile scan a LOUD
NO-OP rather than a wrong card. `continuous.ts` was **split, not copied**, so the
filter and §8.2's cost matcher share one `unitsOf` — **what can PAY a {L} cost is
exactly what a "{L} Energy" effect can take**. **TWO consumers, one vocabulary**
(the D40 shape, and the whole reason this is a filter rather than a field): the
**typed self-discard**, DERIVED in both printed notations — the modern `{R}` and
the swsh-era spelled-out `Fire` — landing **5 catalog rows with ZERO registry
rows** (Kilowattrel, Arcanine ex ×2, Charmeleon, Charizard); and **`moveEnergy`'s
new `benchToActive` route**, authoring **Armarouge ×2** ("Fire Off"). Written into
`ptcg-rules.md` as **§6.5**. engineVersion 0.23.0 → **0.24.0**; 1268 → **1301**
tests, `bun run check` + `vite build` green. **Review (2 adversarial agents,
engine+rules with 49 mutants / web+integration): NO HIGH from either.** The engine
agent ran the deriver over **all 1108 text surfaces of all 978 catalog rows**
(exactly 5 matches, zero false positives, zero misses), threw **36 hostile
`resolveEffect` inputs** at both new prompts (zero throws, zero mutation), and
verified all five new fixtures byte-for-byte. Fixes applied: **`ENERGY_MOVED.to`
no longer spreads the client's object** (a hostile `dest` smuggled arbitrary keys
into an event the animator/log/P4-broadcast consume); `energyType` tightened to
**`BasicEnergyType`** so the one forbidden value (Colorless — the fallback every
unauthored Special provides) is unrepresentable; the route's "an Active exists"
guard **collapsed from three untested copies to one**; a **`fix-blend`** fixture
for a Special providing two distinct types (the predicate's `.includes` was
indistinguishable from "first unit only"); plus `moveNote`'s article, an orphaned
JSDoc, the web `promptKey`, a `<output>` live region, and **two DOM tests the web
agent proved missing by mutations that passed all 1297 tests** (the
multi-destination pick, and `reset()` on source change). See D44.

---
### Prior header (P3-M5 the discardEnergy ATTACK arms, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #28 (**P3-M5: the `discardEnergy`
ATTACK arms — the opponent-side twins + the exact-N `count`**). No new op: two
extensions of D41/D42's `discardEnergy`, both **DERIVED from printed text**, so
**11 catalog rows land with ZERO registry rows**. (1) The hammer family's **attack
TWINS** — "Discard an Energy from your opponent's Active Pokémon.", bare and behind
a flip — run the EXISTING `opponentActive` arm with an `anyEnergy` filter
(**Pincurchin, Gumshoos, Dragonite V ×2; Dedenne, Maschiff, Tympole, Yveltal**).
They are the first ops to park a decision about the **OPPONENT's** board mid-attack,
and needed NO new machinery: D42's `attackEpilogue` carries the tail and
`coinFlipGate` already splices its branch into the queue. (2) The **exact-N
self-discard** — `count` widens from `"all"` to any number (**Corviknight**,
**Slither Wing** 2; **Koraidon** 3). The prompt's `scope` becomes
**`{kind:"total",count} | {kind:"each"}`**, and the D42 collapse is **CAPPED at
`count` per class rather than flattened to 1** — that is the design insight of the
slice: flattening would erase a distinguishable answer ("discard both Fighting"),
while the cap still drops every copy that could ONLY duplicate, so four identical
{F} with count 3 stays forced. **`forcedDiscards` then folds the SHORT board into
the same comparison** — "auto-resolve when the offer is ≤ count" IS both the M1
no-choice rule and §8.6 "do as much as you can" (added to `ptcg-rules.md` this
session, corroborated on-card by Sandaconda). **Anchoring is load-bearing beyond
any earlier deriver slice:** Krookodile prints "Flip a coin **until** you get
tails. For each heads, discard an Energy…" — it ENDS in the twin's exact words.
engineVersion 0.22.0 → **0.23.0**; 1250 → **1268** tests, `bun run check` +
`vite build` green. **Review (adversarial engine+rules with 48 mutants /
web+integration): NO HIGH in the slice's own logic from either.** The engine agent
checked all five regexes against all 978 catalog rows (11 matches, zero false
positives/misses) and brute-forced the collapse math over 7770 configurations. The
web agent found **one HIGH beside the slice**: `ENERGY_DISCARDED` named its host by
SPOT, and an attack twin strips a defender its own damage Knocked Out in the SAME
batch — so the log re-read an empty slot and printed "from Tide's the Active spot".
The event now carries **`host`** (the top-card uid — the KNOCKED_OUT precedent).
Of 10 surviving mutants 1 was a real hole (the **`each`-scope cap of 1** was
entirely unpinned), 4 were unpinned regex anchors, 1 pre-existing outside the slice
(`moveEnergy`'s duplicate-uid check), 4 equivalent; all now dead. See D43.

---
### Prior header (P3-M5 attack programs can PARK, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #27 (**P3-M5: ATTACK EFFECT PROGRAMS
CAN PARK — the `attackEpilogue` stage, and the §8 self-discard attack cost**). The
top backlog row and the biggest remaining structural unlock, diagnosed by D41 and
built as one STAGE, not one op. `attack.ts` ran an attack's effect program as
`runProgram(...).state`, silently DROPPING a parked prompt and every op behind it.
The fix **inverts the order — queue the tail first, then run the program**: new
`PendingStage` **`{kind:"attackEpilogue", seat, koedSeat}`** carrying the §8.1 KO
sweep + the §5.3 turn end, **`finishAttack` moved from attack.ts into flow.ts**
(exported, so `advance` can reach it), and the fold goes through
**`settleProgram(..., {resumeTail:true})`**. A DONE program drains straight into
the stage (identical to the old inline call, one hop later); a PARKED one leaves it
in `pending` until `resolveEffect` finishes the program — across any number of
re-parks — and drains it then. **`resumeTail` is deliberately REDEFINED** from "this
program is mid-KO-sweep" to "this program is mid-TAIL, the stages that finish the
job are already queued behind it"; the only consumer that must tell the two apart is
the projection (`koParkActiveSeat` gained `attackEpilogue` as an in-turn marker).
**The family that proves it is DERIVED, not authored:** `discardEnergy` gained a
**`yourActive`** arm and a **`count:"all"`** rider, and two anchored whole-sentence
deriver rules land **12 catalog rows with ZERO registry rows** — Houndoom ×2,
Charcadet, Staraptor, Paldean Tauros, Dedenne ex ×2, Bombirdier ("Discard an Energy
from this Pokémon.") and Pawmot ×2, Raichu ×2 ("Discard all Energy…"). Third idea:
**interchangeable candidates COLLAPSE** — one representative per (host, energy
identity), so a Houndoom attacking with three {R} asks nothing. `ENERGY_DISCARDED`
gained **`actor`** (victim and actor are the same seat for a self-discard).
engineVersion 0.21.0 → **0.22.0**; 1227 → **1250** tests, `bun run check` +
`vite build` green. **Review (adversarial engine+rules + web+integration): NO HIGH
from either**; 56 mutants between them, **9 survivors, all now dead**. The sharpest
catch: the collapse keyed on catalog **id**, but the real catalog prints Basic Fire
Energy under three ids (sve-002/010/018) — an id key would have parked a real deck
on a non-choice and broken the slice's own headline claim, so a Basic now keys on
what it **provides**. See D42.

---
### Prior header (P3-M5 discardEnergy, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #26 (**P3-M5: `discardEnergy` — the
energy-removal "hammer" family, and the coin-gate playability bug it exposed**). One
new op takes Energy off the **OPPONENT's** in-play Pokémon; **`from` names both the
eligible Pokémon and how many are hit** — `opponentActive` (Mawile), `opponentChosen`
(Crushing Hammer), `opponentEach` (Giacomo) — and all three arms land with a REAL
printed card. Exactly one Energy per affected Pokémon (no `count`: every "discard 2 /
discard all" variant is an ATTACK, which cannot park). **The engine's first MANDATORY
park** — every prior parking op was "up to" or exactly-one; here the only question is
WHICH Energy, so an empty pick is an ERROR, not a decline. `opponentChosen` is a
ONE-step decision (picking the Energy IS picking the Pokémon), so unlike `moveEnergy`
there is no coupling to validate. New `specialEnergy` CardFilter; one
`ENERGY_DISCARDED` event **per affected Pokémon**; the card goes to its **OWNER's**
pile. Lands **3 COMPLETE real cards**: **Crushing Hammer** (sv01-168), **Giacomo**
(sv02-182/252/267), **Mawile** (sv03-143, an onPlayToBench trigger). engineVersion
0.20.0 → **0.21.0**; 1196 → **1227** tests, `bun run check` + `vite build` green.
**Review (adversarial engine+rules + web+integration): no HIGH in the slice's own
logic from either — but the engine review REVERSED a documented decision of mine, and
that is the session's most important outcome.** I had shipped Crushing Hammer as
playable into an Energy-less board ("the flip happens either way"); §7 / Compendium
[ruling/906](https://compendium.pokegym.net/ruling/906/) (reconfirmed by the TPCi
Rules Team **2025-06-26**) says otherwise, because **a coin flip is PROCEDURE, not
effect**. `programPlayable` now DESCENDS into `coinFlipGate.then` — which also fixes a
**pre-existing** bug: Pokémon Catcher was likewise playable into an empty opponent
Bench. Poké Ball is deliberately untouched (a deck is not public knowledge). The
engine agent's 45-mutant run left 5 real survivors, all test-adequacy, all now dead;
the web agent's 3 MEDs are all fixed. See D41.

---
### Prior header (P3-M5 board conditions, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #25 (**P3-M5: board conditions — one
`BoardCondition` vocabulary with TWO consumers**). The `conditionalPlay` backlog
family, built as a primitive rather than a per-card flag. **`BoardCondition`** is a
predicate union evaluated for one seat — `morePrizesThanOpponent` (strict `>`),
`yourStadiumInPlay`, `noEnergyOnYourPokemon` — behind one evaluator `conditionHolds`
+ a describer `conditionNote`. **Its invariant is the design:** every member reads only
PUBLIC state, so **a gate emits NO event** (unlike `coinFlipGate`, whose flip IS new
information — a board condition is a fact both players already see). Consumer A is the
printed **PLAY GATE** `CardProgram.trainerPlayableIf`, checked BEFORE the card leaves
hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`) — a rule PRINTED on the card, unlike
`programPlayable`'s would-only-whiff heuristics. Consumer B is the mid-program
**`conditionGate`** op `{cond, then, otherwise?}`, spliced into runProgram's queue
exactly like `coinFlipGate` (so an op inside a branch can still park); `otherwise` is
the printed "…**instead**", a genuine if/ELSE. Plus one tiny automatic op
**`drawUntilHandSize`** — it DRAWS to a floor and never TRIMS a bigger hand, and
no-ops with NO event at a count ≤ 0. Lands **3 COMPLETE real cards**: **Fighting Au
Lait** (sv02-181), **Falkner** (sv02-180/251), **Grusha** (sv02-184/253/268).
**Web: zero new events, prompts, dialogs or projection fields** — the only change is
the HUD greying a gated Trainer out with the engine's own predicate, carrying
`conditionNote` as the row tooltip (disabling the button REMOVES the reject pill that
used to explain the printed rule). engineVersion 0.19.0 → **0.20.0**; 1164 → **1196**
tests, `bun run check` + `vite build` green. **Review (adversarial engine+rules +
web+integration): NO HIGH from either.** The engine agent verified the riskiest claim
— `yourStadiumInPlay` is **OWNERSHIP, not presence** — against the Japanese printing
of ハヤト (「場に**自分の**スタジアムが出ているなら」); an opponent's Stadium must not
grant Falkner's +2. Its 24-mutant run left 5 survivors (1 equivalent), all
test-adequacy, all now fixed and re-verified dead via two new fixtures
(**fix-gateorder**, **fix-gatedsup**). The web agent's 4 MEDs are all addressed
(engineVersion bump, log-row tests, a self-defeating P4 claim in a doc comment, and
the HUD's opponent-`prizes` read → recorded as a P4 item). See D40.

---
### Prior header (P3-M5 Iono, kept for continuity)
**2026-07-21** — build session #24 (**P3-M5: Iono — the `handRefresh`
riders that CLOSE the hand-refresh family**). The format's highest-play-rate Supporter
needed **no new op**: three composable riders on the D38 op — **`toBottom`** (shuffle
the **hand alone** and put it UNDER the deck, so the deck's order — and the next draws
— SURVIVE; the whole strategic difference from Judge, pinned by a test asserting the
drawn cards are exactly the pre-play deck top, in order), **`draw:{kind:"prizeCount"}`**
(each player draws their OWN remaining Prizes — the player behind draws more; a public
count, so no leak), and **`onlyIfAnyMoved`** (the draw fires only if ≥1 affected player
moved a card — an all-or-nothing gate ACROSS seats, "if EITHER player…"). That
cross-seat gate forced one structural change: `handRefresh` now runs **two passes**
(all placements, then all draws) instead of interleaving per seat — **behaviour-
preserving** for Youngster/Judge/Brassius/Katy (per-seat-disjoint zones + `drawToHand`
consumes no rng ⇒ byte-identical states and rng, verified by reconstructing the old
loop), the only change being Judge's event interleaving. One new count-only event
**`HAND_TO_BOTTOM_OF_DECK`**; one log row; no dialog (the op still never parks); no
projection change. engineVersion 0.18.0 → **0.19.0**; 1156 → **1164** tests, `bun run
check` + `vite build` green. **Review (adversarial engine+rules + web+integration): no
HIGH; 2 MED, both FIXED.** The engine MED came from **mutation testing** — deleting the
hand shuffle left all 379 engine tests green (order-insensitive assertions, nothing
asserted `rngState`) → added the two assertions that kill it. The web MED (raised
independently by BOTH agents) was the log copy implying Iono does NOT shuffle → now
says both verbs. LOWs applied: an Iono degenerate-deck test, a describe rename, and a
real end-to-end log test pinning the grouped 5-row batch. **Deliberate deviation
(recorded, not accidental):** Iono into two empty hands is a total no-op yet stays
LEGAL — no `programPlayable` gate, because a gate would have to reach into "playTrainer
discards the played card up front". **The family is CLOSED** (no Marnie in sv01–03).
See D39.

**2026-07-20** — build session #23 (**P3-M5 op-slice:
`handRefresh`** — shuffle your hand into your deck, then draw; the Iono/Judge/Marnie
hand-refresh Supporter family). New op `{who:"you"|"both", draw}` — the FIRST op in a
new class: **fully AUTOMATIC** (no decision → it NEVER parks, like drawCards/
discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`, Judge — the
first op to reach the OPPONENT's hand/deck). Per affected seat (controller first, then
— for `both` — the opponent) it captures the PRE-shuffle hand size, moves the whole
hand into the deck, shuffles the combined pile (one rng advance), then draws per
**`HandRefreshDraw`**: `{fixed count}` (Youngster 5, Judge 4, Katy 8) or `{handPlus
delta}` (Brassius hand+1). **Card conservation** is a pure multiset move
(`[...deck, ...hand]` → shuffle → draw back), invariant under every degenerate zone
state; `rngState` is threaded fresh each iteration (the two-shuffle Judge has no stale
reuse). Always playable (no gate); never damages/KOs. **Katy "your turn ends"** lands
the `endsTurn` fold on the TRAINER path — a new CardProgram flag **`trainerEndsTurn`**
that `playTrainer` passes to `settleProgram`, folded byte-for-byte like Koraidon's
`AbilityProgram.endsTurn` (D34); non-Katy trainers pass `endsTurn:false` → byte-
identical, no regression. One new count-only event **`HAND_SHUFFLED_INTO_DECK {seat,
count}`** (the deck reorder is intrinsic — no separate `SHUFFLE`). Lands **4 COMPLETE
real Supporters** (verified vs local D1): **Youngster** (sv01-198), **Judge**
(sv01-176), **Brassius** (sv03-187), **Katy** (sv01-177/237). **Web: one log row, no
dialog** — handRefresh never parks, so no new `EffectPrompt`/dialog (GameHud
untouched); one count-only `HAND_SHUFFLED_INTO_DECK` row, the draw riding the existing
count-only `CARDS_DRAWN`. **Hidden info (Judge — the first op to touch the opponent's
hand): leaks NOTHING new** — the opponent's `CARDS_DRAWN` uids are the standard
`drawToHand` contract; the log arms are count-only and the projection already redacts
the opponent's hand to uid-less backs. **Adversarial review (engine+rules + web+
integration): BOTH CLEAN, no HIGH/MED, NO code fixes** (card conservation over all
four degenerate zone states, two-shuffle rng threading, handPlus timing, the Katy
endsTurn fold with no regression across the full 374-test engine suite, purity, all
four texts byte-matching the catalog, Judge hidden-info safe on both log + projection).
engineVersion 0.17.0 → **0.18.0**; 1146 → **1156** tests, `bun run check` + `vite
build` green. INFO (not bugs): an empty hand emits `count:0` (honest, non-leaky — the
`HAND_DISCARDED "(0 cards)"` precedent); no-separate-`SHUFFLE`-event is cosmetic with
no consumer. Closes the `shuffleHandIntoDeck` + `endTurn` backlog rows. See D38.

## Resume point
**P4 increment 3c-v is DONE (online.md, D76) — the forfeit deadline is on the WIRE and the opponent watches it
count down.** `PlayerState.forfeitAt` replaced the DO's private `ABANDON_KEY` list, so the number the banner
renders is the number the alarm fires on; `setSeatConnected` takes the deadline as a defaulted final argument
and `seatGuest`/`reseatHost`/`makePlayer` clear it, which makes `connected` ⇒ `forfeitAt === null` a shape you
cannot violate rather than a rule to remember (it retired 3c-ii's `clearDisconnectTimers`). New `readSnapshot`
normalizes `SNAPSHOT_KEY` on read — the opposite of `MatchRecord`'s version gate, on purpose. Client: the
top-centre `OpponentAwayBanner`. 1841 → **1853** tests; `bun run check` green. **BROWSER-VERIFIED on two
clients, all three paths** (banner + live countdown, forfeit at zero, and a genuine reconnect that cleared it
and was NOT forfeited past the deadline). **With this, the match lifecycle RESOLVES from every direction:**
you can concede (3c-iii), walking out concedes for you (3c-iv), vanishing forfeits you on a visible clock
(3c-ii + 3c-v), and an unreadable record retires cleanly (3c-i).

**Next concrete action — 3c-vi: REMATCH.** It is the last obvious hole and 3c-iv opened it deliberately: an
in-game lobby now has no route back to `selecting` except the host's kick, so two players who just finished a
game have to make a new lobby to play again. The pieces are already in place:
1. **`endMatch` (3c-i) is the primitive** — it clears the phase and re-derives (`selecting` with a guest), and
   `abandonsMatch` reports the transition so `commit` drops `MATCH_KEY` with it, which is what makes the next
   handoff mint a FRESH game instead of `handoffToMatch`'s idempotency guard reusing the old record.
2. **The trigger is a new client frame** (a `rematch` intent or a `LobbyIntent` member), valid only while the
   lobby is in-game with a FINISHED game (`state.phase.kind === "gameOver"` — mid-match it must be refused;
   conceding is the way out of a live one). Whether it needs BOTH players to agree, or one press returns the
   lobby to `selecting` and the other re-readies, is the design question — the second is less machinery and
   reuses the existing ready-up flow verbatim.
3. **Client:** a "Rematch" button on the game-over overlay beside the existing chrome, and `useLobby` already
   clears `match`/`matchLog` on any non-in-game snapshot, so the board tears down for free.
Then: **spectate** (per-viewer redaction makes a third, seatless viewer nearly free), and the **half-open
socket** gap below if it ever bites.

**Carried forward, still open:**
- **Half-open sockets are invisible to the server (found in 3c-v's browser run, pre-existing):**
  `setWebSocketAutoResponse` answers keepalives without waking the DO and nothing watches for pings that STOP
  arriving, so a player whose network dies without a TCP close is never marked disconnected and never
  forfeits. Every ordinary exit produces a close event, which is why it has never bitten. Needs server-side
  liveness (per-socket `lastSeen` instead of the auto-response, or an idle sweep) — its own slice.
- **The Pass-turn residual (`polish.md`):** each turn panel now carries its own `Pass`, but the playmat's ⟶
  AND the Previous/Forward history arrows are still covered by the panel (all three hit-test false while it
  is open). Passing works; history navigation stays unreachable during your own turn:action. Closing it needs
  a layout decision (move the controls clear of the panel's column, move the panel, or cap its height).
- **`MATCH_RECORD_VERSION` (3c-i):** BUMP it in the same commit as any future `MatchRecord`/`GameState` shape
  change. Widening an enum is not a bump (the worked example is in its doc). 3c-v changed `PlayerState`, which
  is the lobby SNAPSHOT, not the record — hence `readSnapshot` rather than a bump.
- **Recorded, NOT fixed (3b-ii, D71):** `stage2EvolvesFromBasic` resolves the Rare Candy chain BRIDGE against
  the SHARED `state.cardPool` (both decks), so a player whose own deck runs no copy of the bridge Stage 1
  while the OPPONENT's does gets a lit dialog they otherwise wouldn't — a faint decklist inference,
  pre-existing and identical in local hot-seat play. Fixing it is an engine/ingest change, not a transport one.
- **Recorded, NOT fixed (3b, D70):** 1 LOW residual — an Ability can be the FIRST online play to reach the
  `moveEnergy`/`discardEnergy`/`choosePokemonMulti` parks, so a latent bug in those dialogs would surface now
  (no break found; the 2026-07-26 browser runs exercised the ability path without one).

---
### Prior resume point (P4 3c-iv — leaving a running match forfeits it, kept for continuity)
**P4 increment 3c-iv is DONE (online.md, D75) — a mid-match LEAVE now FORFEITS the match instead of voiding
it.** The DO concedes for the leaver first (`concedeSeat`, extracted from `forfeitAbandoned` so the graceful
leave and the 90s timeout are one code path), then commits a lobby change that KEEPS the seat while in-game
(the new pure `applyBye`) — because freeing it would take the lobby out of in-game, drop `MATCH_KEY` and blank
the winner's board a frame after telling them they'd won. The rule is total on purpose (both slots, live AND
finished game), which is what makes it safe against the TWO `bye` frames a real leave sends. Client-side,
`BackToMenu` now takes an overridable `LeaveConfirmCopy` (via `PlaymatView.leaveConfirm`) so the online Back
button warns that leaving forfeits. 1835 → **1841** tests; `bun run check` green. **BROWSER-VERIFIED on two
real clients, both directions** (host-leaves and guest-leaves): the player who stayed got "You win! / The
match was forfeited." at once, kept their board, and was never dropped to the waiting screen; the Back dialog
showed the forfeit warning under a real hit-tested click; zero page errors. Worth doing because the DO class
has no tests at all — `applyBye` is unit-tested, the `bye` → `concedeSeat` wiring is not.

**Next concrete action — 3c-v: the opponent-facing forfeit COUNTDOWN.** With 3c-iv landed, the only path that
still leaves a player waiting in silence is an UNGRACEFUL drop (crash / killed tab / dead network — the 3c-ii
clock): their opponent sees nothing at all for 90s, not even that the seat went quiet. The shape:
1. **Put the deadline on the wire.** It belongs on the LOBBY SNAPSHOT, not the `match` frame: the arming
   moment (the disconnect grace expiring in `alarm()`) already commits a snapshot, no `match` frame is sent
   there, and a snapshot reaches a reconnecting client for free. Suggested `PlayerState.forfeitAt?: number |
   null` — **optional on the wire**, so a snapshot persisted by the PREVIOUS deploy (SNAPSHOT_KEY has no
   version gate, unlike `MatchRecord` since 3c-i) still parses instead of killing the lobby.
2. **Consider making it the single source of truth** — i.e. drop `ABANDON_KEY` and read the deadlines off the
   snapshot's seats in `scheduleMaintenance`/`forfeitAbandoned`, clearing them where the hello branches
   already set `connected: true` (`seatGuest` reconnect / `reseatHost` / `createSnapshot`). Mirroring the
   deadline into the snapshot while `ABANDON_KEY` stays authoritative would be two sources that can drift.
   Note 3c-ii's lesson: the DO class itself has NO tests, so anything that must be *scheduled* to work is
   invisible to the suite — re-check `scheduleMaintenance` by hand.
3. **Render it**: a small ticking banner in `OnlineMatch` while the game is live and the opponent's seat is
   disconnected ("Opponent disconnected — forfeits in 0:45"), counting off the server epoch ms the way
   `StartCountdown` already does with `countdownStartedAt`.
Then, in rough priority: **rematch** (`endMatch` from 3c-i is the primitive, and 3c-iv deliberately left the
in-game lobby with no exit but the host's kick, so this is the slice that gives it one), then **spectate**
(per-viewer redaction makes a third, seatless viewer nearly free). A two-client browser run is worth doing
once the countdown + rematch land — the recipe + the two seeded accounts (`verify-a@example.com` /
`verify-b@example.com`, password `verify-1234`, decks already in local D1) make it cheap.

**Carried forward from 3b–3c-iii (details in the prior resume point + headers below, D70–D74):**
- **The Pass-turn residual (`polish.md`):** each turn panel now carries its own `Pass`, but the playmat's ⟶
  AND the Previous/Forward history arrows are still covered by the panel (all three hit-test false while it
  is open). Passing works; history navigation stays unreachable during your own turn:action. Closing it needs
  a layout decision (move the controls clear of the panel's column, move the panel, or cap its height).
- **`MATCH_RECORD_VERSION` (3c-i):** BUMP it in the same commit as any future `MatchRecord`/`GameState` shape
  change. Widening an enum is not a bump (the worked example is in its doc).
- **Recorded, NOT fixed (3b-ii, D71):** `stage2EvolvesFromBasic` resolves the Rare Candy chain BRIDGE against
  the SHARED `state.cardPool` (both decks), so a player whose own deck runs no copy of the bridge Stage 1
  while the OPPONENT's does gets a lit dialog they otherwise wouldn't — a faint decklist inference,
  pre-existing and identical in local hot-seat play (the documented ingest-debt gap: the catalog stores only
  each card's IMMEDIATE `evolveFrom`). Fixing it is an engine/ingest change, not a transport one.
- **Recorded, NOT fixed (3b, D70):** 1 LOW residual — an Ability can be the FIRST online play to reach the
  `moveEnergy`/`discardEnergy`/`choosePokemonMulti` parks, so a latent bug in those dialogs would surface now
  (no break found; the 2026-07-26 browser run exercised the ability path without one).

---
### Prior resume point (P4 3b/3b-ii + 3c-i/3c-ii/3c-iii — the online HUD complete, record versioning, forfeit + concede, kept for continuity)
**P4 increments 3b + 3b-ii are DONE (online.md, D70 + D71) — the online turn HUD is now COMPLETE.** 3b put the
acting viewer's activated Abilities + non-Stadium Trainers on the wire with server-folded playability
(`redactedAbilitiesOf`/`redactedTrainersOf`, actor-only, `SUPPORTED_MATCH_ACTIONS` += `useAbility`); 3b-ii
closed the one gap it carried — **Rare Candy** — by flagging its trainer row (`RedactedTrainer.rareCandy`),
shipping the legal pairings on the phase (`RedactedPhase.turn:action.rareCandy` ← `redactedRareCandyOf`,
the engine's own `rareCandyOptions` mapped to the wire), adding the two-step `RareCandyDialog` to `OnlineHud`,
and admitting `rareCandy` to the allowlist (soft-lock-safe — same `placeEvolution` tail `evolve` has reached
since 2a). 1790 → 1803 → **1812** tests; `bun run check` green. **Every turn affordance the local HUD offers
now has an online counterpart.**
**BROWSER-VERIFIED the same session (2026-07-26, two real clients) — the verification owed since 3a is
DONE.** Two isolated Chrome sessions, two registered accounts each with a D1-saved deck, a real lobby over
the WS DO. It proved, in order of what was most at risk: (1) **the forwarded `session` cookie DOES survive
the cross-origin WS upgrade** — both seats resolved to their account and `loadPlayerDeck` returned each
player's own 60 (the failure mode that would have made all of P4-3 useless is closed); (2) the online event
log renders on both clients, correctly relabelled you/opponent; (3) 3b's ability/trainer HUD is faithful live
— Chien-Pao ex's ability fired, parked at its deck search, resolved, and the row then GREYED ITSELF on the
once-per-turn gate, while `Switch` sat greyed with "No legal target" on an empty Bench; (4) **3b-ii's Rare
Candy works end-to-end** — the flagged row opened the dialog, which pre-selected the sole Basic, and the pair
dispatched → Fuecoco evolved straight to Skeledirge (180 HP), skipping Crocalor, both logs agreeing, the
chain BRIDGE resolving through a Crocalor that was only ever in the deck; (5) the hidden-info barrier held in
a real two-client game (the deck-search candidates reached the controller alone; the opponent saw a bare
count); (6) zero page errors on either client. Driven with a purpose-built Rare-Candy-dense probe deck (a
2-of is a coin flip — even the probe waited until turn 11). **Not exercised:** reconnect, concede/rematch,
the rejection pill, a game driven to an actual win.
**It also FOUND one real bug — PRE-EXISTING, not a P4 regression, recorded in `polish.md`:** the playmat's
**Pass turn button is unclickable while the turn panel is open**, in BOTH /play and online — the `z-[75]`
panel covers the `z-20` control at every viewport height tested (633–900), so a real click lands on an
attack/ability row. It reproduces with the minimal local panel, so it predates 3b, and it had been
mis-recorded in the `verify` skill as an agent-browser quirk (a synthetic `.click()` "works" only because it
skips hit-testing — that entry is now corrected). **FIXED the same session, per the user's chosen shape:**
each turn panel now carries its own **`Pass`** button in its footer beside Retreat (`GameHud` TurnPanel +
`OnlineHud` AttackPanel) — no disabled state needed, since a panel renders exactly when
`passDisabled === false`; named "Pass" so it doesn't collide with the playmat ⟶'s accessible name.
Browser-verified with a REAL (hit-tested) click: the turn advances, and the in-panel button is clickable at
1280×633/800/1000 where the ⟶ is not. 1812 → **1814** tests. **RESIDUAL, recorded in `polish.md`:** the ⟶
AND the Previous/Forward history arrows are still covered by the panel (all three hit-test false while it is
open) — passing is restored; history navigation stays unreachable during your own turn:action. Closing that
still needs the layout decision (move the controls clear of the panel's column, move the panel, or cap its
height short of the vertical centre).
**3c-i — the MatchRecord storage hardening — is DONE this session too (D72).** The no-migrations gap the
2b-iii-d-ii LOW deferred, closed FIRST because reconnect/timeouts will change the record's shape again.
`MatchRecord` gained **`version`** (from `MATCH_RECORD_VERSION`) and every read goes through the pure
**`readMatchRecord`** — a version gate, NOT field defaults: defaults repair only the fields we know went
missing and say nothing about an embedded `GameState` from a build whose RULES moved (reads back "fine",
plays subtly wrong). The DO gained one door onto the key (`peekMatch` → none/ok/stale) +
**`retireStaleMatch`** (drop it, leave in-game, `match-error` to both, reusing 3a's surface); the four call
sites differ on purpose (action + reconnect RETIRE, the alarm flip SKIPS, the handoff guard OVERWRITES).
**A real bug caught mid-build:** `resetAfterFailedStart` cannot end a RUNNING match — `recomputePhase`
returns an in-game snapshot untouched — so the first draft would have wedged the lobby in-game around the
record it had just deleted, the exact failure the slice closes. Fixed with a new **`endMatch`** (logic.ts)
that clears the phase then re-derives; it's the primitive **concede/rematch/timeouts will all need**.
1814 → **1825** tests, `bun run check` green. Not browser-verifiable (needs a deploy boundary to fire).
**3c-ii — concede + the abandonment forfeit — is DONE this session too (D73, engine 0.41.0).** It closes the
last way an online match could never resolve: one player closing their tab used to leave the other staring at
a board FOREVER (the 5s disconnect grace only greys the connection dot; the empty-lobby TTL fires only when
NOBODY is connected, and the abandoned player is). **Engine:** `GameOverReason` += **`conceded`** + a new
**`concede`** action legal in ANY phase but `gameOver` — gated on your own turn it would be useless exactly
where it's needed, and it's the one action that can always END a stuck match; ONE reason serves both
triggers, keeping the engine ignorant of transport. **DO:** a second, much longer clock — `ABANDON_GRACE_MS`
= 90s (the 5s decides whether a seat LOOKS disconnected, the 90s whether they LOSE), armed when the grace
expires in-game, cleared on any hello by `clearDisconnectTimers` (both timers together, so no future branch
can forfeit a player who came back), fired by `forfeitAbandoned` through the ordinary applyMatchAction →
persist → broadcast path so a forfeit ends like any other match. **`MATCH_RECORD_VERSION` NOT bumped** —
widening an enum is backwards-compatible; the worked example is now in its doc. **Two bugs caught mid-build,
both invisible to tests:** the abandon deadlines were persisted but never added to `scheduleMaintenance`, so
nothing would have woken the DO and the feature would have silently never fired; and a change check compared
array references against a fresh storage read (a write every alarm). **Client:** both game-over overlays now
show WHY, off a shared total `GAME_OVER_DETAIL` — the online one showed no reason at all, and a bare "You
win!" would leave a forfeit unexplained; the local overlay's and the engine log's ternary chains became total
Records, so a future reason is a compile error rather than silently reading "the deck ran out".
1825 → **1832** tests, `bun run check` green. **BROWSER-VERIFIED:** with a match live the guest's browser was KILLED and the host — who touched nothing — got "You win! / The match was forfeited." ~95s later, log row included. That run is the only proof the scheduling fix works: unscheduled, the DO would simply never have woken.
**3c-iii — the Concede control — is DONE this session too (D74).** 3c-ii let the SERVER end an abandoned
match but left the player unable to forfeit their own. The button sits in the HUD chrome beside the playmat's
"Back", NOT in the turn panel — that panel renders only on your turn, while the engine allows conceding in
ANY phase, and the case that matters most is waiting out an opponent who walked away on THEIR turn. Confirmed
through the existing `ConfirmDialog`, hidden once the game is over. **Browser-verified on two real clients**,
including a concede during SETUP (turn 0) — the any-phase legality is real, not a unit-test artifact.
**A copy bug the run caught (tests could not):** the game-over detail was winner-centric ("The opponent
forfeited.") while the online overlay shows the SAME line to both players, so the conceding player was told
their opponent forfeited; `GAME_OVER_DETAIL` is now possessive-free ("The match was forfeited."), correct
from either side under a title that already names the winner. 1832 → **1835** tests.
**Next concrete action — 3c-iv+ (the rest of the match LIFECYCLE).** In rough priority:
(1) **an explicit LEAVE (`bye`) during a match still VOIDS it** rather than conceding — the opponent's game
vanishes with no result, now the odd one out beside the timeout forfeit and the Concede button. Its own slice
because it raises a real question: does the leaver stay seated long enough for the other player to SEE the
result? Plus an opponent-facing "forfeits in 0:45" countdown, which needs the deadline on the wire.
(2) **rematch** — the match-record lifecycle already drops `MATCH_KEY` on the abandon transition and
`endMatch` (3c-i) is the primitive, so a rematch has a clean seam to hang off.
(3) ~~the DO-storage-migration hardening~~ — **DONE as 3c-i above (D72)**; remember to BUMP
`MATCH_RECORD_VERSION` in the same commit as any future `MatchRecord`/`GameState` shape change.
(4) spectate (per-viewer redaction already makes this nearly free — a third, seatless viewer).
A second browser run is worth doing once (2) and (3) land — the recipe + the two seeded accounts
(`verify-a@example.com` / `verify-b@example.com`, password `verify-1234`, decks already in local D1) make
the next one cheap. See `workstreams/online.md`.
**Recorded, NOT fixed (3b-ii — self-review, in online.md + D71):** `stage2EvolvesFromBasic` resolves the
Rare Candy chain BRIDGE against the SHARED `state.cardPool` (both decks' cards), so a player whose own deck
runs no copy of the bridge Stage 1 while the OPPONENT's does gets a lit dialog they otherwise wouldn't — a
faint decklist inference, pre-existing and identical in local hot-seat play (the documented ingest-debt gap:
the catalog stores only each card's IMMEDIATE `evolveFrom`). Fixing it is an engine/ingest change (persist the
full evolution family at ingest, or scope the bridge scan to the actor's own deck+discard+hand), not a
transport one — worth doing when the ingest debt is next touched.
**Recorded, NOT fixed (3b — review, in online.md + D70):** 1 LOW residual — an Ability can be the FIRST online
play to reach the `moveEnergy`/`discardEnergy`/`choosePokemonMulti` parks, so a latent bug in those dialogs
would surface now (no break found; covered by the browser-run item above).

---
### Prior resume point (P4 increment 3a + 3a-sec — real deck selection + seat authentication, kept for continuity)
**P4 increment 3a (real deck selection at the match handoff) is DONE (online.md, D69).** The lobby loads
each player's OWN chosen deck from D1 — the first AUTHENTICATED surface in an otherwise account-less lobby.
**Increment 3 is SPLIT:** 3a (this — resolution + the failure surface), 3b (the online ability + non-Stadium
trainer HUD), 3c+ (reconnect/timeouts, concede/rematch, spectate). The `/ws` upgrade resolves the forwarded
`session` cookie → a per-socket userId (`resolveUserIdFromCookie`, DO-only, `attachUserId`); the handoff
reads each deck OWNER-SCOPED (`loadPlayerDeck` — `WHERE decks.id = <client deckId> AND decks.userId = <the
socket's authenticated userId>`), so a crafted `select-deck` for another user's deck resolves to nothing and
an anonymous socket is refused. Contents come from D1, never the client, so no forged 60. On failure the
alarm `resetAfterFailedStart` (back to selecting) + broadcasts `{kind:"match-error"}` — the load-failure
wedge is closed. `FIXED_MATCH_DECKS` removed. **3a-sec (seat authentication) folded in:** a playerId, once
claimed by an account, can only be re-adopted by that account (`seatClaimAllowed` + a DO-only
`SEAT_USERS_KEY`), closing the review's bearer-only-seat HAND leak. 1782 → **1790** tests; `bun run check`
green. **Two reviews: NO HIGH. 3a — five ranked properties HOLD, 1 MED (the leak) + 2 LOWs. 3a-sec — the
leak CLOSED, no legit reconnect broken, 3 LOW by-design notes.** All findings in the block below.
**Next concrete action — 3b (the online ability + non-Stadium trainer HUD):** real decks make abilities +
Supporters/Items REACHABLE, but the online HUD has no button for them and `useAbility` is off
`SUPPORTED_MATCH_ACTIONS`, so a deck that needs one to progress can STALL (the loud 3a gap — a missing
affordance, not an engine soft-lock). Put the playable ability/trainer options + their greyed/reason on the
`RedactedGame` wire — they read the FULL GameState (`programPlayable`/`conditionHolds`/`handCostUnmet`,
`index.ts:288-320`) so carry enough WITHOUT leaking prize counts / the Stadium owner / the hand — add the
OnlineHud buttons (restated over the redacted shape, the D62/D63 per-surface pattern), and grow the allowlist
by `useAbility` (Stadium already drives via the 2a drag; non-Stadium `playTrainer` needs a new hand-card
affordance). Then **3c+**: timeouts, concede/rematch, spectate, and the DO-storage-migration hardening the
2b-iii-d-ii LOW deferred (default missing MatchRecord fields on read).
See `workstreams/online.md`.
**Recorded, NOT fixed (3a + 3a-sec — review findings, in online.md + D69):** the 3a MED (the bearer-only-seat
HAND leak) was FIXED in 3a-sec. Still open: (LOW, 3a) `userIdOf` returns the FIRST live socket with the
seat's `playerId` regardless of its userId, so two live sockets sharing a `playerId` with DIFFERENT userIds
(a mid-lobby login change) can pick the account that doesn't own the `deckId` → a spurious `match-error`;
recoverable (re-ready), fix = prefer a non-null-userId socket. (LOW, 3a) `match-error` broadcasts the
actor-specific reason (e.g. "…must be signed in…") to BOTH players — a trivial sign-in-state disclosure (the
name is already public); fix = specific reason to the failing socket, generic to the other. (LOW ×3, 3a-sec,
all BY-DESIGN) a player who LOSES their session mid-lobby (cookie expired/dropped → anonymous) can't rejoin
their own bound seat — the intended boundary, low-probability (30-day sessions; a browser that drops the
SameSite=None cookie on reconnect was anonymous on the initial claim too, so the seat was never bound); a
same-tab account SWITCH is locked out for the lobby's lifetime (recoverable in a new tab — fresh playerId);
and `SEAT_USERS_KEY` grows unpruned across repeated guest-takeovers within one lobby (bounded in practice,
cleared by the empty-lobby `deleteAll`).
**Browser verification owed (two things, both untested):** (a) 3a — a two-client run confirming the
SameSite=None `session` cookie actually reaches the DO on the cross-origin WS handshake (the code forwards
it; the browser behavior is standard but unverified); (b) 2b-iii-d-ii — the online event log end-to-end
(the fixed decks emitted a real log; with real decks now loaded, a real game does too). The `verify` skill
covers the launch recipe. With real decks + the 3b HUD, a full online game becomes the P4 smoke-test.
**FIXED as 3c-i (D72) — was: recorded, not fixed (2b-iii-d-ii LOW #1).** The pre-slice `MatchRecord` shape
is now REFUSED by `readMatchRecord` and the match is retired cleanly instead of crashing. The original
finding, for the trail: (1) a `MatchRecord` written by
PRE-slice code (`{seed,state}` only) and read across THIS deploy has no `startedAt`/`names`/`log` → the
next `applyMatchAction` stamps NaN elapsed and throws a `names[…]` TypeError on a system row (COIN_FLIP /
FIRST_PLAYER_CHOSEN / GAME_OVER), and `broadcastMatch` sends `log:undefined` → a client `viewLogEntries`
render throw; NARROW (a match in-flight across a single deploy, dev-only fixed decks) and self-heals on
abandon+rematch — this is the acknowledged no-DO-storage-migration gap (carried from 1b), so the fix is
deferred to increment 3's storage/reconnect hardening. **(Fixed in 3c-i by a VERSION gate rather than the
field defaults suggested here — see D72 for why defaults were rejected.)** (2) the whole log
re-broadcasts on every accepted action (`broadcastMatch` sends `record.log` in full) — O(n) per action /
O(n²) over a match; the deliberate simplicity tradeoff (a reconnect gets the backlog for free), flagged
for a later delta/paginate pass. **Recorded, NOT fixed (2b-i — review LOWs, in online.md +
D62):** (a) the OnlineHud ko/attack/retreat panels restate GameHud's dialog markup (the D60
restate-per-surface choice — different shapes; extract the presentational grid/rows when a 3rd consumer
appears); (b) the online AttackPanel folds §12 immobilize into `attack.playable` + `retreat.can` but
still renders no explanatory immobilize/confusion NOTE text (harmless with the pure-damage/status-free
fixed decks — the note surface is deferred to when status-inflicting decks arrive); (c) allow-`attack`
is soft-lock-safe by PLAN ORDERING not a structural check (real decks/increment 3 must not precede the
2b-iii effect dialog — the SEQUENCING CONSTRAINT is loud in `match.ts`; note `retreat` carries no such
caveat — it never parks at a decision). Also still open: the DO `case "action"` boundary has no direct
test for the new types (only the pure `applyMatchAction`/allowlist do); a two-client browser run of the
loop is unverified (tests only). **Recorded, NOT fixed
(2a — review LOWs, in online.md + D61):** (L1) the DO `case "action"` boundary
has no direct test — only the pure `applyMatchAction` does (the DO-shell-untested pattern; it mirrors
the tested `intent` handler). (L2 was FIXED — the `SUPPORTED_MATCH_ACTIONS` allowlist.)
**Carried from 1c (still open):** (a) the client channel does no Zod on inbound frames (a malformed
`match` frame throws at render; not opponent-exploitable — only the trusted DO sends server frames);
(b) seat identity is bearer-only (pre-existing lobby auth, unchanged); (c) the setup-phase turn glow
lights "you" (cosmetic). **Carried from 1b (still open):** the load-failure in-game WEDGE (an
incomplete D1 pool flips to in-game with no match frame — client sits on `MatchPlaceholder`;
self-heals on abandon+rematch; a rejection/error surface is 2b–3); and `match.test.ts`'s synthetic
pool (pins deck size + coverage, not real-catalog id existence — no D1 in the current vitest setup).
**Carried forward (pre-existing, phase-independent):** the long-standing engine/deck-builder test
gaps are unchanged — see the prior resume point below (`legal_standard=0` on most local Trainers,
`GamePage.passDisabled` untested, `validateChoice` multi-host, `handCostUnmet` composition, no
onEvolve-through-Rare-Candy test, `maxPerTarget>1` has no printed consumer, the §9.3
returned-Pokémon gap, `healUpToNote."all"` dead code).

---
### Prior resume point (P3-M5 the ANY-target snipe family with conditional W/R — D59, kept for continuity)
**The ANY-target snipe family is live, with conditional W/R (P3-M5, D59), engine 0.39.0.**
"This attack does N damage to 1 of your opponent's Pokémon." (the WHOLE attack — the Active
OR a Bench) now SIMULATES. `damageChosen` gained `target: "opponentAny"` (candidates = the
opponent's Active + Bench, via `oppAnyRefs`) and `placeSnipe` an Active arm (`snipeActive`)
that runs the §8.5 W/R pipeline — so a hit on the ACTIVE takes Weakness/Resistance while a
Benched one stays flat (the rules' "W/R apply only to the Active", conditional on the pick).
Lands Fezandipiti ex (100), Rotom (20), Paldean Tauros "Aqua Dive" (60), Bellibolt ex /
Kilowattrel (50). The put-counter snipe (Hawlucha / Meowscarada) and the benched-`deals`
families (Wo-Chien, riders) are UNCHANGED. The benched-snipe / any-target snipe family is now
broad; the remaining shapes are named below.
**Next concrete actions:**
1. **Chien-Pao ex "Hail Blade" — the last "×" sibling, a genuinely NEW shape (its own
   session).** "You may discard any amount of {W} Energy from your Pokémon. This attack does
   60 damage for each card you discarded in this way." A COMPOUND needing pieces the engine
   lacks: (a) a "discard ANY amount" `discardEnergy` mode from YOUR whole board (a new count
   mode + a multi-source pick), (b) a §9.2 record of the discarded count, and (c) the damage
   scaling by that recorded count. HARDEST: the discard is a PRE-damage park (choose how much
   BEFORE damage is calculated), which INVERTS the current damage-then-effect order. MED+/HARD.
2. **The remaining snipe RIDER/target shapes (all cheap now the op is proven):** the "also
   does N to EACH of your opponent's Benched" SPREAD rider (a `spreadDamage` rider — Cetoddle,
   1 card), the "also does N to 2 of …" COUNT-2 rider (`damageChosen count:2`), and a
   `perTakenPrize`+`opponentAny` combination if any card prints it. Umbreon "Feint Attack" is
   an `opponentAny` snipe whose damage "isn't affected by Weakness or Resistance" — a
   NO-W/R-even-on-the-Active flag (a small `damageChosen` option). LOW/MED.
3. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional PASSIVE;
   `passivesOf` (continuous.ts) takes NO seat today and `PassiveEffects` has no conditional
   shape, so it needs a seat (or a `BoardCondition` evaluator) threaded through `passivesOf`
   + its two attack.ts call sites. MED.
4. Or pivot to **P4 (online matches)** — the engine is broad enough for real games.
**Recorded, NOT fixed (this slice):** `snipeActive` DUPLICATES attack.ts's §8.5 W/R pipeline
(base → ×Weakness → −Resistance → −reduction) rather than sharing a helper — a small, faithful
copy (a snipe omits the continuous pre-W/R bonus, which belongs to the main hit), acceptable
until a third consumer justifies extraction. `snipeActive`'s reduction term + the pre-W/R-bonus
omission are not INDEPENDENTLY pinned (no in-tree fixture gives an Active both a reduction
passive AND is sniped) — analysis-only, matching the benched arm's own reduction test.
**Carried forward (pre-existing, NOT this slice):** `legal_standard = 0` on most Trainers in
the local ingest; `GamePage`'s `passDisabled` phase check is untested; `validateChoice` does
not pin a multi-count pick to a single host; `handCostUnmet` is not compositional across two
costs in one program; the played Trainer sits UNDER its own payment in the discard pile; no
test anywhere covers an onEvolve trigger firing through Rare Candy; `maxPerTarget > 1` has no
printed consumer; a full target row's disabled STYLING is unpinned (house style); the
returned-Pokémon doctrine gap stays LATENT (§9.3); and `healUpToNote`'s `"all"` arm is still
dead code awaiting a printed author.

---
### Prior resume point (P3-M5 the flat benched-snipe RIDER family, kept for continuity)
**The flat benched-snipe RIDER family is live (P3-M5, D58), engine 0.38.0.** "This attack ALSO
does N damage to 1 of your opponent's Benched Pokémon." (a secondary snipe after the main hit)
SIMULATES — the SAME count-1 `deals` `damageChosen` op as D57's Covetous Ivy WITHOUT
`perTakenPrize`, so ZERO new op/interpreter code: a regex `ALSO_BENCHED_SNIPE` + one derive
case, landing ~15 prints (Miraidon, Tadbulb, Pawmot, Bellibolt, Decidueye ex, Jumpluff,
Orthworm, Palafin, Pyroar, Dartrix). Full detail in the D58 session-log entry, decisions.md
D58, and simulator build #43.

---
### Prior resume point (P3-M5 the "×" family's benched-target sibling — Wo-Chien "Covetous Ivy", kept for continuity)
**The "×" family's benched-target sibling is live — Wo-Chien ex "Covetous Ivy" (P3-M5, D57),
engine 0.37.0.** "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each
Prize card your opponent has taken." now SIMULATES: a CHOSEN single Benched target, so a
`damageChosen` op (count 1) extended with `deals` (ATTACK DAMAGE + benched reduction) and
`perTakenPrize` (`60 × the opponent's taken Prizes`, via `snipeAmount`; 0 taken → nothing);
new derive `BENCHED_SNIPE_TAKEN_PRIZES`, the "6 − remaining" formula extracted to shared
`takenPrizes` (types.ts). COMPLETED the "for each Prize card your opponent has taken" family.
Full detail in the D57 session-log entry, decisions.md D57, and simulator build #42.

---
### Prior resume point (P3-M5 the "×"/multiply damage family — Pecharunt / Annihilape, kept for continuity)
**The "×"/multiply damage family is live — Pecharunt ex / Annihilape (P3-M5, D56),
engine 0.36.0.** "This attack does N damage for each Prize card your opponent has
taken." (NO "more") now SIMULATES: the printed "N×" is the per-unit, so `per × count`
is the WHOLE damage with the printed base DROPPED (count 0 → 0 damage). A new reader
`deriveAttackDamageMultiplier` (effects.ts) + regex `OPPONENT_PRIZES_MULTIPLY` reuse
D55's `opponentPrizesTaken` count evaluator UNCHANGED; attack.ts reads both scaling
derivers (mutually exclusive on "more") and `scaledBase = damageMultiplier ? 0 : base`
drops the base only for a multiply. Lands **Pecharunt ex** sv06.5-039 (60×) and
**Annihilape** sv01-109 (70×). The bigger "×" siblings — **Wo-Chien ex** (benched
target) and **Chien-Pao ex** (discarded-Energy count) — stay LOUD as the multiply
reader's anchor-guard witnesses. The count-scaled damage vocabulary now covers both
folds (additive "+" and multiply "×") across its two in-tree count sources.
**Next concrete actions:**
1. **The "×"'s bigger siblings** — the two "×" cards this slice deliberately left
   LOUD, each a DIFFERENT shape (not a `damageMultiplier` twin): **Wo-Chien ex**
   sv02-027 "Covetous Ivy" — "does N damage **to 1 of your opponent's Benched
   Pokémon** for each Prize …" is a benched-TARGET multiply (`damageChosen`-style
   snipe × the Prize count, and the print says "Don't apply Weakness and Resistance
   for Benched Pokémon", so it must bypass the §8.5 pipeline the current fold runs).
   **Chien-Pao ex** "Hail Blade" — "you may discard any amount of {W} Energy … does
   60 damage **for each card you discarded in this way**" is a COMPOUND: an optional
   discard (a `discardEnergy` cost that PARKS) whose moved-count (§9.2 `recordGate`)
   THEN scales the damage — a new count source read off the record, not the board.
   Both are MED+.
2. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE; `passivesOf` (continuous.ts) takes NO seat today and `PassiveEffects` has
   no conditional shape, so it needs a seat (or a `BoardCondition` evaluator) threaded
   through `passivesOf` + its two attack.ts call sites. MED.
3. **The energy-removal family's remaining SENTENCE STRUCTURES** — an optional discard
   that BUYS an effect (Bellibolt ex), a rider clause (**Sandaconda — NOW KNOWN to need
   a new shuffle-into-deck op PLUS a persistent-marker subsystem, NOT cheap**), a repeat
   count (Krookodile).
4. Or pivot to **P4 (online matches)** — the engine is broad enough for real games.
   Named jobs unchanged from D55: strip `cont` from the phase, gate the remaining
   `pendingDecision` cases (D17 hands the prompt to both viewers per park), D40's
   `stadium.owner` + `prizesRemaining` projection additions, and the engine-exported
   preview predicates the HUD needs (`programPlayable` shipped).
**Recorded, NOT fixed (this slice):** the multiply W/R ordering is not INDEPENDENTLY
pinned by a weak-defender test (every multiply test uses fix-bigbody, no weakness) — but
the fold is the SAME shared pipeline line as the additive family, already pinned by the
"folds BEFORE weakness" test, and with `scaledBase` forced to 0 the multiply arm only
supplies `scaled`, so it cannot break the order alone (reviewer LOW). `scaledAttackDamage`
stays a TWO-member exhaustive switch — both count sources are shared verbatim between the
additive and multiply folds. No fixture exercises a card with BOTH a derived post-damage
program AND a multiply modifier (no such in-tree card; correct-by-analysis). **Carried
forward (pre-existing, NOT this slice):** `legal_standard = 0` on most Trainers in the
local ingest; `GamePage`'s `passDisabled` phase check is untested; `validateChoice` does
not pin a multi-count pick to a single host; `handCostUnmet` is not compositional across
two costs in one program; the played Trainer sits UNDER its own payment in the discard
pile; no test anywhere covers an onEvolve trigger firing through Rare Candy;
`maxPerTarget > 1` has no printed consumer; a full target row's disabled STYLING is
unpinned (house style); the returned-Pokémon doctrine gap stays LATENT (§9.3); and
`healUpToNote`'s `"all"` arm is still dead code awaiting a printed author.

---
### Prior resume point (P3-M5 the count union's second member — opponentPrizesTaken, kept for continuity)
**The count union's second member is live — `opponentPrizesTaken` (P3-M5, D55),
engine 0.35.0.** Charizard ex sv03-125 "Burning Darkness" (180+) now folds
`30 × (6 − the opponent's remaining Prizes)` into the printed base before the §8.5
W/R pipeline — the second `DamageCountSource` after D54's self damage counters.
`OPPONENT_PRIZES_SCALE` (effects.ts) is anchored on **"more"** so the "×"/multiply
Prize family (Pecharunt/Annihilape/Wo-Chien) stays loud; `scaledAttackDamage` widened
to `(attacker, bonus, state, defenderSeat)`. The unsimulated-"+" anchor-guard witness
migrated from Charizard to real **Entei sv03-030 "Blaze Ball"**. The union-of-two
shape the interface was built for is confirmed; the additive "+" family is complete
for its two in-tree count sources.
**Next concrete actions:**
1. **The "×"/multiply damage shape** — the sibling of this additive "+" family:
   "This attack does N damage **for each** …" (no "more") MULTIPLIES rather than adds
   (`parseAttackDamage` already splits the `"60×"` marker; nothing consumes it yet).
   The **cheapest** first members are the Prize-source twins **Pecharunt ex** sv06.5-039
   (60×) and **Annihilape** sv01-109 (70×) — they reuse the `opponentPrizesTaken`
   count evaluator UNCHANGED; only the fold differs (damage = `per × count`, no printed
   base to add to, so it is a DISTINCT shape from the "+" fold, not just a flag). Their
   refusal is ALREADY witnessed by this slice's regex tests. Bigger siblings: Chien-Pao
   ex "Hail Blade" counts DISCARDED Energy (a compound — discard then scale).
2. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE; `passivesOf` (continuous.ts) takes NO seat today and `PassiveEffects` has
   no conditional shape, so it needs a seat (or a `BoardCondition` evaluator) threaded
   through `passivesOf` + its two attack.ts call sites. MED.
3. **The energy-removal family's remaining SENTENCE STRUCTURES** — an optional discard
   that BUYS an effect (Bellibolt ex), a rider clause (**Sandaconda — NOW KNOWN to need
   a new shuffle-into-deck op PLUS a persistent-marker subsystem, NOT cheap**), a repeat
   count (Krookodile).
4. Or pivot to **P4 (online matches)** — the engine is broad enough for real games.
   Named jobs unchanged from D54: strip `cont` from the phase, gate the remaining
   `pendingDecision` cases (D17 hands the prompt to both viewers per park), D40's
   `stadium.owner` + `prizesRemaining` projection additions, and the engine-exported
   preview predicates the HUD needs (`programPlayable` shipped).
**Recorded, NOT fixed (this slice):** `scaledAttackDamage` is now a TWO-member
exhaustive switch with no trailing return (tsc accepts it; a third member would fail
the "function lacks ending return" check — the safety D54 relied on for one member
holds for two). The `Math.floor` stays only in the self-counter arm (Prize counts are
already integers, so the `opponentPrizesTaken` arm needs none). No fixture exercises a
card with BOTH a derived post-damage program AND an unsimulated "+" modifier, so the
skip arm firing `effect: null, damageModifier: "+"` is correct-by-ANALYSIS only
(pre-existing shape, no in-tree card). The Prize arm's "folds before Weakness" ordering
is not INDEPENDENTLY pinned by a W/R test — but the fold is shared code already pinned
by the self-counter's fix-weak test, and the Prize arm only supplies the `scaled`
number, so it cannot break the order on its own (reviewer LOW, noted).
**Carried forward (pre-existing, NOT this slice):** `legal_standard = 0` on most
Trainers in the local ingest (Charizard ex included — rotation, `legal_expanded = 1`);
`GamePage`'s `passDisabled` phase check is untested; `validateChoice` does not pin a
multi-count pick to a single host; `handCostUnmet` is not compositional across two
costs in one program; the played Trainer sits UNDER its own payment in the discard
pile; no test anywhere covers an onEvolve trigger firing through Rare Candy;
`maxPerTarget > 1` has no printed consumer; a full target row's disabled STYLING is
unpinned (house style); the returned-Pokémon doctrine gap stays LATENT (§9.3); and
`healUpToNote`'s `"all"` arm is still dead code awaiting a printed author.

---
### Prior resume point (P3-M5 count-scaled attack damage — the additive "+" family, kept for continuity)
**(was)** **Count-scaled attack damage is live — the additive "+" family (P3-M5, D54),
engine 0.34.0.** The printed "This attack does N more damage for each damage
counter on this Pokémon." now folds `per × floor(attacker.damage/10)` into the
printed base BEFORE the §8.5 W/R pipeline (`deriveAttackDamageBonus` in effects.ts
+ attack.ts's `base + scaled + bonus`), the first reader to turn the dead
`ATTACK_EFFECT_SKIPPED` damage-modifier path into a simulated one. Lands **Paldean
Tauros** "Raging Horns" and simulates **`fix-attacker` "Rage"**; new
`DAMAGE_DEALT.scaled` field + a `· scaled +N` log breadcrumb. **Charizard ex**
"Burning Darkness" (the Prize-taken count source) stays UNSIMULATED as the
anchor-guard witness. The damage-scaling vocabulary now exists; the `count` union
has one member and a real second one named.
**Next concrete actions:**
1. **Charizard ex "Burning Darkness" — the union's second `count` member
   (`opponentPrizesTaken`).** The cheapest continuation: one more anchored regex +
   one evaluator arm (`PRIZE_COUNT − state.players[defenderSeat].prizes.length` =
   the opponent's TAKEN prizes), landing a real in-tree card (sv03-125, 180+).
   NOTE it RETIRES the current anchor-guard witness, so it must add a replacement
   unsimulated-"+" witness (a synthetic fixture, or the "×" family once that
   exists). Confirms the union-of-two shape the interface was built for, and widens
   `scaledAttackDamage`'s signature to reach both boards (today it takes only the
   attacker).
2. **The "×"/multiply damage shape** — the sibling of this "+" additive family
   (Chien-Pao ex "Hail Blade", Mewtwo VSTAR): "does N damage **times** the number
   of …" MULTIPLIES rather than adds, and Chien-Pao counts DISCARDED Energy (a
   compound — discard then scale). Bigger than #1.
3. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE; `passivesOf` (continuous.ts) takes NO seat today and `PassiveEffects`
   has no conditional shape, so it needs a seat (or a `BoardCondition` evaluator)
   threaded through `passivesOf` + its two attack.ts call sites. MED.
4. **The energy-removal family's remaining SENTENCE STRUCTURES** — an optional
   discard that BUYS an effect (Bellibolt ex), a rider clause (**Sandaconda —
   NOW KNOWN to need a new shuffle-into-deck op PLUS a persistent-marker
   subsystem, NOT cheap**: the D53 resume note's "can't-retreat marker via
   `recordAs`" premise was FALSIFIED in exploration — the real text is "your
   opponent shuffles their Active Pokémon and all attached cards into their
   deck"), a repeat count (Krookodile).
5. Or pivot to **P4 (online matches)** — the engine is broad enough for real
   games. Named jobs unchanged from D53: strip `cont` from the phase, gate the
   remaining `pendingDecision` cases (D17 hands the prompt to both viewers per
   park), D40's `stadium.owner` + `prizesRemaining` projection additions, and the
   engine-exported preview predicates the HUD needs (`programPlayable` shipped).
**Recorded, NOT fixed (this slice):** **No fixture exercises a card with BOTH a
derived post-damage program AND an unsimulated "+" modifier**, so the skip arm
that still fires with `effect: null, damageModifier: "+"` (program ≠ null, scaling
= null) is correct-by-ANALYSIS only — a pre-existing shape with no in-tree card.
`scaledAttackDamage` is a ONE-member switch with no trailing return (tsc accepts it
exhaustive over the union); the seam widens to `(state, seats, …)` when
`opponentPrizesTaken` lands (#1). The `Math.floor` in the fold is defensive (all
damage lands in tens) — its removal survives the suite, declared. **Carried
forward (pre-existing, NOT this slice):** `legal_standard = 0` on most Trainers in
the local ingest; `GamePage`'s `passDisabled` phase check is untested;
`validateChoice` does not pin a multi-count pick to a single host; `handCostUnmet`
is not compositional across two costs in one program; the played Trainer sits
UNDER its own payment in the discard pile; no test anywhere covers an onEvolve
trigger firing through Rare Candy; `maxPerTarget > 1` has no printed consumer; a
full target row's disabled STYLING is unpinned (house style); the returned-Pokémon
doctrine gap stays LATENT (§9.3); and `healUpToNote`'s `"all"` arm is still dead
code awaiting a printed author.

---
### Prior resume point (P3-M5 damageSelf + the two-seat attack epilogue, kept for continuity)
**(was)** **Self-damaging attacks are live, and the D42 debt is paid (P3-M5, D53) —
engine 0.33.0.** Skeledirge sv01-038 "Blazing Shout" (190 + a 30 recoil) is the
engine's first attack that damages its OWN board: `damageSelf` places flat
self-damage on the attacker's Active (`COUNTERS_PLACED source "self"`, outside
the §8.5 W/R pipeline — the confusion self-hit's model), and **finishAttack's KO
sweep now covers BOTH boards** in `[defender, attacker]` order (§8.1 — the active
player takes prizes first; a self-KO prizes to the defender). The §14 double-KO
tie and the §14.2 self-KO-your-last-Pokémon loss are now reachable from the
attack path, both tested. The `attackEpilogue` stage lost its dead `koedSeat`
field. **Any recoil / self-damage attack text is now unblocked.**
**Next concrete actions:**
1. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause
   (Sandaconda, Eiscue ex, Weavile), a repeat count (Krookodile). The largest
   remaining coherent family, and the only one on the board that needs no new
   decision mechanism. Of these the **rider clause (Sandaconda)** looks cheapest
   — its discard is already shipped (exact-N `yourActive`, D43) and the gate is
   the existing `recordGate` (D48); the one new surface is `recordAs?` on the
   `discardEnergy` op — BUT the rider's *purchased effect* (a can't-retreat-style
   marker) is not in the in-tree DB, so confirm it reuses an existing op before
   committing to it as the smallest step.
2. **The last cheap reader of the D40 vocabulary: Defiance Band** — a
   conditional PASSIVE, the third consumer (`passivesOf` takes no seat today).
3. **`damageSelf` unblocked the recoil family** — other self-damaging attacks now
   derive for free, and the count-scaled "N×" / "N+" damage (Chien-Pao's Hail
   Blade, Paldean Tauros's Raging Horns) is the FIRST reader that would turn the
   `ATTACK_EFFECT_SKIPPED` damage-modifier path into a simulated one (`cards.ts`
   `parseAttackDamage` already splits `{base, modifier}`; nothing consumes the
   modifier yet). Its natural home is the energy family's scaling shape (#1).
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play
   real games, and this slice moved the P4 story forward on its own terms: a
   non-answerer's projection now carries NO `pendingDecision`, which is the
   first piece of the redaction job. Still named and still owed: strip `cont`
   from the phase regardless (the §9.2 record and `sourceUid` both ride it),
   gate the REMAINING `pendingDecision` cases (D17 hands the prompt to both
   viewers for every controller-answered park — three tests pin that contract,
   so reversing it is its own change), D40's `stadium.owner` +
   `prizesRemaining` projection additions, and the engine-exported preview
   predicates the HUD needs (`programPlayable` is the first of these, shipped).
**Recorded, NOT fixed (this slice):** **`damageSelf` targets the attacker's
Active, not the threaded `sourceUid`** — harmless because the deriver only ever
emits it as a lone recoil op and no derivable attack relocates the attacker
before it runs (and it matches the sibling `damageActive`, which likewise reads a
seat's Active), but a future multi-op attack that switched the source out before
the recoil would hit whoever is now Active; the op doc states the invariant rather
than resolving by uid. The op's **`amount <= 0` guard is defensive and untested**
(the deriver's `amount >= 1` guard, which IS pinned by the "…does 0 damage…"
negative, keeps a non-positive amount off the path; the guard mirrors
`damageActive`'s). The **`COUNTERS_PLACED "self"` modelling assumes no
self-damage-prevention passive exists** — a hypothetical "prevent all damage from
attacks, including your own" effect would need self-damage routed off the
flat-placement path; none prints in sv01-03. The new "self" log row's **`strong`
tone is not asserted** (the test pins text + `who`, not segment tone — the file
convention). **Carried forward (pre-existing, NOT this slice):** `legal_standard
= 0` on most Trainers in the local ingest
(both Ortega prints included — rotation, `legal_expanded = 1`); `GamePage`'s
`passDisabled` phase check is untested; `validateChoice` does not pin a
multi-count pick to a single host; `handCostUnmet` is not compositional across
two costs in one program; the played Trainer sits UNDER its own payment in the
discard pile; no test anywhere covers an onEvolve trigger firing through Rare
Candy; `maxPerTarget > 1` has no printed consumer; a full target row's disabled
STYLING is unpinned (house style); the returned-Pokémon doctrine gap stays
LATENT (§9.3 — the first revival/self-recovery op must revisit `sourceRef`);
and `healUpToNote`'s `"all"` arm is still dead code awaiting a printed author.

---
### Prior resume point (P3-M5 EffectContext.sourceUid, kept for continuity)
**(was)** **`EffectContext.sourceUid` is live (P3-M5, D50) — engine 0.30.0.** The context
names the Pokémon whose effect is running (the printed "this Pokémon"), set at
every run site that knows it and ABSENT for a Trainer program (whose parked
context stays byte-identical `{seat}`). First reader: `attachFromDeck.toSelf`,
landing **Pawmot ×2** ("Electrogenesis" — a **benched** Pawmot feeds itself).
Resolution is by board TOP uid: a source evolved over or gone from play is no
longer "this Pokémon" and the op whiffs into its printed shuffle (`ptcg-rules.md`
**§9.3**). Web: `AttachCardsDialog` now **commits on the card tap over a sole
target** — "a list of one is not a decision" (D44's rule, now the attach
dialog's too).
**Next concrete actions:**
1. **Saguaro** (sv02-187/-255/-270) — still the cheapest reader of §9.1's
   `min: 0` end, three slices running. "Choose up to 2 of your Pokémon and heal
   50 damage from each of them" wants `healChosen` widened with a count rather
   than a new op. Note it is `legal_standard = 0` in the local ingest, like most
   Trainers.
2. **Ortega** (sv03-190/-219) — the "in this way" gate over an OPPONENT-side
   pick from a hidden zone: "Your opponent reveals their hand, and you choose a
   card you find there and put it on the bottom of their deck. If you put a card
   on the bottom of your opponent's deck in this way, your opponent may draw a
   card." The gate exists; what does not is a prompt over a zone the ACTOR must
   be shown but does not own — and it is the first "your opponent **may**" (a
   decline belonging to the other seat).
3. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause
   (Sandaconda, Eiscue ex, Weavile), a repeat count (Krookodile).
4. **The last cheap reader of the D40 vocabulary: Defiance Band** — a
   conditional PASSIVE, the third consumer (`passivesOf` takes no seat today).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`,
   and strip `cont` regardless — the §9.2 record AND now the context's
   `sourceUid` both ride the phase; D40's `stadium.owner` + `prizesRemaining`
   projection additions; and the engine-exported preview predicates the HUD
   needs.
**What sourceUid unblocked vs. what stays blocked:** Pawmot landed;
**Forretress ex did NOT** — its target rule was never the blocker ("in any way
you like" is Charizard's shape), the wall is its §9.2 gate into a **KO by
EFFECT**, which no op can do (flow.ts owns every Knock Out). **Geeta** still
needs the turn-scoped "your Pokémon can't attack". And `discardEnergy`'s
self-side arm still has no printed consumer wanting the source — the wall
comment now says the context HAS the uid; what is missing is an arm that reads
it.
**Recorded, NOT fixed (this slice):** **the returned-Pokémon doctrine gap
(LATENT)** — `sourceRef` would re-acquire a source that left play and RETURNED
as a board top mid-program; unreachable at HEAD (full op-vocabulary audit:
nothing returns an in-play card to the board mid-program), but "a returned
Pokémon is a NEW Pokémon" (§9.3), so the first revival/self-recovery op must
revisit it. `runCheckupTriggers` threads the uid and **nothing can observe it**
(no betweenTurns program parks or reads the source — the review's equivalent
mutant). `toSelf`'s exclusivity with the other target riders is **DOC-enforced,
not code-enforced** — the op doc states the precedence, authoring it alone is
the rule. The attack path's sourceUid is the attacker's top uid at declaration
and correctly follows a mid-program switch — **untested**, because no shipped
program both moves the attacker and reads the source. **`GameLog` announces
only a batch's LAST row — SIXTH slice running**; Pawmot's batch ends on
`SHUFFLE`, so its attach is silent. **The P4 `pendingDecision` leak is unchanged
in KIND** — a `toSelf` offer leaks strictly LESS than Janine's (a 0/1
hidden-zone count by type, against her 1-vs-≥2). **Carried forward
(pre-existing, NOT this slice):** `legal_standard = 0` on most Trainers in the
local ingest (and on Pawmot itself — rotation, `legal_expanded = 1`);
`GamePage`'s `passDisabled` phase check is untested; Fighting Au Lait is still
playable with nothing damaged anywhere; `validateChoice` does not pin a
multi-count pick to a single host; `handCostUnmet` is not compositional across
two costs in one program; the played Trainer sits UNDER its own payment in the
discard pile; **no test anywhere covers an onEvolve trigger firing through Rare
Candy** (checked against this slice's review additions — they do not reach it
either; still correct by inspection only); `maxPerTarget > 1` has no printed
consumer; a full target row's disabled STYLING is unpinned (house style); and
from D42 the attack epilogue sweeps ONE seat, so a KO an attack inflicts on the
ATTACKER's own board is missed — **do that before landing any self-damaging
attack text** (sv01-038 Skeledirge is one deriver sentence away).

---
### Prior resume point (P3-M5 attachFromDeck, kept for continuity)
**(was)** **`attachFromDeck` is live (P3-M5, D49) — engine 0.29.0.** Search your own deck
for Energy and attach it straight onto your Pokémon, then shuffle — the
deck-search sibling of `attachFromTop`, sharing its `attachCards` MAP prompt.
6 catalog rows: **Charizard ex ×4** ("in any way you like", an onEvolve trigger)
and **Janine's Secret Art ×2** (`maxPerTarget: 1` — one apiece onto distinct {D}
Pokémon — plus `recordGate.contains: "yourActive"`, the §9.2 gate that asks WHERE
the cards landed rather than whether anything moved). The offer collapses
interchangeable candidates and its `max` is clamped by three ceilings, the new one
being `targets × maxPerTarget`.
**Next concrete actions:**
1. **Give `EffectContext` a source uid — "this Pokémon".** Now the cheapest
   STRUCTURAL row on the board, and it unlocks a family rather than a card. Three
   places already document the wall in so many words: `discardEnergy`'s
   `yourActive` arm ("an Ability on a BENCHED Pokémon saying 'this Pokémon' is NOT
   this member — EffectContext carries no source uid, so that card stays
   unauthored"), and now **Pawmot** (sv01-076/-209, "Electrogenesis": search your
   deck for a Basic {L} Energy and attach it to THIS Pokémon — an
   `attachFromDeck` whose target rule is neither of the two this slice built) and
   **Forretress ex**. Note `useAbility` already knows the uid; what is missing is
   threading it into the context the interpreter carries, and deciding what a
   source uid MEANS for a Trainer program (nothing — so it is optional).
2. **Saguaro** (sv02-187/-255/-270) — still the cheapest reader of §9.1's `min: 0`
   end, and this slice did NOT consume it after all (Janine's "choose up to 2"
   collapsed into the map prompt). "Choose up to 2 of your Pokémon and heal 50
   damage from each of them" wants `healChosen` widened with a count rather than a
   new op. Note it is `legal_standard = 0` in the local ingest, like most Trainers.
3. **Ortega** (sv03-190/-219) — the "in this way" gate over an OPPONENT-side pick
   from a hidden zone: "Your opponent reveals their hand, and you choose a card you
   find there and put it on the bottom of their deck. If you put a card on the
   bottom of your opponent's deck in this way, your opponent may draw a card." The
   gate exists; what does not is a prompt over a zone the ACTOR must be shown but
   does not own — and it is the first "your opponent **may**" (a decline belonging
   to the other seat).
4. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
5. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE, the third consumer (`passivesOf` takes no seat today).
6. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`
   (**now the worst it has been — see below**), D40's `stadium.owner` +
   `prizesRemaining` projection additions, and the engine-exported preview
   predicates the HUD needs.
**Recorded, NOT fixed (this slice):** **the P4 `pendingDecision` leak is
qualitatively worse on three axes**, and the older note's wording ("the
controller's private **deck-top** uids") is now the narrower half of the truth.
(1) SCOPE — `attachFromTop` leaked "these are among your top N", a bounded window;
this leaks "these are somewhere in your deck". (2) **A new kind of read: a
hidden-zone COUNT by type** — when the collapse yields fewer than the printed
`max`, the opponent reads off how many matching Basic Energy remain in the deck
(Janine distinguishes 1 from ≥2, Charizard 1/2/≥3); no other prompt leaks that.
(3) The older note's own axis — unattached candidates never becoming public by any
other route — now covers EVERY declined candidate, since this op emits no search
event at all. Bounded only by the interchangeable collapse. **Janine is playable
into a board with no {D} Pokémon**, spending the turn's only Supporter on a bare
deck shuffle — the shipped ungated doctrine (ruling/284), and the sharpest form of
that call yet, since every earlier consumer of it was an Item; the prompt is the
mitigation, not the gate. **`maxPerTarget > 1` has no printed consumer** (the
field is `number`, Janine is the only card at 1, and the plural note branch is
reachable only from a test). **A full target row's disabled STYLING is unpinned**
(no test in the game feature asserts a class string — house style), and
`promptKey` still omits `max` (pre-existing). **`GameLog` announces only a batch's
LAST row** — fifth slice running; Charizard's batch ends on `SHUFFLE`, so its three
attaches are silent. **Carried forward (pre-existing, NOT this slice):**
`legal_standard = 0` on most Trainers in the local ingest (58/67 Supporters, 26/29
Items, 9/11 Stadiums, 9/12 Tools); `GamePage`'s `passDisabled` phase check is
untested; Fighting Au Lait is still playable with nothing damaged anywhere;
`validateChoice` does not pin a multi-count pick to a single host; `handCostUnmet`
is not compositional across two costs in one program; the played Trainer sits UNDER
its own payment in the discard pile; **no test anywhere covers an onEvolve trigger
firing through Rare Candy** (Charizard ex is the first card where that path
matters, and it is correct by inspection only); and from D42 the attack epilogue
sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's own board is missed —
**do that before landing any self-damaging attack text** (sv01-038 Skeledirge is
one deriver sentence away).

---
### Prior resume point (P3-M5 §9.2 the op→op record, kept for continuity)
**(was)** **§9.2 op→op data flow is live (P3-M5, D48) — engine 0.28.0.** An op files the uids
it moved under a named `EffectSlot`; later ops read them through a `recordGate`
(Miriam's "in this way", Dendra's "if you do") or `discardPileRetrieval.exclude`
(Superior Energy Retrieval's "with the effect of this card"). 5 catalog rows. The
record rides `EffectContinuation`, is absent when empty, and is keyed by slot
rather than position. A parking op that records now states what its answer BUYS in
the prompt note — the web review's HIGH, and the first time a note was not the
whole printed effect.
**Next concrete actions:**
1. **Janine's Secret Art** (sv06.5-059/-088) is now the best-supported row on the
   board — two of its three pieces exist. "Choose **up to** 2 of your {D} Pokémon.
   For each of those Pokémon, search your deck for a Basic {D} Energy card and
   attach it to that Pokémon. Then, shuffle your deck. If you attached Energy to
   your Active Pokémon **in this way**, it is now Poisoned." The "in this way" is
   §9.2 (built), the "up to 2" is §9.1's other end (the prompt can express it,
   `min: 0`, and nothing uses it yet), and the genuinely new piece is a
   **per-target deck search** — neither `attachFromTop` (no window) nor
   `attachEnergyFrom` (the source is the deck, one search PER chosen Pokémon).
   Note it also needs the record to name a POKÉMON rather than a card, or a
   `recordGate` variant that asks "was the Active among them" — the first reader
   that wants more than "did anything move".
2. **The cheapest reader of "choose up to N Pokémon" alone: Saguaro**
   (sv02-187/-255/-270) — "Choose up to 2 of your Pokémon and heal 50 damage from
   each of them", which wants `healChosen` widened with a count rather than a new
   op.
3. **Ortega** (sv03-190/-219) — the same "in this way" gate over an OPPONENT-side
   pick from a hidden zone: "Your opponent reveals their hand, and you choose a
   card you find there and put it on the bottom of their deck. If you put a card
   on the bottom of your opponent's deck in this way, your opponent may draw a
   card." The gate exists; what does not is a prompt over a zone the ACTOR must be
   shown but does not own — and it is the first "your opponent **may**" (a decline
   belonging to the other seat).
4. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
5. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE, the third consumer (`passivesOf` takes no seat today).
6. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`
   (see below), D40's `stadium.owner` + `prizesRemaining` projection additions, and
   the engine-exported preview predicates the HUD needs.
**Recorded, NOT fixed (this slice):** **Miriam is playable into an empty discard**,
spending the turn's only Supporter for a bare deck shuffle, and **SER is playable
into a discard with no Basic Energy**, spending 2 cards for nothing. Both follow the
shipped doctrine (ruling/284 — a shuffle is an effect; SER matches ungated Energy
Retrieval exactly), but **Miriam is the first SUPPORTER on `discardPileRetrieval`**,
where a whiff costs the turn rather than a card — the prompt is the mitigation, not
the gate, and that asymmetry is the thing to revisit if a gate is ever added.
**`promptKey`'s `chooseCards` bounds are unpinned** (dropping `min`/`max` from the
key leaves the suite green) — unreachable today since hand and discard uids never
collide, but SER is the first shipped card to park TWICE on one prompt kind, so the
hole is now load-bearing for the next one. **The P4 `pendingDecision` leak is
UNCHANGED by this slice** (runtime-confirmed: the projection copies `phase.prompt`
only, so the record never crosses) — but `EffectContinuation.record` is the first
phase-persisted data naming cards by uid AFTER they moved, and a `payFromHand`
`to: "deckBottom"` with `recordAs` followed by a PARKING op would persist
hidden-zone uids inside the phase; no printed card reaches that shape, and P4's
filter must strip `cont` regardless. **`GameLog` announces only a batch's LAST
row** (fourth slice running) — Miriam is the worst-shaped batch yet (retrieve /
shuffle / draw) and the silenced row is the one saying what the card did.
**Every prompt note states only its OWN op** — `withConsequence` fixes the §9.2
case by scanning the queue, but a note builder still cannot see a `coinFlipGate` or
`conditionGate` around it. **Carried forward (pre-existing, NOT this slice):**
`legal_standard = 0` on most Trainers in the local ingest — **broader than
previously recorded**: it is not a Supporter-specific gap (58/67 Supporters, 26/29
Items, 9/11 Stadiums, 9/12 Tools); `GamePage`'s `passDisabled` phase check is
untested; Fighting Au Lait is still playable with nothing damaged anywhere;
`validateChoice` does not pin a multi-count pick to a single host; `handCostUnmet`
is not compositional across two costs in one program; the played Trainer sits UNDER
its own payment in the discard pile; and from D42 the attack epilogue sweeps ONE
seat, so a KO an attack inflicts on the ATTACKER's own board is missed — **do that
before landing any self-damaging attack text** (sv01-038 Skeledirge is one deriver
sentence away).

---
### Prior resume point (P3-M5 the FLOOR + the deck-bottom payment, kept for continuity)
**(was)** **The FLOOR + the deck-bottom payment are live (P3-M5, D47) — engine 0.27.0.**
`choosePokemonMulti` now carries `min`/`max` + `declinable`, so a printed "choose
1" is exactly one (Meowscarada ex / Radiant Blastoise can no longer pay an
irreversible cost and place nothing) and Hawlucha's "you may choose 2" is 2 or
none — parked at every non-empty Bench, since a "you may" has the same decision at
every Bench size (rules doc **§9.1**). `discardFromHandCost` is now **`payFromHand`
with a required `to`**: `"deckBottom"` lands **Dendra** ×3 (pay one card under the
deck, then draw to 5), and **Skwovet** ×2 reaches the same destination with the
whole hand through `handRefresh`'s existing riders — 5 catalog rows, one new field.
**Next concrete actions:**
1. **`EffectContext` op→op data flow** — now the highest-value mechanism left, and
   it closes TWO named deferrals at once: **Superior Energy Retrieval** ("(You
   can't choose a card you discarded with the effect of this card.)" — the cost's
   uids must reach the following `discardPileRetrieval`'s candidate set) and
   **Miriam** ("if you shuffled any cards into your deck in this way, draw 3" —
   `onlyIfAnyMoved`'s idea BETWEEN ops, across a park). It is also what "if you
   do" would need if a card ever made the payment optional (see below).
   `EffectContext` is already JSON and already survives a park inside
   `EffectContinuation`; what is missing is `stepOp` handing back an updated one.
2. **The other end of §9.1 — a printed "choose UP TO N Pokémon."** The prompt can
   express it (`min: 0`) and nothing uses it yet. Cheapest reader: **Saguaro**
   (sv02-187/-255/-270, Supporter) — "Choose up to 2 of your Pokémon and heal 50
   damage from each of them", which wants `healChosen` widened with a count rather
   than a new op; then **Janine's Secret Art** (sv06.5-059/-088), where each chosen
   Pokémon gets its own deck search.
3. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
4. **The last cheap reader of the D40 vocabulary: Defiance Band** — a conditional
   PASSIVE, the third consumer (`passivesOf` takes no seat today). Dendra, the
   other one, landed here as a §7.5 cost rather than a `BoardCondition`.
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`
   (**the leak is now hand uids for cards that never become public** — see below),
   D40's `stadium.owner` + `prizesRemaining` projection additions, and the
   **engine-exported preview predicates** the HUD needs (`handCostUnmet` /
   `handCostAction` are the two that exist; the Ability rows read them as of this
   slice).
**Recorded, NOT fixed (this slice):** the **P4 `pendingDecision` leak is now at its
worst shape** — the opponent's client receives the parked player's HAND uids for a
pick whose cards go to a **hidden** destination (Dendra's payment is never
revealed, unlike the discard family's), runtime-confirmed by the review; harmless
today (hot-seat, one caller, nothing crosses a wire) and the fix is the P4 gate
above. **`payFromHand` does not itself enforce "if you do"** — the ops after it run
even when nothing was paid; unreachable through Dendra (the gate refuses the play)
and the general fix is action #1. **The two play paths order their gates
differently**: `playTrainer` checks the hand cost before `programPlayable`,
`useAbility` after, so a doubly-illegal state yields `PLAY_CONDITION_NOT_MET` on one
and `NO_LEGAL_TARGET` on the other. **Skwovet on an empty hand logs "shuffled their
hand (0 cards) and put it on the bottom of their deck"** — inherited from Iono, and
now reachable once per turn per Skwovet. **`GameLog` announces only a batch's LAST
row** (third slice running); **the played Trainer sits UNDER its own payment in the
discard pile**; **`handCostUnmet` is not compositional** across two costs in one
program. **Carried forward (pre-existing, NOT this slice):** every authored
Supporter still has `legal_standard=0` in the local ingest; `GamePage`'s
`passDisabled` phase check is untested; Fighting Au Lait is still playable with
nothing damaged anywhere; `validateChoice` does not pin a multi-count pick to a
single host; and from D42 the attack epilogue sweeps ONE seat, so a KO an attack
inflicts on the ATTACKER's own board is missed — **do that before landing any
self-damaging attack text** (sv01-038 Skeledirge is one deriver sentence away).

---
### Prior resume point (P3-M5 discardFromHandCost, kept for continuity)
**(was)** **`discardFromHandCost` is live (P3-M5, D46) — engine 0.26.0.** The printed hand
COST, in both of its wordings — the Trainers' "You can use this card only if you
discard 2 **other** cards from your hand" (Ultra Ball, Earthen Vessel) and the
Abilities' "You **must** discard a card from your hand in order to use this
Ability" (Tinkaton, Revavroom, Meowscarada ex, Radiant Blastoise). It is the FIRST
op of its program because it PARKS, which is also what let it **absorb**
`AbilityProgram.cost`: that field could only express the fungible case, so it, its
finder and `ABILITY_COST_PAID` are gone and the row landed **9 catalog rows**.
"Other" is not a field — it is the played uid excluded in the gate, and the print
carries it exactly when the paying card is in hand. `chooseCards` grew a required
`min`; the gate **vetoes**, the mirror image of D45, because the card's own text
says so. §7.5.
**Next concrete actions:**
1. **"Choose 1" is not "up to 1" — give `choosePokemonMulti` a `min`** (the review
   found this and it is now the cheapest real rules fix on the board). Meowscarada
   ex / Radiant Blastoise print "put N damage counters on **1** of your opponent's
   Benched Pokémon", but the prompt allows `refs: []`, so a player can pay the
   Ability's mandatory Energy cost and then place nothing. Hawlucha genuinely IS
   "choose up to 2", so the op needs the distinction, not a blanket floor —
   exactly the widening this slice gave `chooseCards`. Pre-existing, but D46's
   irreversible cost is what makes it bite.
2. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
3. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one — and it now has a
   prompt shape to reuse: `chooseCards` with `min === max === 1`).
4. **The search-and-attach shape** — **Janine's Secret Art** (sv06.5-059/-088):
   "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck
   for a Basic {D} Energy and attach it." A per-target search, which is neither
   `attachFromTop` (no window) nor `attachEnergyFrom` (the source is the deck).
5. **`EffectContext` op→op data flow**, which closes **Superior Energy Retrieval**
   (the `discardFromHandCost` family's last row): "(You can't choose a card you
   discarded with the effect of this card.)" needs the cost's uids to reach the
   following `discardPileRetrieval`'s candidate set. `EffectContext` is already
   JSON and already survives a park inside `EffectContinuation`, so the shape
   exists; what is missing is `stepOp` being able to hand back an updated context.
6. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`
   (**now leaking HAND uids** — see below), D40's `stadium.owner` +
   `prizesRemaining` projection additions, and the **engine-exported preview
   predicates** the HUD needs (D46 exported the first two: `handCostUnmet` /
   `handCostPhrase`).
**Recorded, NOT fixed (this slice):** the **P4 `pendingDecision` leak got
qualitatively worse** — it now carries **hand** uids, the first prompt that does,
and the op's own "they land in the public discard" justification does NOT cover it:
with Ultra Ball three uids are named and only two ever become public, so the third
card's identity is given away permanently, and `candidates.length` against the
public hand-back count additionally leaks the hand's **duplicate structure** (the
interchangeable collapse is what makes that readable). Runtime-confirmed by the
review; harmless today (hot-seat, one caller, nothing crosses a wire) and the fix
is the P4 gate above. **`GameLog` announces only a batch's LAST row** — second
slice running: a COST is by construction never last, so Tinkaton's payment is
silent behind "drew 3 cards"; the fix is a batch summary. **The played Trainer
sits UNDER its own cost in the discard pile** (`playTrainer` discards up front, so
the pile reads `[Ultra Ball, paid1, paid2]` where paper produces the reverse) —
cosmetic today, and exactly the ordering Superior Energy Retrieval will care about.
**`handCostUnmet` is not compositional**: two cost ops in one program are each
checked against the same starting hand, so a hand that can pay one would pass and
the second would resolve free. No printed card charges twice; scoped in the doc.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; `GamePage`'s `passDisabled` phase check
is untested; Fighting Au Lait is still playable with nothing damaged anywhere;
`validateChoice` does not pin a multi-count pick to a single host; `usableAbilities`
is the only HUD button family with no playability gate (the Ability form of D46's
cost rides that same afford-then-reject path, deliberately, per D29); and from D42
the attack epilogue sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's
own board is missed — **do that before landing any self-damaging attack text**
(sv01-038 Skeledirge is one deriver sentence away).

---
### Prior resume point (P3-M5 attachFromTop, kept for continuity)
**`attachFromTop` is live (P3-M5, D45) — engine 0.25.0.** Look at the top N of
your deck and attach the Energy you find there onto your own Pokémon, "in any way
you like" — the first prompt whose answer is a **map** (card → Pokémon), landing
**Electric Generator** and **Hydreigon "Tri Howl"**. The leftovers clause splits
two ways on purpose: a shuffle is a following op, a **discard** is on the op, and
it is charged on the whiff and the decline too. The op is **ungated** — the review
proved a per-op `programPlayable` veto wrong for a card whose other printed clause
always resolves.
**Next concrete actions:**
1. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed "You can use this card only
   if…" wording but is NOT a `BoardCondition` — a COST with a card CHOICE, so it
   must PARK before the effect runs.
2. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
3. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one).
4. **The search-and-attach shape** — **Janine's Secret Art** (sv06.5-059/-088):
   "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck
   for a Basic {D} Energy and attach it." A per-target search, which is neither
   `attachFromTop` (no window) nor `attachEnergyFrom` (the source is the deck).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat`
   (the searchDeck / lookAtTopN / **attachCards** deck-uid leak — see below), D40's
   `stadium.owner` + `prizesRemaining` projection additions, and the
   **engine-exported preview predicates** the HUD needs.
**Recorded, NOT fixed (this slice):** the **P4 `pendingDecision` leak** now carries
a prompt whose unattached candidates go BACK into the deck and never become public
by any other route (unlike `DECK_TOP_REVEALED`'s, which are at least shuffled
away) — the P4 filter should know that. **`GameLog` announces only a batch's LAST
row**, and this is the first slice where that row is a pure COST while the benefit
is silent (Tri Howl ends in `DECK_TOP_DISCARDED`, Electric Generator in `SHUFFLE`,
so the attaches are never spoken); the fix is a batch summary, not a re-ordering.
**Tri Howl on an empty deck** burns its once-per-turn allowance with only an
`ABILITY_USED` row — consistent with "a look is always playable enough", and the
one place that doctrine could bend, since deck SIZE is public. **Dragonite VSTAR**
"Draconic Star" is the family's third member and stays unauthored: it needs a
two-type filter AND the **VSTAR Power once-per-GAME** rule, which is a per-player
allowance the engine has no vocabulary for (§15.J's allowances all reset per turn).
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; `GamePage`'s `passDisabled` phase check
is untested; Fighting Au Lait is still playable with nothing damaged anywhere;
`validateChoice` does not pin a multi-count pick to a single host; `usableAbilities`
is the only HUD button family with no playability gate; and from D42 the attack
epilogue sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's own board is
missed — **do that before landing any self-damaging attack text** (sv01-038
Skeledirge is one deriver sentence away).

---
### Prior resume point (P3-M5 the discardEnergy ATTACK arms, kept for continuity)
**The `discardEnergy` ATTACK arms are live (P3-M5, D43) — engine 0.23.0.** Two
extensions of one op, both derived, **11 catalog rows / zero registry rows**: the
opponent-side **twins** (bare + coin-gated, on the existing `opponentActive` arm)
and the **exact-N** self-discard (`count` widens from `"all"` to a number). The
prompt's `scope` is now `{kind:"total",count} | {kind:"each"}`; the interchangeable
collapse keeps **`count`** representatives per class rather than 1, and
`forcedDiscards` auto-resolves whenever the collapsed offer is ≤ count — one
comparison serving both the M1 no-choice rule and the new §8.6 "do as much as you
can". `validateChoice`'s one-per-Pokémon rule is now `"each"`-only; `opponentEach`
+ a numeric count is unrepresentable (`count?: never`). `ENERGY_DISCARDED` gained
**`host`** (the top-card uid): the log had been naming the host by SPOT, which an
attack twin breaks by stripping a defender its own damage Knocked Out in the same
batch.
**Next concrete actions:**
1. **The `providesEnergy` CardFilter — the ONE primitive that closes this family.**
   "An Energy that PROVIDES {X}", which is **NOT** `basicEnergy` + type: a Special
   Energy providing {L} counts and one providing {C} does not, so it must read
   `continuous.ts providedEnergy`'s model (an authored EnergyProgram's `provides`,
   the `ANY_ENERGY` wildcard, and `demoteWithOtherSpecial`, which is BOARD-dependent
   — the first filter whose answer depends on more than the card). Lands
   **Kilowattrel** ("a {L} Energy"), **Arcanine ex ×2** ("2 {R}" — typed AND
   exact-N, so it composes with this slice), **Charmeleon** / **Charizard** (the
   older spelled-out "a Fire Energy" / "all Fire Energy"), and its natural second
   consumer is `moveEnergy` for **Armarouge**'s benched→Active {R} — the D40
   two-consumers shape again.
2. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed "You can use this card only
   if…" wording but is NOT a `BoardCondition` — a COST with a card CHOICE, so it
   must PARK before the effect runs.
3. **The from-the-top attach variant** (Electric Generator / Hydreigon — also 2 of
   the remaining `attachEnergyFrom` cards).
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat` (the
   searchDeck deck-uid leak), and D40's `stadium.owner` + `prizesRemaining`
   projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; **`GameLog` announces only a batch's
LAST row** to screen readers — this slice sharpens the ranking of what gets
silenced (the swallowed row is now the one describing resource loss on the OTHER
player's board: an opponent-side discard is followed by TURN_ENDED or
KNOCKED_OUT/PRIZES_OWED, so it is never spoken); `GamePage`'s `passDisabled` phase
check is untested; and Fighting Au Lait is still playable with nothing damaged
anywhere. **Recorded, NOT fixed:** `validateChoice` does not pin a multi-count pick
to a single host, so a future "discard 2 Energy from 1 of your opponent's Pokémon"
(`opponentChosen` + count) would accept one Energy off each of two Pokémon —
unreachable today because the deriver is the sole author of a numeric count
(loudly commented in cardplay.ts). Also still open from D42: the attack epilogue
sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's own board is missed
— **do that before landing any self-damaging attack text** (sv01-038 Skeledirge is
one deriver sentence away, and widening to `SEATS` makes the §14 double-KO tie
guard reachable from the attack path for the first time).

---
### Prior resume point (P3-M5 attack programs can PARK, kept for continuity)
**Attack effect programs can PARK (P3-M5, D42) — the `attackEpilogue` stage.** The
top backlog row is done, and it is a MECHANISM, not a card family: every future
attack effect may now hold a decision. `attack.ts` used to run an attack's effect
program as `runProgram(...).state`, so a parked result dropped the prompt AND the
remaining ops. Now the tail is **queued before the program runs** — a new
`PendingStage` **`{kind:"attackEpilogue", seat, koedSeat}`** carrying the §8.1 KO
sweep + the §5.3 turn end — and the fold goes through `settleProgram`'s
**`resumeTail`**. `finishAttack` moved into flow.ts (exported) because `advance` must
reach it and attack.ts already imports flow.
**`resumeTail` now means "mid-TAIL", not "mid-KO-sweep"** — the stages that finish
the job are queued behind the park, so DONE means keep draining. Its two producers
differ only for the projection: an on-KO park's `phase.seat` is NOT the turn owner,
an attack park's IS, and `koParkActiveSeat` resolves both off the pending queue
(`attackEpilogue` joined `endTurn`/`checkup`/`resumeTurn` as an in-turn marker).
**The first family is DERIVED, so it costs no registry rows:** `discardEnergy`
gained **`from: "yourActive"`** (the controller's own Active — for an attack, the
printed "this Pokémon", §8) and **`count: "all"`**, and two anchored whole-sentence
deriver rules cover **12 catalog rows**: Houndoom (sv01-034, sv03-133), Charcadet,
Staraptor, Paldean Tauros, Dedenne ex (×2), Bombirdier; Pawmot (×2), Raichu (×2).
**Interchangeable candidates COLLAPSE** to one representative per (host, energy
identity) — a Houndoom attacking with three {R} asks nothing (the M1 no-choice
doctrine applied to card identity, via `attachEnergyFrom`'s fungibility precedent).
A **Basic** Energy's identity is what it PROVIDES, not its catalog id: the real
catalog prints Basic Fire Energy under sve-002/010/018, and an id key would park a
real deck on a non-choice. This also CHANGED D41's hammer arms (two copies of one
print on one Pokémon now auto-resolve — the improvement; three D41 tests moved to
two DISTINCT prints to keep testing a park). `ENERGY_DISCARDED` gained **`actor`**,
since victim and actor are the same seat for a self-discard and the log's old
`otherSeat` inference would have credited Houndoom's own cost to its opponent.
engineVersion 0.21.0 → **0.22.0**.
**Review (adversarial engine+rules + web+integration): NO HIGH from either.** 56
mutants, 9 survivors, ALL now dead. Fixes applied: the provision-vs-id key above; a
**`PHASE_DESYNC` guard** on `resolveEffect` for a `resumeTail` park with an EMPTY
queue (that fold writes no phase of its own, so it would loop forever);
`finishAttack` now **COMPOSES** with the queue instead of overwriting it, which makes
the epilogue's `popStage` load-bearing rather than redundant; the log row names the
host's **OWNER** (a mirror match printed an identical row for both boards, and a
pronoun cannot fix it — the `who` chip is viewer-relative while the segments are
fixed text); the dialog legend carries the `opponent` marker its sibling already
uses; `count:"all"` rows fold repeats into "×N"; and the effect:choose dialog is
keyed on the PROMPT so two parks in one turn cannot inherit a stale pick.
**Recorded, NOT fixed (loudly commented in flow.ts):** the epilogue sweeps ONE
seat, so a KO an attack inflicts on the ATTACKER's own board is missed. Unreachable
today, but **sv01-038 Skeledirge** ("This Pokémon also does 30 damage to itself.")
is one deriver sentence away — and widening it to `SEATS` makes the §14 double-KO
tie guard reachable from the attack path for the FIRST time, so it wants its own
slice with its own tests. **Do that before landing any self-damaging attack text.**
**Next concrete actions:**
1. **The opponent-side attack twins, now unblocked** — **Pincurchin**, **Gumshoos**
   ("Discard an Energy from your opponent's Active Pokémon") and **Dedenne /
   Maschiff / Tympole** (the same behind a coin flip). One deriver sentence each on
   the EXISTING `opponentActive` arm; the park machinery is already there. Cheapest
   remaining work in the whole family.
2. **The self-discard prints that need op vocabulary, not park work:** an
   **exact-N** discard (Corviknight "discard 2", Koraidon "discard 3", Arcanine ex,
   Sandaconda, Slither Wing — a mandatory park with an exact count > 1, which
   `validateChoice` already almost expresses) and an **energy-of-type** filter
   (Kilowattrel's "a {L} Energy" — careful: "{L}" means an Energy that PROVIDES {L},
   so Special Energy counts; it is not `basicEnergy` + type).
3. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed wording "You can use this card
   only if…" but is NOT a `BoardCondition` — a COST with a card CHOICE, so it must
   PARK before the effect runs.
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra** (a
   choose-from-hand → BOTTOM park, mandatory-exactly-one).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat` (the
   searchDeck deck-uid leak), and D40's `stadium.owner` + `prizesRemaining`
   projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; `GameLog` announces only a batch's LAST
row to screen readers, which this slice sharpens (a parked self-discard's row is
always followed by TURN_ENDED/TURN_STARTED/CARDS_DRAWN, so the discard is never
spoken); `GamePage`'s `passDisabled` phase check is untested; and Fighting Au Lait
is still playable with nothing damaged anywhere. **New INFO worth a decision later:**
during an attack park the KO sweep has not run, so a lethally-damaged defender is
briefly renderable — the damage chip shows "120/30". Transient and arguably
informative, but before this slice no such state was ever renderable.

---
### Prior resume point (P3-M5 discardEnergy, kept for continuity)
**`discardEnergy` is live (P3-M5, D41) — the energy-removal "hammer" family.** ONE op
takes Energy off the **OPPONENT's** in-play Pokémon, and **`from` names both the
eligible Pokémon and how many are hit**, spelled the way the cards are:
**`opponentActive`** (Mawile), **`opponentChosen`** (Crushing Hammer — "from 1 of your
opponent's Pokémon"), **`opponentEach`** (Giacomo — "from each of…", skipping any
Pokémon with no match, the "do as much as you can" rule). All three arms land with a
REAL printed card, so nothing in the vocabulary is speculative.
**Exactly one Energy per affected Pokémon — no `count` field**, because every printed
"discard 2 / discard all" variant is an ATTACK, and attacks cannot park (see below).
**`opponentChosen` is a ONE-step decision, not two:** since exactly one Energy comes
off, picking the Energy IS picking the Pokémon — so the prompt is a flat candidate list
with none of the source/destination coupling that made `moveEnergy` (D37) compound.
**The engine's FIRST mandatory park:** every prior parking op was "up to" (searchDeck /
discardPileRetrieval / lookAtTopN / moveEnergy) or exactly-one (choosePokemon); here the
only question is WHICH Energy, never whether, so `validateChoice` enforces an EXACT
count and an empty pick is an ERROR, not a decline. The two scopes fall out of two rules
plus a count (every uid offered and distinct, no Pokémon gives up two, total = 1 or the
number of distinct sources — "one each, none skipped" then follows by pigeonhole). New
**`specialEnergy`** CardFilter; one **`ENERGY_DISCARDED`** event per affected Pokémon
(`seat` names the VICTIM, the DAMAGE_DEALT convention); the card goes to its **OWNER's**
discard pile. Never damages, so it never KOs. engineVersion 0.20.0 → **0.21.0**.
**Web: one dialog, one log row, NO projection change** — every candidate is Energy
sitting face up on the table. `DiscardEnergyDialog` groups candidates by host, has no
decline button (mandatory), **pre-answers forced groups** (a single-candidate group is
not a question), and carries the SPOT in the group legend ("· Bench 1") because two
copies of one Basic would otherwise give identical legends over identical rows.
**Review (adversarial engine+rules + web+integration): no HIGH in the slice's own logic
from either — but the engine review REVERSED a documented decision of mine.** I had
shipped Crushing Hammer as playable into an Energy-LESS board, reasoning that
`programPlayable` scans top-level ops only and "the flip happens either way". That is
**wrong**: §7 "you cannot play a card if it has no valid target" (Compendium
[ruling/906](https://compendium.pokegym.net/ruling/906/), reconfirmed by the TPCi Rules
Team **2025-06-26**) covers it, because **a coin flip is PROCEDURE, not effect**. The
apparent counter-precedent (Unown-E's Hidden Power forcing all flips tails, yet flip
Trainers staying playable) is the OTHER branch of
[ruling/284](https://compendium.pokegym.net/ruling/284/): blocked by an EFFECT in play →
playable; blocked by the **game state** → not. So **`programPlayable` now DESCENDS into
`coinFlipGate.then`**, which also fixes a **PRE-EXISTING** bug the slice merely
inherited — **Pokémon Catcher** was likewise playable into an empty opponent Bench.
**Poké Ball is deliberately untouched** (a deck is not public knowledge, so "this search
will find nothing" is never a fact the state establishes — the ruling's own limit), and
the check is **not** extended to `conditionGate` (no printed card needs it, and doing it
properly means evaluating the condition and scanning only the arm that runs).
The engine agent's **45-mutant** run left 5 real survivors, ALL test-adequacy, all now
dead — notably `refKeyOf` dropping the bench index (two benched holders would FUSE into
one group and park instead of auto-resolving) and `!==` → `<` on the required count (in
scope "one" that would accept two Energy off two DIFFERENT Pokémon; only the exact count
catches it). The web agent's 3 MEDs are all fixed (log-row tone, `fieldset`/`legend`
grouping, six missing tests).
**Recorded, NOT fixed:** Mawile is the first "you **may**" trigger that cannot be
declined, because `discardEnergy` is the first MANDATORY parking op — every earlier
auto-fired optional trigger escaped through its own declinable op. Left as-is and
pinned: the auto-fire doctrine's justification is that such triggers are PURE UPSIDE,
and this one is (no sv01–03 Special Energy's loss helps its owner), so it costs a click;
the real fix is the trigger-level yes/no confirm the doctrine already contemplates.
**P4 item surfaced (pre-existing):** `projection.ts` returns `pendingDecision` for BOTH
viewers ungated on `phase.seat` — harmless here, but the sibling `chooseCards` prompt
built by `searchDeck` carries the controller's DECK uids.
**Next concrete actions:**
1. **Make attack effect programs able to PARK** — now the top backlog row, and the
   biggest remaining structural unlock (**~13 cards** in this very family). `attack.ts`
   runs an attack's program as `runProgram(...).state`, so a parked result silently
   drops the prompt AND the remaining ops. Blocks every "Discard an Energy from this
   Pokémon" attack (Houndoom ×2, Charcadet, Staraptor, Paldean Tauros, Dedenne ex,
   Bombirdier, Corviknight 2, Koraidon 3) and the opponent-side attack twins of Crushing
   Hammer (Pincurchin, Gumshoos + Dedenne / Maschiff / Tympole behind a flip). Known fix
   shape: seed `pending` with a new `attackEpilogue` stage and fold the park through
   `settleProgram`'s existing `resumeTail` path. Touches the §14 tie guard and the turn
   tail, so it wants its own careful slice. **Note the `attack?: EffectOp[]` registry
   seam is still UNUSED and is card-level, not per-attack — it needs keying by attack
   before a multi-attack Pokémon can use it.**
2. **Cheap and independent of that:** a **`count: "all"`** rider on `discardEnergy` +
   a `yourActive` `from` member lands **Pawmot** (sv01-076) and **Raichu** (sv02-064)
   ("Discard all Energy from this Pokémon") WITHOUT the park work — "all" has no
   decision, so those two attack programs never park.
3. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen Vessel /
   Revavroom / Tinkaton). Careful: it shares the printed wording "You can use this card
   only if…" but is NOT a `BoardCondition` — it is a COST with a card CHOICE, so it must
   PARK before the effect runs. A genuinely different shape from D40's gate.
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; note `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one — which `discardEnergy` has
   now set the precedent for).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games.
   Two concrete named jobs stand: gate `projection.ts`'s `pendingDecision` on
   `phase.seat` (the searchDeck deck-uid leak above), and D40's `stadium.owner` +
   `prizesRemaining` projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still has
`legal_standard=0` in the local ingest (in fact all 78 registry ids do, so Mawile being
out of Standard is not slice-specific); `GameLog` announces only a batch's LAST row to
screen readers, which a Giacomo sweep (several `ENERGY_DISCARDED` rows) makes sharper;
and Fighting Au Lait is still playable with nothing damaged anywhere.

---
### Prior resume point (P3-M5 board conditions, kept for continuity)
**Board conditions are live (P3-M5, D40) — one `BoardCondition` vocabulary, TWO
consumers.** The `conditionalPlay` family, built as a primitive instead of a per-card
flag. **`BoardCondition`** (effects.ts) is a predicate union evaluated for ONE seat —
**`morePrizesThanOpponent`** (strict `>`: you are BEHIND on Prizes taken),
**`yourStadiumInPlay`**, **`noEnergyOnYourPokemon`** (Active AND Bench, Basic or
Special) — behind a single evaluator **`conditionHolds`** and a printed-text describer
**`conditionNote`**. **The invariant IS the design: every member reads only PUBLIC
state**, which is exactly why **a gate emits no event** — contrast `coinFlipGate`,
whose flip is genuinely new information; a board condition is a fact both players can
read off the table, and the branch's own ops emit whatever happened.
**Consumer A — the printed PLAY GATE:** `CardProgram.trainerPlayableIf`, checked by
`playTrainer` BEFORE the card leaves hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`),
so a failed gate costs nothing. Categorically different from `programPlayable`'s
would-only-whiff heuristics: this is a rule PRINTED on the card. Named `trainer…`
because it is honoured on EXACTLY one path — `playStadium`/`rareCandy`/`attachTool`/
`useAbility` all return before it and would ignore it SILENTLY (the `trainerEndsTurn`
precedent; it is also why Luxray's Ability gate must NOT be authored here).
**Consumer B — the mid-program branch:** the **`conditionGate`** op
`{cond, then, otherwise?}`, spliced into runProgram's work queue exactly like
`coinFlipGate` (an op inside a branch can still park, and a branch may hold further
gates), evaluated against the board AS OF the gate. One-armed is the common shape
(Falkner); `otherwise` is the printed "…**instead**", a real if/ELSE (Grusha).
**One tiny new automatic op — `drawUntilHandSize`:** it DRAWS to a floor and never
TRIMS a bigger hand, and at a count ≤ 0 it no-ops with NO event (no misleading "drew 0
cards" row). Lands **3 COMPLETE real cards** (verified vs local D1): **Fighting Au
Lait** (sv02-181 — the gate + heal 60), **Falkner** (sv02-180/251 — two draw ops, not
one computed count, so the log shows both printed instructions), **Grusha**
(sv02-184/253/268 — the `otherwise` arm; its hand count is measured AFTER the Supporter
is discarded up front, the paper ruling for the hand-size family).
**Web: zero new events, prompts, dialogs or projection fields.** The one change is the
HUD greying a gated Trainer out with the engine's own `conditionHolds`, carrying
`conditionNote` as the row's `title` + an `sr-only` line — load-bearing copy, because
disabling the button REMOVES the reject pill that used to explain the printed rule.
engineVersion 0.19.0 → **0.20.0**.
**Review (adversarial engine+rules + web+integration): NO HIGH from either.** The
engine agent verified the slice's riskiest claim — **`yourStadiumInPlay` is OWNERSHIP,
not presence** — against the Japanese printing of ハヤト
(「場に**自分の**スタジアムが出ているなら」) and Bulbapedia; an opponent's Stadium must
not grant Falkner's +2. Its 24-mutant run left 5 survivors (1 equivalent), ALL
test-adequacy, all now fixed and re-verified dead with two new fixtures:
**fix-gateorder** (an attach BEFORE the gate that flips the condition, a two-op arm,
and an op AFTER the gate — one ordered `CARDS_DRAWN` assertion kills the
evaluate-against-entry-state, push-not-unshift and dropped-tail mutants at once) and
**fix-gatedsup** (the only gated SUPPORTER, pinning that a rejected gate does not burn
the §7.2 allowance). The web agent's 4 MEDs are all addressed: the missing
`engineVersion` bump; unpinned log rows (3 tests, incl. Falkner's PAIR of draw rows and
Grusha's zero-row case); a **self-defeating** doc claim that "a P4 client may evaluate
one locally"; and the HUD's opponent-`prizes` read.
**Recorded deviation (deliberate):** the HUD greys out a printed `trainerPlayableIf`
gate while `programPlayable`'s whiff gates (Boss's Orders into an empty Bench) stay
live and explain themselves via the reject pill — a rule printed on the card is
knowable before clicking, an engine whiff-judgement is not; the tooltip is what makes
the mixed standard coherent rather than a silent grey row.
**P4 item recorded (NOT fixed):** `conditionHolds` takes a `GameState`, so only a
raw-state host can run it — the projection does not carry `stadium.owner` and redacts
the prize arrays to counts. The sharp edge: **a redacted prize array still has a
`.length`**, so `morePrizesThanOpponent` would fail SILENTLY (not loudly) if shipped
online unchanged. See "M5 op-slice: board conditions as built" + D40.
**Next concrete actions:**
1. **`discardOpponentEnergy`** (Crushing Hammer / Giacomo / Klawf ex / Mawile, 4) or
   the **from-the-top attach** variant (Electric Generator / Hydreigon — which also
   closes 2 of the remaining `attachEnergyFrom` cards). Both are clean op slices.
2. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen Vessel,
   4). Careful: it shares the printed wording "You can use this card only if…" but is
   NOT a `BoardCondition` — it is a COST with a card CHOICE, so it must PARK. A
   genuinely different shape from D40's gate, despite reading the same on the card.
3. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer, gating `damageBonusBeforeWR` on
   `morePrizesThanOpponent`; note `passivesOf` takes no seat today, so it needs one) and
   **Dendra** (a choose-a-card-from-hand → BOTTOM park, mandatory-exactly-one — which
   means a `min` on the chooseCards prompt + hiding the dialog's decline button).
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games.
   D40 hands P4 two concrete, named jobs: add `stadium.owner` (or `mine`) to the
   projection and route the prize comparison through `prizesRemaining`, plus the
   standing deck-candidate INFO (searchDeck/lookAtTopN `pendingDecision.prompt`).
**Carried forward (pre-existing, NOT this slice):** Fighting Au Lait is playable with
nothing damaged anywhere (the Potion shape — `programPlayable` treats heal as "playable
enough"), which this slice makes conspicuous by enforcing the card's printed legality
line; `GameLog` announces only the batch's LAST row to screen readers, and a Falkner
drawing 4 sharpens it (it announces "drew 2 cards", understating the play — and an
unchanged live region announces nothing, so a second Falkner is silent); and every
authored Supporter still has `legal_standard=0` in the local ingest.

---
### Prior resume point (P3-M5 Iono, kept for continuity)
**Iono is live (P3-M5, D39) — the hand-refresh Supporter family is CLOSED.** The
format's highest-play-rate Supporter needed **no new op**: three composable riders on
the D38 `handRefresh` op. **`toBottom?: true`** — the PLACEMENT: shuffle the **hand
alone** and append it UNDER the deck (`[...deck, ...shuffle(hand)]`) instead of
shuffling it into the deck, so the deck's existing order — and therefore the very next
draws — SURVIVE (the whole strategic point of Iono over Judge; pinned by a test
asserting the drawn cards are EXACTLY the pre-play deck top, in order).
**`draw:{kind:"prizeCount"}`** — each affected player draws their OWN remaining Prize
count (the player behind draws more); a Prize count is public, so the draw size leaks
nothing. **`onlyIfAnyMoved?: true`** — the draw clause fires only if ≥1 affected player
actually moved ≥1 card: an **all-or-nothing gate ACROSS the seats** ("if EITHER
player…"), not per-seat. That gate forced the op's one structural change: **two passes**
over the affected seats (all placements, then all draws) instead of D38's interleaved
move-then-draw — **behaviour-preserving** for Youngster/Judge/Brassius/Katy (per-seat
disjoint zones + `drawToHand` consumes NO rng ⇒ byte-identical states and rng threading,
verified by reconstructing the old loop and diffing at 3 seeds each); the only change is
Judge's event INTERLEAVING (SHUFFLED p1, SHUFFLED p2, DRAWN p1, DRAWN p2 — which also
reads truer to the printed sentence). `shuffle` consumes nothing for a length ≤ 1 input,
so an Iono into two empty hands advances the rng ZERO times. One new count-only event
**`HAND_TO_BOTTOM_OF_DECK {seat, count}`** — distinct from its sibling because the public
fact differs (the deck's order is untouched, which both players must be able to read off
the log). **Web: one log row, no dialog** (never parks, no projection change) — "shuffled
their hand (N cards) and put it on the bottom of their deck": it must say BOTH verbs,
since the hand IS randomized on its way under an unshuffled deck. Lands **Iono**
(sv02-185/254/269, verified vs local D1). engine 0.18.0 → **0.19.0**.
**Review (adversarial engine+rules + web+integration): no HIGH; 2 MED, both FIXED.** The
engine MED was found by **mutation testing** — deleting the hand shuffle left all 379
engine tests green (every bottom assertion was order-insensitive; nothing asserted
`rngState`) → added `.not.toEqual(handOrder)` + `rngState` assertions on both the
shuffled and the zero-randomness paths; the mutant now dies. The web MED (raised
independently by BOTH agents) was the log copy implying Iono does NOT shuffle → fixed.
LOWs applied: an Iono degenerate-deck test (deck shallower than the Prize count
short-draws, no deck-out), a describe rename, and a real end-to-end log test pinning the
grouped 5-row batch. **Deliberate deviation (recorded in D39, not accidental):** Iono
with EVERY affected hand empty is a total no-op yet stays LEGAL (no `programPlayable`
gate, unlike gust/switch/attach/moveEnergy) — the digital clients allow it, it cannot
soft-lock, and a gate would have to reach into "playTrainer discards the played card up
front" (the D35 leaky coupling). **The family is CLOSED** — no Marnie in the sv01–03
catalog. See "M5 op-slice: handRefresh riders as built" + D39.
**Next concrete actions (keep building the backlog):**
1. **The `conditionalPlay` / board-condition gate family** (5 backlog cards) — and the
   same primitive also unlocks **Falkner** ("if you have a Stadium in play, draw 2
   more") and, with a `drawUntilHandSize` op, **Grusha**. The biggest remaining cluster.
2. **The remaining `moveEnergy` cards** each layer a rider: **Armarouge** "Fire Off" (a
   {R} Energy benched→Active — fixed-endpoint + provided-type filter, an Ability),
   **Mismagius** "Magical Flick" (the OPPONENT's Energy on evolve — opponent-side +
   onEvolve trigger), **Exp. Share** (an on-KO Tool trigger).
3. **The from-the-top attach variant** (Electric Generator / Hydreigon) — also closes 2
   of the remaining `attachEnergyFrom` cards — or **`discardOpponentEnergy`** (Crushing
   Hammer / Giacomo, 4). See `docs/reference/coverage-backlog.md`.
4. **Miriam** is the near-miss worth naming: its "if you shuffled any cards in this way,
   draw 3" is `onlyIfAnyMoved`'s idea but BETWEEN ops and across a park — it needs an
   op-result threaded through the interpreter's continuation, not a flag. Deferred.
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games;
   the projection is already P4's per-viewer filter, and the standing deck-candidate
   INFO (searchDeck/lookAtTopN `pendingDecision.prompt`) is exactly what its server-side
   redaction must cover. Iono, like the rest of handRefresh, needs none of it.
**Two pre-existing items the review surfaced (NOT this slice):** every authored
Supporter has `legal_standard=0` in the local ingest, so none surface in the builder's
default standard-legal search; and `GameLog` announces only the last entry to screen
readers, so a 5-row batch is mostly silent (P5 polish).

---
### Prior resume point (P3-M5 handRefresh, kept for continuity)
**`handRefresh` is live (P3-M5, D38) — shuffle your hand into your deck, then draw.**
The Iono/Judge/Marnie hand-refresh Supporter family. New op `{who:"you"|"both", draw}`
— the FIRST op in a new class: **fully AUTOMATIC** (no decision → it NEVER parks, like
drawCards/discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`,
Judge — the first op to reach the OPPONENT's hand/deck). Per affected seat (controller
first, then — for `both` — the opponent) it captures the PRE-shuffle hand size, moves
the whole hand into the deck, shuffles the combined pile (`shuffle([...deck, ...hand])`
— one rng advance, threaded fresh each iteration so the two-shuffle Judge has no stale
reuse), then draws per **`HandRefreshDraw`**: `{fixed count}` (Youngster 5, Judge 4,
Katy 8) or `{handPlus delta}` (Brassius "draw that many cards plus 1"). **Card
conservation** is a pure multiset move (`[...deck, ...hand]` → shuffle → draw back),
invariant under empty-hand / empty-deck / hand==whole-deck / both-empty; the Supporter
is discarded UP FRONT, so never shuffled back. **Always playable** (no `programPlayable`
gate); never damages/KOs. **Katy "your turn ends"** lands the `endsTurn` fold on the
TRAINER path — a new CardProgram flag **`trainerEndsTurn`** that `playTrainer` passes
to `settleProgram`, folded byte-for-byte like Koraidon's `AbilityProgram.endsTurn`
(D34); every non-Katy trainer passes `endsTurn:false` (byte-identical, no regression).
One new count-only event **`HAND_SHUFFLED_INTO_DECK {seat, count}`** (the deck reorder
is intrinsic — no separate `SHUFFLE`). Lands **4 COMPLETE real Supporters** (verified
vs local D1): **Youngster** (sv01-198, draw 5), **Judge** (sv01-176, both draw 4),
**Brassius** (sv03-187, draw hand+1), **Katy** (sv01-177/237, draw 8 + turn ends).
**Web: one log row, no dialog** — handRefresh never parks, so no new `EffectPrompt`/
dialog (GameHud untouched); one count-only `HAND_SHUFFLED_INTO_DECK` row, the draw
riding the existing count-only `CARDS_DRAWN`. **Hidden info (Judge — the first op to
touch the opponent's hand): leaks NOTHING new** — the opponent's `CARDS_DRAWN` uids are
the standard `drawToHand` contract; the log arms are count-only and the projection
already redacts the opponent's hand to uid-less backs. engine 0.17.0 → **0.18.0**.
**Adversarial review (engine+rules + web+integration): BOTH CLEAN — no HIGH/MED, NO
code fixes** (card conservation over all four degenerate zone states, two-shuffle rng
threading, handPlus timing, the Katy endsTurn fold with no regression across the full
374-test engine suite, purity against a recursive freeze, all four texts byte-matching
the catalog / no missed reprint, Judge hidden-info safe on both log + projection). INFO
(both, not bugs): an empty hand emits `count:0` (honest, non-leaky — the `HAND_DISCARDED
"(0 cards)"` precedent); the no-separate-`SHUFFLE`-event choice is cosmetic with no
consumer. Closes the `shuffleHandIntoDeck` + `endTurn` backlog rows. See "M5 op-slice:
handRefresh as built" + D38.
**Next concrete actions (keep building the backlog):**
1. **Iono / Marnie** layer on this primitive: they put the hand on the BOTTOM of the
   deck (not shuffle) and draw by Prize count (Iono) / an asymmetric split (Marnie —
   you 5, opponent 4) — a bottom-of-deck move + a `prizeCount`/split `HandRefreshDraw`.
   High play rate; small additions on `handRefresh`.
2. **The remaining `moveEnergy` cards** each layer a rider: **Armarouge** "Fire Off" (a
   {R} Energy benched→Active — fixed-endpoint + provided-type filter, an Ability),
   **Mismagius** "Magical Flick" (the OPPONENT's Energy on evolve — opponent-side +
   onEvolve trigger), **Exp. Share** (an on-KO Tool trigger).
3. **The next backlog op by unlock count** — the **`conditionalPlay`** family (5, a
   "you can use this only if <board condition>" gate — but each card still needs its
   effect op too), a **from-the-top attach** variant (Electric Generator / Hydreigon,
   also 2 `attachEnergyFrom` cards), or **`discardOpponentEnergy`** (Crushing Hammer /
   Giacomo, 4). See `docs/reference/coverage-backlog.md`.
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games;
   the projection is already P4's per-viewer filter, and the deck-candidate INFO
   (searchDeck/lookAtTopN) is exactly what its server-side redaction must cover
   (`pendingDecision.prompt`) — `handRefresh`'s all-count-only events need none.

---
### Prior resume point (P3-M5 moveEnergy, kept for continuity)
**`moveEnergy` is live (P3-M5, D37) — move Energy between your own Pokémon.** A new
op `{filter, max}` moves up to `max` Energy from ONE of the controller's own in-play
Pokémon to ANOTHER — the interpreter's **first op with two COUPLED decisions** (which
Energy AND where). Unlike every prior op (which reused one existing prompt), it adds a
**new compound prompt** `moveEnergy` (`movable`: each takeable Energy uid tagged with
its source `PokemonRef`; `destinations`: all own in-play refs) and a **new choice**
`{uids, dest}` answering both at once, applied **ATOMICALLY** by `moveEnergyApply`
(strip the picks off their source, append to the dest in one `withSide` — a floating
detached-Energy state never exists, which is why it is one compound park not two).
"Up to"/declinable; always parks when playable. **`validateChoice`** enforces the
couplings (each uid an offered `movable`, distinct, ALL sharing ONE source, dest
offered, **dest ≠ source**), so no illegal wire move applies; `moveEnergyApply`
conserves cards and is pure. New **`programPlayable` gate** (`moveEnergyPlayable`: ≥1
matching Energy AND ≥2 of your Pokémon in play) = the exact complement of stepOp's
no-op (no wasted card, no soft-lock). One new `CardFilter` **`anyEnergy`** (Basic OR
Special) + one new event `ENERGY_MOVED {seat, uids, from, to}`. Lands **Energy
Switch** (sv01-173) and **Poppy** (sv03-193/220/227) — 2 of the op's 5 backlog cards.
**Web:** `MoveEnergyDialog` (a staged pick, or **Move none**) + one `ENERGY_MOVED` log
row; the prompt leaks NOTHING (own face-up in-play Energy/Pokémon). engine 0.16.0 →
**0.17.0**. Review (adversarial engine+rules + web + an independent Opus pass): CLEAN —
no HIGH/MED; one action (a two-source Poppy DOM test). See "M5 op-slice: moveEnergy as
built" + D37.

---
### Prior resume point (P3-M5 lookAtTopN, kept for continuity)
**`lookAtTopN` is live (P3-M5, D36) — the deck-top look family.** The top-of-deck
twin of `searchDeck`: a new op `{n, filter, max}` looks at the top `n` cards of the
controller's deck and puts up to `max` matching `filter` into their HAND, "up to"/
declinable, reusing the `chooseCards` park (no new prompt/dialog/wire shape). The
candidates are ONLY the `filter` matches among the **top `n`** (never a deeper
card — `validateChoice`'s "picks ⊆ candidates" guards the window); "Shuffle the
other cards back" is the trailing `shuffleDeck` op (the Nest Ball pattern, so a
whiff or a decline still shuffles). New mover `revealFromTop` + one new event
`DECK_TOP_REVEALED` (count-only log). **No new `CardFilter`** (Great Ball reuses
`anyPokemon`, Pokégear reuses `supporter` from D35); **no `programPlayable` gate**.
Lands **Great Ball** (sv02-183 — top 7 → a Pokémon) and **Pokégear 3.0** (sv01-186
— top 7 → a Supporter) — 2 of the op's 5 backlog cards. **Web (small):** one
`DECK_TOP_REVEALED` log row; the shared origin-agnostic `ChooseCardsDialog` (D35)
renders the accurate `prompt.note` and the projection is unchanged. engine 0.15.0 →
**0.16.0**. **Review (2 Opus agents): BOTH CLEAN — no HIGH/MED, NO code fixes**
(card conservation, window boundary, wire-safety, shuffle-always-fires, no flow-tail
interaction, purity, log honesty all proven). INFO (both, pre-existing P4 deferral):
the parked prompt carries the top-`n` candidate uids unredacted per-viewer — same as
`searchDeck`, unobservable in hot-seat, the P4 filter's job. See "M5 op-slice:
lookAtTopN as built" + D36.

---
### Prior resume point (P3-M5 discardPileRetrieval, kept for continuity)
**`discardPileRetrieval` is live (P3-M5, D35) — the recovery-Item family.** The
discard-pile mirror of `searchDeck`: a new op `{filter, dest:"hand"|"deck", max}`
retrieves up to `max` matching cards from the controller's discard pile, "up to"/
declinable, reusing the `chooseCards` park (no new prompt/dialog/wire shape). Two
new `CardFilter` kinds (`supporter`, `pokemonOrBasicEnergy`); `dest:"deck"` +
trailing `shuffleDeck` is the "shuffle into your deck" idiom (whiff still shuffles,
per the searchDeck convention); new event `DISCARD_RETRIEVED` (count-only log).
Lands **Energy Retrieval** (sv01-171), **Pal Pad** (sv01-182), **Super Rod**
(sv02-188/276) — 3 of the op's 6 backlog cards. **Web touched (small):** dialog
label "Search your deck" → "Choose cards" (shared by both origins now; note carries
the specifics), `chooseCards` prompt `dest` += "deck", one log row. engine 0.14.0 →
**0.15.0**. **Review (2 Opus agents): BOTH CLEAN** — no HIGH/MED bugs; MED
test-adequacy fix (purity test now hits `retrieveMove`) + LOW coverage/comment
fixes applied. INFO: a FUTURE self-matching card (a Supporter authored on this op
with `filter:supporter`) would offer itself as a candidate since `playTrainer`
discards up front — flagged in the op's authoring note; the 3 Items are safe. See
"M5 op-slice: discardPileRetrieval as built" + D35.
**Next concrete actions (keep building the backlog):**
1. **The next backlog op by unlock count** — **`lookAtTopN`** (5 — Great Ball,
   Pokégear 3.0, Electric Generator, Hydreigon, Malamar; also unblocks 2 of the
   remaining `attachEnergyFrom` cards), **`moveEnergy`** (5 — Energy Switch, Exp.
   Share, Poppy…), the **`conditionalPlay`** family (5), or the **hand-refresh
   Supporter family** (Iono/Judge/Marnie — `shuffleHandIntoDeck` + draw). See
   `docs/reference/coverage-backlog.md`.
2. Or the remaining `attachEnergyFrom` cards via a **deck-search-attach** source op
   (Forretress/Charizard/Geeta/Pawmot — each also needs a per-card rider: self-KO,
   onEvolve, can't-attack, attach-to-self).
3. Or the remaining 3 `discardPileRetrieval` cards — Superior Energy Retrieval
   (`discardFromHandCost`), Miriam (conditional "if you shuffled any, draw 3"),
   Pelipper (an Ability).
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games; the projection is already P4's per-viewer filter.

---
### Prior resume point (P3-M5 attachEnergyFrom multi + endsTurn, kept for continuity)
**Koraidon ex "Dino Cry" is live (P3-M5, D34) — attachEnergyFrom MULTI-attach +
endsTurn.** Three ideas: **multi-attach** ("attach up to N in any way") needs NO
new op — it is **N `attachEnergyFrom` ops** in one program (the interpreter parks
on each op's target in turn; a later op with no matching Energy no-ops → attaches
min(N, available), auto-maxed); a **`basicOnly`** target-filter rider (target must
be `isBasicPokemon`, with `targetType` → "your Basic {F} Pokémon"); and
**`AbilityProgram.endsTurn`** — a flag that ENDS the controller's turn on program
completion, folded by **`settleProgram`** (flow.ts: DONE seeds `turnTail(controller)`
+ advance — the normal `endTurn` shape — instead of turn:action), threaded across
re-parks by a new `endsTurn?: true` on the effect:choose Phase (parallel to
`resumeTail`, mutually exclusive). engine 0.13.0 → **0.14.0**. **Review (2 Opus
agents): BOTH CLEAN.** See "M5 op-slice: attachEnergyFrom multi + endsTurn as
built" + D34.

---
### Prior resume point (P3-M5 attachEnergyFrom riders, kept for continuity)
**Gardevoir ex "Psychic Embrace" is live (D33) — the attachEnergyFrom RIDERS.**
The D32 attach op grew three composable riders on `attachEnergyFrom`:
**`targetType`** (eligible targets = the controller's own Pokémon whose top card
is that type — {P}), **`bonusCounters`** (put N HP of counters on the just-
attached Pokémon — 2 = 20, as COUNTERS_PLACED "ability"), **`notIfKO`** (exclude
any target the counters would Knock Out — `damage + bonusCounters ≥ effectiveMaxHp`,
so the counters are ALWAYS non-lethal → the op still never KOs). The filtered
candidates live in a new exported **`attachEnergyTargets`** (interpreter.ts),
shared by the park AND `programPlayable` (now also rejecting when no eligible
target remains). Gardevoir ex (sv01-086/228/245): `{attachEnergyFrom,
source:"discard", energyType:"Psychic", targetType:"Psychic", bonusCounters:20,
notIfKO:true}`, `oncePerTurn:false` (repeatable). **Web UNCHANGED** (reuses
choosePokemon + ENERGY_ATTACHED + the COUNTERS_PLACED "ability" row + the damage
chip). engine 0.12.0 → **0.13.0**. **Review (2 Opus agents): BOTH CLEAN** — the
notIfKO non-lethal guarantee proven airtight (a basic-energy attach can't shift
damage/effectiveMaxHp between park and apply; settleProgram's sweep is a safety
net anyway), no base-op regression, wire-safety, purity; reuse verified through
the real HUD; one LOW (a stale log comment) fixed. Suite 1095 → **1101**; check +
build green. See "M5 op-slice: attachEnergyFrom riders as built" + D33.
**Next concrete actions (keep building the backlog):**
1. **The remaining `attachEnergyFrom` cards (8 of 11)** — each needs a MORE than
   the single-attach+riders: **multi-attach** ("up to N in any way" — Koraidon,
   Forretress, Charizard, Geeta, Electric Generator, Hydreigon), a **deck-search
   source** (Forretress, Charizard, Geeta, Pawmot), **`lookAtTopN`** (Electric
   Generator, Hydreigon), plus per-card riders ("your turn ends" Koraidon, self-KO
   Forretress, `onEvolve` Charizard ex, "can't attack this turn" Geeta,
   attach-to-self Pawmot [needs the source uid in EffectContext], special-energy-
   by-name Wigglytuff). Pick one op (multi-attach is the biggest shared one).
2. Or the next backlog op by unlock count — **`discardPileRetrieval`** (6),
   **`lookAtTopN`** (5), **`moveEnergy`** (5), the **`conditionalPlay`** family (5),
   or the **hand-refresh Supporter family** (Iono/Judge/Marnie). See
   `docs/reference/coverage-backlog.md`.
3. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games; the projection is already P4's per-viewer filter.

---
### Prior resume point (P3-M5 op-slice `attachEnergyFrom`, kept for continuity)
**`attachEnergyFrom` is live (D32) — the first backlog op.** A new interpreter op
attaches ONE Basic Energy from the controller's hand or discard pile onto a CHOSEN
own Pokémon (§6), reusing the choosePokemon park + ENERGY_ATTACHED. Same-type
Basic Energy is fungible → the only decision is the TARGET. Representatives
Quaquaval (any Basic from hand, once/turn) + Baxcalibur ({W} from hand, repeatable)
+ a fixture for the discard branch. Web unchanged. engine 0.11.0 → 0.12.0; both
Opus reviews clean. One INFO: `programPlayable` runs before an ability cost is
paid (unreachable today). See D32.

---
### Prior resume point (P3-M5 coverage pass #1, kept for continuity)
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
| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (M4: D22–D30, evolution→on-KO triggers; **M5**: pass #1 = a classify→verify Workflow fan-out landed 5 existing-op cards + the ranked new-op backlog in `docs/reference/coverage-backlog.md`; **op-slice D32 = `attachEnergyFrom`** (engine 0.12.0) + **D33 = its riders** (Gardevoir ex, 0.13.0) + **D34 = multi-attach + endsTurn** (Koraidon ex, 0.14.0), 4 of its 11 cards; **D35 = `discardPileRetrieval`** (the searchDeck mirror — Energy Retrieval / Pal Pad / Super Rod, engine 0.15.0, 3 of 6 cards) + **D36 = `lookAtTopN`** (the searchDeck deck-top twin — Great Ball / Pokégear 3.0, engine 0.16.0, 2 of 5 cards) + **D37 = `moveEnergy`** (move Energy own→own — the first compound-park op; Energy Switch / Poppy, engine 0.17.0, 2 of 5 cards) + **D38 = `handRefresh`** (shuffle your hand into your deck, then draw — the first fully-automatic op that can affect the OPPONENT; Youngster / Judge / Brassius / Katy, engine 0.18.0 — closes the `shuffleHandIntoDeck` + `endTurn` backlog rows) + **D39 = its Iono riders** (`toBottom` so the deck's ORDER survives + a `prizeCount` draw + the cross-seat `onlyIfAnyMoved` gate; engine 0.19.0 — **CLOSES the hand-refresh family**, no Marnie in sv01–03) + **D40 = board conditions** (one `BoardCondition` vocabulary with TWO consumers — the `trainerPlayableIf` PLAY gate and the `conditionGate` branch op — plus `drawUntilHandSize`; Fighting Au Lait / Falkner / Grusha, engine 0.20.0 — the `conditionalPlay` PRIMITIVE is done, though each remaining gated card needs a second missing piece) + **D41 = `discardEnergy`** (the energy-removal "hammer" family — ONE op whose `from` names both the eligible Pokémon and how many are hit: `opponentActive`/`opponentChosen`/`opponentEach`, all three landing with a real card — Crushing Hammer / Giacomo / Mawile, engine 0.21.0, 3 of the row's 4; the engine's FIRST mandatory park, plus the coin-gate playability fix: `programPlayable` now descends into `coinFlipGate.then`, which also fixed PRE-EXISTING Pokémon Catcher) + **D42 = attack effect programs can PARK** (the `attackEpilogue` PendingStage carries the §8.1 KO sweep + §5.3 turn end, seeded BEFORE the effect program and folded through `settleProgram`'s `resumeTail` — a MECHANISM, not a card family; its first readers are the §8 self-discard cost via `discardEnergy`'s `yourActive` arm + `count:"all"`, 12 catalog rows all DERIVED, engine 0.22.0) + **D43 = the `discardEnergy` ATTACK arms** (the opponent-side twins on the existing `opponentActive` arm, bare + coin-gated — Pincurchin / Gumshoos / Dragonite V ×2 / Dedenne / Maschiff / Tympole / Yveltal — and the exact-N `count` — Corviknight / Slither Wing / Koraidon: 11 more rows, again ZERO registry rows; the collapse is now CAPPED at `count` per class, and `forcedDiscards` folds the short board into the same comparison as the no-choice rule, i.e. the new §8.6 "do as much as you can"; engine 0.23.0) + **D44 = the `providesEnergy` CardFilter** ("an Energy that PROVIDES {X}" — the first filter a CARD alone cannot answer, since provision is a while-ATTACHED property that Luminous makes depend on the holder's other attachments; read by TWO ops through one `unitsOf` shared with §8.2's cost matcher, so what can PAY a {L} cost is exactly what a "{L} Energy" effect can take: the DERIVED typed self-discard in both printed notations (5 rows, zero registry rows) and `moveEnergy`'s `benchToActive` route (Armarouge); §6.5, engine 0.24.0 — the energy-removal family is now FILTER-COMPLETE) + **D45 = `attachFromTop`** (look at the top N of your deck and attach the Energy you find there onto your own Pokémon, "in any way you like" — the first prompt whose answer is a MAP, card → Pokémon; Electric Generator / Hydreigon "Tri Howl", the two differing in every rider the op has, and the leftovers clause splitting two ways on purpose — a shuffle is a following op, a DISCARD is on the op and is charged on the whiff and the decline too; the review REMOVED the draft's play gate, since `programPlayable` is an AND over ops and would veto a card whose other printed clause always resolves; §15.E, engine 0.25.0) + **D46 = `discardFromHandCost`** (the printed hand COST that PARKS — two printed wordings, one mechanism, and the wording tracks WHERE THE PAYING CARD SITS: Trainers say "only if you discard 2 **other** cards from your hand" because the card is in the hand it pays from, Abilities say "you **must** discard … in order to use this Ability" and never say "other" because the card is on the board, exactly across the catalog — so "other" is not a field but the played uid excluded in the GATE. It is the FIRST op of its program because the payment can park, which is also what let it ABSORB `AbilityProgram.cost`: that field could only express the fungible case, so it, `findAbilityCostCard` and `ABILITY_COST_PAID` are gone and Meowscarada ex migrated — Ultra Ball / Earthen Vessel / Revavroom / Tinkaton / Radiant Blastoise + Meowscarada, **9 catalog rows**. `chooseCards` grew a required `min` (the first MANDATORY card park; every printed "up to" declares 0) and a `"discard"` dest; the gate VETOES, the mirror image of D45, because the card's own text states a precondition where D45's would have been the engine guessing a whiff. §7.5, engine 0.26.0) + **D47 = the printed number is a FLOOR, and the hand cost that is NOT a discard** (`choosePokemonMulti` gained `min`/`max` + `declinable` — a printed "choose 1" is exactly one, so Meowscarada ex / Radiant Blastoise can no longer pay an irreversible cost and place nothing, while Hawlucha's "you may choose 2" is 2-or-none at EVERY non-empty Bench; rules doc §9.1. And `discardFromHandCost` became **`payFromHand`** with a required `to`: `"deckBottom"` lands **Dendra** ×3 — the payment that discards nothing yet carries every clause of the §7.5 mechanism, gate and "other" included — while **Skwovet** ×2 reaches the same destination with the WHOLE hand for zero new ops (`handRefresh` + Iono's riders). `HAND_COST_PAID` and the prompt both carry the destination, because the event follows what stays VISIBLE; engine 0.27.0) + **D48 = the §9.2 op→op record** (an op files the uids it MOVED under a named `EffectSlot` and later ops of the SAME card read them — the `recordGate` ("in this way" / "if you do") + `discardPileRetrieval.exclude` ("with the effect of this card"); Miriam ×3 / Superior Energy Retrieval ×2 / Dendra's own conditional; the record rides `EffectContinuation` keyed by SLOT, absent when empty; engine 0.28.0) + **D49 = `attachFromDeck`** (SEARCH the deck for Energy and attach straight onto your own Pokémon — the deck-search sibling of `attachFromTop` sharing its `attachCards` MAP prompt; the whole-deck offer COLLAPSES to `max` per interchangeable class, and the two printed target rules are "in any way you like" = no rider vs "for each of those Pokémon" = `maxPerTarget: 1` — Charizard ex ×4 (onEvolve) / Janine's Secret Art ×2, whose self-poison is `recordGate.contains: "yourActive"`, a §9.2 gate asking WHERE rather than whether; engine 0.29.0) + **D50 = `EffectContext.sourceUid`** (the printed "this Pokémon" — the context names the running effect's Pokémon by top-card uid at every site that knows it, ABSENT for Trainers; first reader `attachFromDeck.toSelf` lands Pawmot ×2 "Electrogenesis", a BENCHED Pawmot feeding itself; resolution by board TOP uid, evolved-over = whiff; engine 0.30.0) + **D51 = `healChosen.upTo`** (the printed "up to N … each" heal — the first `choosePokemonMulti` with `min ≠ max`, §9.1's min: 0 end, §8.6 clamping both the ask and the heading; Saguaro ×3, engine 0.31.0, ZERO web source changes) + **D52 = the reveal-and-bottom family + the OPPONENT's own decision** (two ops. `bottomFromOpponentHand` reveals the opponent's WHOLE hand — a new PUBLIC `HAND_REVEALED` naming every uid, the one hand event that is not count-only, because a reveal is exactly when those cards stop being hidden — then bottoms a chosen card onto THEIR deck, NAMED, since unlike Dendra's payment that move happened face up at both ends; its offer collapses per interchangeable class, sound here precisely where it is not in `payFromHand`. And `opponentMayDraw`, **the engine's first decision answered by the seat that did not make the play** — the park carries a `decider`, the phase an `answerer` beside its controller `seat` (absent when they agree, so every older park serializes byte-identically), and the turn does not move while they answer. Ortega ×2 authored (Miriam's shape with both halves across the table), Greavard "Underworld Stroll" DERIVED from attack text. `programPlayable` gained the public-count empty-hand gate and is EXPORTED, so the HUD greys a dead Trainer/Ability row with the predicate that rejects it; §9.4, engine 0.32.0) + **D53 = `damageSelf` + the two-seat attack epilogue** (the recoil clause "This Pokémon also does N damage to itself" — Skeledirge sv01-038 "Blazing Shout", the engine's FIRST attack that damages its OWN board: a flat self-damage op emitted as `COUNTERS_PLACED source "self"` (the confusion self-hit's model, OUTSIDE the §8.5 W/R pipeline), and finishAttack's KO sweep widened from the single defender seat to BOTH in `[defender, attacker]` order (§8.1 — the active player takes prizes first; a self-KO prizes to the defender), which PAYS THE D42 DEBT and makes the §14 double-KO tie + the §14.2 self-KO-your-last-Pokémon loss reachable from the attack path for the first time; the `attackEpilogue` stage's now-dead `koedSeat` dropped; engine 0.33.0) + **D54 = count-scaled attack damage** (the additive "+" family — the printed "This attack does N more damage for each damage counter on this Pokémon" now folds `per × floor(attacker.damage/10)` into the base BEFORE the §8.5 W/R pipeline via a new reader `deriveAttackDamageBonus` (effects.ts, DISJOINT from `deriveAttackEffect`: PRE-damage math, not an EffectOp), the FIRST to turn the dead `ATTACK_EFFECT_SKIPPED` damage-modifier path into a simulated one; Paldean Tauros "Raging Horns" + fix-attacker "Rage", a new `DAMAGE_DEALT.scaled` field + a `· scaled +N` log breadcrumb, the skip condition rebuilt around `effectSimulated`/`modifierSimulated`; Charizard ex "Burning Darkness" (a DIFFERENT count source — the opponent's TAKEN Prizes) stays the unsimulated anchor-guard witness, and `count` is a union for it to land as a member later; engine 0.34.0) + **D55 = the count union's SECOND member** (`opponentPrizesTaken` — Charizard ex "Burning Darkness" 180+ folds `30 × (6 − the opponent's remaining Prizes)` into the base; the new `OPPONENT_PRIZES_SCALE` regex is anchored on "more" to REFUSE the "×"/multiply Prize family (Pecharunt/Annihilape), and `scaledAttackDamage` widened to reach the opponent's board; simulating Charizard migrated the unsimulated-"+" witness to a real replacement, Entei sv03-030 "Blaze Ball"; one MED false-coverage fixed — the per-multiplier was pinned only at Charizard's per=30, closed with a synthetic per-50 probe; engine 0.35.0) + **D56 = the "×"/multiply damage family** (the additive family's sibling — "This attack does N damage for each Prize card your opponent has taken." with NO "more" MULTIPLIES: the printed "N×" is the per-unit, so `per × count` is the WHOLE damage with the printed base DROPPED (count 0 → 0 damage), a DISTINCT fold; a new reader `deriveAttackDamageMultiplier` + regex `OPPONENT_PRIZES_MULTIPLY` reuse D55's `opponentPrizesTaken` count evaluator UNCHANGED, and attack.ts reads both scaling derivers (mutually exclusive on "more") with `scaledBase = damageMultiplier ? 0 : base` dropping the base only for a multiply — Pecharunt ex sv06.5-039 60× / Annihilape sv01-109 70×, two pers on one source; the bigger "×" siblings Wo-Chien ex sv02-027 (benched target) and Chien-Pao ex (discarded-Energy count) stay LOUD as the anchor-guard witnesses; engine 0.36.0) + **D57 = the "×" family's benched-TARGET sibling** (Wo-Chien ex sv02-027 "Covetous Ivy" — "does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken." — a CHOSEN single Benched target, NOT the Defender, so it is a `damageChosen` op (count 1) not the pre-W/R fold; the put-counter snipe extended with `deals` (ATTACK DAMAGE — DAMAGE_DEALT + benched reduction, `spreadDamage`'s model, not a flat counter) and `perTakenPrize` (amount = `60 × the opponent's taken Prizes`, via the interpreter's `snipeAmount`; 0 taken → nothing); new derive `BENCHED_SNIPE_TAKEN_PRIZES` ("1 of" ≠ SPREAD_EACH_BENCH's "each of"), and the "6 − remaining" formula extracted to the shared `takenPrizes` helper (types.ts). COMPLETES the "for each Prize card your opponent has taken" family; Chien-Pao ex is the sole remaining "×" witness. One MED false-coverage fixed — the reduction test benched a passive-less body, closed with real Bouffalant sv03-174; engine 0.37.0) + **D58 = the flat benched-snipe RIDER family** ("This attack ALSO does N damage to 1 of your opponent's Benched Pokémon." — a secondary snipe after the main hit; the SAME count-1 `deals` `damageChosen` op as D57's Covetous Ivy WITHOUT `perTakenPrize`, so ZERO new op/interpreter code: one regex `ALSO_BENCHED_SNIPE` + one derive case lands ~15 prints across Miraidon / Tadbulb / Pawmot / Bellibolt / Decidueye ex / Jumpluff / Orthworm / Palafin / Pyroar / Dartrix; Flamigo's board-condition gate + the "each of"/"2 of"/"1 of YOUR" variants stay loud; engine 0.38.0) + **D59 = the ANY-target snipe family** ("This attack does N damage to 1 of your opponent's Pokémon." — the WHOLE attack, a chosen hit on the Active OR a Bench; `damageChosen` gained `target:"opponentAny"` (candidates = the opponent's Active + Bench via `oppAnyRefs`) and `placeSnipe` an Active arm `snipeActive` that runs the §8.5 W/R pipeline — a hit on the ACTIVE takes Weakness/Resistance, a Benched one stays flat, the rules' "W/R only on the Active" made conditional on the pick; Fezandipiti ex sv06.5-038 100 / Rotom sv01-069 20 / Paldean Tauros "Aqua Dive" 60 / Bellibolt ex / Kilowattrel 50; Umbreon (different W/R tail), Pawmot ex (discard cost), Magikarp (coin flip) stay loud; the put-counter + benched-`deals` snipes are UNCHANGED; engine 0.39.0)) — next: Chien-Pao ex "Hail Blade" (a COMPOUND + PRE-damage park, its own session), the remaining rider shapes (each-of spread, count-2, Umbreon's no-W/R-on-Active flag), the last cheap D40 reader (Defiance Band), or P4 |
| online | P4 | 🚧 **STARTED** (engine broad at 0.40.0). M1 (WS lobby over the DO) already done at P1-M8. **1a: engine wired into `apps/api`** (`startMatch`, host→p1/guest→p2). **1b: the DO seam DONE** — `handoffToMatch()` in `alarm()` loads the D1 pool, mints a seed, persists a `MatchRecord` under `MATCH_KEY` (dropped on `abandonsMatch`). **1c: the redactor + wire + read-only board DONE** — `redactGame`/`RedactedGame` + `{kind:"match"}` + `OnlineMatch` over `PlaymatView`. **2a: the action transport + setup flow DONE** — `{kind:"action"}` frame, seat-bound `applyMatchAction`, redacted `phase`, `OnlineHud` setup panels. **2b-i: the attack + KO loop DONE** — `RedactedPhase.turn:action.attacks` (server-computed payability, turn-owner + own-Active only), `SUPPORTED_MATCH_ACTIONS` += attack/takePrizes/promote, `OnlineHud` AttackPanel + ko:takePrizes/ko:promote dialogs; the match now plays TO A WIN with the fixed basic decks. **2b-ii: retreat DONE** (scoped to retreat ALONE — abilities/trainers deferred to real decks): `RedactedPhase.turn:action.retreat` + `SUPPORTED_MATCH_ACTIONS` += retreat + `OnlineHud` RetreatDialog. **2b-iii-a: the effect:choose prompt SEAM + the mayDraw dialog DONE** — `RedactedEffectPrompt` (mayDraw arm) on `RedactedPhase.effect:choose.prompt` (answerer-only via `redactedPromptOf`), `decisionFromPhase` reconstruction (round-trip now holds for a mayDraw park), `OnlineHud` MayDrawDialog; `resolveEffect` stays OFF the allowlist (2b-iii SPLIT: a=mayDraw seam, b=public-ref prompts, c=hidden-candidate prompts + the allowlist flip, d=event log + rejection pill). **2b-iii-b: the public-ref prompts DONE** — `RedactedEffectPrompt` += choosePokemon/choosePokemonMulti/moveEnergy/discardEnergy arms (+ `RedactedPokemonRef`, absolute-seat), `redactPrompt` maps them (fresh copies, answerer-only, controller-answered so stricter than `phaseViewOf`), `decisionFromPhase` reconstructs full (round-trip holds for the answerer's view), `OnlineHud` += four dialogs via `EffectChooseDialog` (names resolved off the board); `resolveEffect` still OFF the allowlist. **2b-iii-c: the hidden-candidate prompts DONE** — `RedactedEffectPrompt` += chooseCards/attachCards arms carrying a `RedactedCard` per candidate (the deck-card reveal, server-resolved via `redactedCardOf`, answerer-only — the hidden-info barrier, leak-tested); `decisionFromPhase` recovers uids from `c.id`; `OnlineHud` += ChooseCards/AttachCards dialogs + the `effect:choose` render keys on the prompt (stale-pick reset); **`resolveEffect` now ON `SUPPORTED_MATCH_ACTIONS`** (every kind dialoged; soft-lock-safe). 1767→1774 tests. **2b-iii-d SPLIT** into d-i (pill) + d-ii (log). **2b-iii-d-i: the rejection pill DONE** — `{kind:"reject-action", reason}` server frame, `applyMatchAction` returns `{ok,reason}`, the DO sends it on `!ok`, `useLobby.actionError` + `OnlineMatch` `TransientErrorPill`. 1774→1777 tests. **2b-iii-d-ii: the online event log DONE** (D68) — `logFromEvents` + `LogContext` moved into `@luminous/engine`, the wire log types (`SeatLogEntry`/`LogSegment`) into `@luminous/schema`, the `{kind:"match"}` frame grew `log` (seat-keyed + leak-safe, identical to both), `MatchRecord` grew `startedAt`/`names`/`log`, `applyMatchAction` takes `now`; `viewLogEntries` relabels client-side. 1777→1782. **3 SPLIT** (a/a-sec/b/c+). **3a + 3a-sec: real deck selection + seat auth DONE** (D69) — the `/ws` upgrade authenticates the forwarded `session` cookie → a per-socket userId; the handoff loads each player's OWN deck OWNER-SCOPED (`loadPlayerDeck`), drops `FIXED_MATCH_DECKS`, resets + broadcasts `{kind:"match-error"}` on a load failure; `seatClaimAllowed` + `SEAT_USERS_KEY` bind a seat to its account (closing the bearer-only-seat HAND leak). 1782→1790. **3b: the online ability + non-Stadium trainer HUD DONE** (D70) — `RedactedPhase.turn:action` gained `abilities`/`trainers` (server-folded playability via `redactedAbilitiesOf`/`redactedTrainersOf`, actor-only), `OnlineHud` gained the Abilities + Trainers sections, `SUPPORTED_MATCH_ACTIONS` += `useAbility`; STADIUMS stay the board drag, RARE CANDY deferred. 1790→**1803**. **3b-ii: the online Rare Candy DONE** (D71) — `RedactedTrainer` gained a `rareCandy` FLAG (the one row that opens a dialog instead of dispatching `playTrainer`) and `RedactedPhase.turn:action` a `rareCandy` pairing list (`redactedRareCandyOf` = the engine's `rareCandyOptions` mapped to the wire, actor-only; both computed in one `redactPhase` call, so a lit row always has ≥1 pairing), `OnlineHud` gained the two-step `RareCandyDialog`, `SUPPORTED_MATCH_ACTIONS` += `rareCandy` (soft-lock-safe — the same `placeEvolution` tail `evolve` has reached since 2a, no new park surface). 1803→**1812**. **The online turn HUD is now COMPLETE — every local affordance has an online counterpart.** **BROWSER-VERIFIED** (2026-07-26, two real clients + two D1 decks): the forwarded `session` cookie survives the cross-origin WS upgrade, the event log renders on both, 3b's greying is faithful live, Rare Candy evolves end-to-end and the hidden-info barrier holds. **3c — the match LIFECYCLE** is now landing: **3c-i** `MatchRecord.version` + `readMatchRecord`/`peekMatch`/`retireStaleMatch` + `endMatch` (D72, 1812→**1825**); **3c-ii** the engine `concede` action + `GameOverReason.conceded` + the 90s `ABANDON_GRACE_MS` forfeit for a player who vanishes mid-match (D73, engine 0.41.0, 1825→**1832**, browser-verified by killing a client); **3c-iii** the Concede control in the HUD chrome + neutral `GAME_OVER_DETAIL` copy (D74, 1832→**1835**); **3c-iv** a mid-match LEAVE now forfeits instead of voiding the opponent's game — `concedeSeat` shared with the timeout path, the pure `applyBye` keeping the seat while in-game so the result survives, and a Back confirmation that says leaving forfeits (D75, 1835→**1841**); **3c-v** the forfeit deadline moved onto the WIRE (`PlayerState.forfeitAt` replacing the DO's `ABANDON_KEY`, so the countdown renders the number the alarm fires on), the `connected` ⇒ no-forfeit invariant made structural, `readSnapshot` normalizing the un-versioned snapshot, and the ticking `OpponentAwayBanner` (D76, 1841→**1853**, browser-verified incl. a reconnect that was correctly NOT forfeited). **The match lifecycle now resolves from every direction.** **Next:** rematch (3c-iv left an in-game lobby with no exit but the host's kick; `endMatch` is the primitive), then spectate. See `workstreams/online.md`. |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
- **2026-07-23** (build #48) — **P4 increment 2b-i: the online attack + KO loop** (built solo with
  full context; self-reviewed). The online match now plays **TO A WIN** with the fixed basic decks:
  attack → take prizes → promote. 2b was too big for one increment (the local turn HUD reads the full
  `GameState`), so it's **SPLIT** — 2b-i is the attack/KO loop; retreat + abilities/trainers (2b-ii)
  and the effect:choose prompt+dialog (2b-iii) follow. **Wire:** `RedactedPhase.turn:action` gained an
  `attacks` list (a new `@luminous/schema` `RedactedAttack` — `index`/`name`/`cost`/`damage`/
  `playable`). **Engine:** `redactPhase` fills it via a new `redactedAttacksOf(state, viewerSeat,
  turnSeat)` — the viewer's OWN Active's printed attacks, each with a server-computed `playable` that
  folds §8.2 payability (`effectiveAttackCost`+`providedEnergy`+`costMet`, under the Stadium's cost),
  the §4 first-turn ban and the §12 immobilize gate, EXACTLY the local `TurnPanel`'s `disabled`;
  populated ONLY for the turn owner (opponent's view = `[]`), own Active only, so no leak. **API DO:**
  `SUPPORTED_MATCH_ACTIONS` grew by `attack`/`takePrizes`/`promote` — with the pure-damage fixed decks
  these never reach `effect:choose`, so no soft-lock (`resolveEffect`/`retreat`/`useAbility` stay
  blocked). **Client:** `OnlineHud` gained an AttackPanel (bottom-right, mirroring the local TurnPanel)
  and the ko:takePrizes / ko:promote dialogs (centered overlays) — the ko dialogs need NO new wire
  data (count on the phase, own prizes-count/bench on the board). `EnergyDots` extracted to a shared
  `src/features/game/EnergyDots.tsx` (GameHud + OnlineHud, one source). The `turn:action` round-trip
  equality (`projectionFromRedacted` ≡ `projectGameState`) still holds — `attacks` never enters
  `GameProjection`. engine unchanged (0.40.0 — a transport/read surface); 1731 → **1740** tests,
  `bun run check` green. New tests: 4 engine attack-payability cases (redact.test.ts) + 5 OnlineHud
  DOM cases (attack dispatch/disable/first-turn-note/opponent-empty, prize pick, promote). **Review
  (1 read-only adversarial reviewer): NO HIGH, NO MED** — the server-side payability faithfully mirrors
  the local `TurnPanel`'s `disabled`, leaks nothing (turn-owner + own-Active + viewer-public), the
  action shapes match the engine handlers, indices align 1:1, round-trip equality holds. **FIVE LOWs —
  2 FIXED** (an orphaned EnergyDots doc comment in GameHud; the ko `Dialog` is now a native
  `<dialog>` — top-layer + focus-trap, matching the local HudDialog), **3 RECORDED** (the OnlineHud
  dialogs restate GameHud's markup — the
  D60 "restate per surface" choice, different shapes; AttackPanel omits the §12 immobilize/confusion
  notes — harmless with pure-damage decks, 2b-ii's surface; the allow-`attack` no-soft-lock is
  plan-ordering not structural — the SEQUENCING CONSTRAINT now loud in `match.ts`). **Still unverified:**
  the DO `case "action"` boundary has no direct test for the new types (pure `applyMatchAction`/allowlist
  do); a two-client browser run of the loop (tests only). See `workstreams/online.md` + D62.
- **2026-07-23** (build #47) — **P4 increment 2a: the action transport + online setup flow** (built
  solo with full context — two read-only Explore agents mapped the interactive machinery first —
  then one read-only adversarial reviewer). The online match becomes INTERACTIVE. **Wire:** a
  `{kind:"action", action}` client frame (`wireActionSchema` = `z.looseObject({type})`, loosely typed
  so the DO rebinds the seat + relies on `applyAction`'s totality; one cast at the client send
  boundary). `RedactedGame` gained a redacted `phase` (the action-routing discriminant), FOLDING IN
  `pendingDecision` (now derived client-side via `decisionFromPhase`). **API DO:** a `case "action"`
  handler binds the action to the socket's OWN seat via `matchSeatOf` (a client can't act for its
  opponent), gated to a seated player in an in-game lobby with a record, runs the pure
  `applyMatchAction` (allowlisted to `SUPPORTED_MATCH_ACTIONS`, persist-before-broadcast) and re-fans
  each socket its redacted view. **Shared refactor:** `moveToAction` + `placement.ts` → a
  transport-agnostic context (`phaseKind`/`isViewerTurn`/`isReady`) so local (full `Phase`) AND online
  (redacted phase) drive ONE tested drag router / drop gate; the placement.test.ts lockstep is
  unchanged. **Client:** `useLobby.sendAction`; a new `OnlineHud` (chooseFirst / mulligan-draw /
  place-ready panels, gated on `waitingOn === "you"`, dispatching setup actions with the client's own
  seat); `OnlineMatch` now wires drags → `moveToAction` → `sendAction`, pass → `endTurn`, and the
  shared placement predicate. Setup + basic turn drags + pass are playable online. engine unchanged
  (0.40.0); 1719 → **1731** tests, `bun run check` green. **Review (1 read-only adversarial reviewer):
  NO HIGH, NO MED** — the seat-binding blocks acting-for-opponent (forge test), the three gates block
  unseated/not-in-game/no-record, `applyAction`'s totality holds against hostile payloads,
  persist-before-broadcast + the DO input gate prevent desync, the redacted phase leaks nothing, and
  the refactors are logically identical. **ONE LOW FIXED** (the reviewer's L2): `applyMatchAction`
  now gates to `SUPPORTED_MATCH_ACTIONS` (the 2a-drivable subset) so a crafted attack/decision frame
  can't soft-lock the match in a ko:*/effect phase the 2a HUD renders no control for. **ONE LOW
  recorded** (L1): the DO `case "action"` boundary has no direct test (only the pure
  `applyMatchAction` does — the DO-shell pattern; it mirrors the tested `intent` handler). See D61.
- **2026-07-23** (build #46) — **P4 increment 1c: the redactor + wire + read-only board** (built
  solo with full context — two read-only Explore agents mapped the client + DO wiring first — then
  one read-only adversarial reviewer). The match now CROSSES THE WIRE and RENDERS. **Engine:** new
  PURE `redactGame(state, seat) → RedactedGame` (`redact.ts`) — the per-viewer hidden-information
  filter the DO runs once per socket, so no full `GameState` leaves the DO; it restates the playmat
  redaction against a neutral wire shape (opponent hand a count of positional-id backs, prizes/decks
  counts, discards/Stadium public, in-play redacted to backs during setup with no `battle` row, the
  effect prompt stripped). The subtle `phaseViewOf` phase derivation (+ `koParkActiveSeat`/
  `turnOwnerOf`/`preferViewer`/`PendingDecision`/`inSetup`) was **MOVED out of the web projection
  into the engine** (`phaseView.ts`, byte-identical) so the projection and the redactor share ONE
  source; `useLocalGame`/`projection.ts` now import it. engineVersion 0.39.0 → **0.40.0**.
  **Schema:** `RedactedGame` wire type (`match/redacted.ts`, Zod source-of-truth, viewer-relative)
  + the `{kind:"match", game}` server frame in `LobbyServerMessage` (exactness proof). **API DO:**
  per-viewer `broadcastMatch` on the in-game FLIP (gated on the transition) + `sendMatchIfInGame`
  on reconnect (the three hello branches), keyed by the pure `matchSeatOf` (host→p1/guest→p2).
  **Client:** `useLobby.match` (set on the frame, cleared when the lobby leaves in-game) + a new
  read-only `OnlineMatch` feeding the SAME `PlaymatView` a `projectionFromRedacted(game)` in place
  of `MatchPlaceholder`. **The wire round-trip is pinned to reconstruct EXACTLY the local
  `projectGameState` board** (the guard against the two redactors drifting), and `redact.test.ts`'s
  "LEAKS NOTHING" barrier proves no p1-private uid reaches the p2 viewer during setup. 1702 →
  **1719** tests, `bun run check` green. **Review (1 read-only adversarial reviewer): NO HIGH —
  no input leaks opponent-private data or crashes the redactor;** `phaseViewOf` verified
  byte-identical, the DO fan-out targets the correct seat per socket, the flip-gate fires exactly
  once, reconnect preserves the record, the schema matches field-for-field. **Three LOWs recorded,
  not fixed:** (L1) the client channel does no Zod on inbound frames (a malformed `match` frame
  throws at render — not opponent-exploitable, consistent with the untouched `state`/`reject`
  trust model), (L2) bearer-only seat identity (pre-existing lobby auth, unchanged), (L3) the
  setup-phase turn glow lights "you" (cosmetic). See D60.
- **2026-07-23** (build #45) — **P4 increment 1b: the DO seam** (built solo with full context,
  then one read-only adversarial reviewer). The lobby → engine handoff now RUNS server-side.
  `LobbyDO`'s constructor takes `env` (D1); a new private `handoffToMatch()` at the in-game flip
  inside `alarm()` loads the card pool from D1 (`loadCardPool` — chunked `db.batch(inArray)` →
  `mapCardRow`, mirroring `guardUnknownCards`; the pure fold `poolFromRows` unit-tested), mints an
  RNG seed (`crypto.getRandomValues`), calls `startMatch`, and persists a `MatchRecord {seed,state}`
  under `MATCH_KEY` BEFORE the in-game snapshot broadcasts (crash-safe ordering; idempotent guard).
  Fixed placeholder decks + their distinct ids added to the pure `match.ts` (`FIXED_MATCH_DECKS` /
  `FIXED_MATCH_CARD_IDS` — host Sneasel + Water, guest Mareep + Lightning, distinct per seat). engine
  unchanged (0.39.0); 1696 → **1702** tests, `bun run check` green. **Review: ONE HIGH found and
  fixed** — `MATCH_KEY` outlived its match, so a rematch in the same lobby reused the previous
  pairing's `GameState`/seed (a guest `bye` / host kick resets phase via `removeGuest` but left the
  record); `commit` now drops it on the pure `abandonsMatch(prev,next)` transition (any commit
  leaving in-game), pinned via the real `removeGuest`. **Two LOWs recorded, not fixed:** the
  load-failure in-game wedge (incomplete D1 pool → in-game with no game, self-heals on rematch) and
  the vacuous deck test (size + coverage, not real-catalog id existence) — both in `online.md`.
- **2026-07-23** (P4 kickoff, after build #44) — **Pivoted to P4 (online matches)** after
  pushing D57–D59. Thorough read-only map of the online/lobby/engine infra (the handoff seam
  = `lobbyDO.ts:228`; the engine has NO server-side redaction — the load-bearing new code; a
  reusable read-only render exists in `PlaymatView`/`GameProjection`). **Increment 1a landed:**
  `@luminous/engine` wired into `apps/api` + a pure tested `startMatch` handoff
  (`apps/api/src/lobby/match.ts`, host→p1/guest→p2), proving the engine imports and runs in the
  Worker/DO package. 1693 → **1696** tests. Plan + architectural decisions (redactor in the
  engine, `RedactedGame` wire type in schema, fixed decks + a D1 card pool for now) written into
  `workstreams/online.md`; next is 1b (the DO seam) then 1c (redactor + wire + read-only client).
- **2026-07-23** (build #44) — **P3-M5: the ANY-target snipe family, with conditional
  Weakness/Resistance** (D59; built solo with full context, then one read-only adversarial
  reviewer). The resume point's #2. **"This attack does N damage to 1 of your opponent's
  Pokémon."** (the WHOLE attack — no `damage` field, a chosen hit on the Active OR a Bench)
  now SIMULATES. `damageChosen` gained **`target: "opponentAny"`** (candidates = the
  opponent's Active + Bench, via new `oppAnyRefs`), and `placeSnipe` an **Active arm
  (`snipeActive`)** running the §8.5 W/R pipeline — a snipe on the ACTIVE takes
  Weakness/Resistance (and the attacker's pre-W/R bonus), a Benched one stays FLAT; the
  rules' "W/R apply only to the Active" made conditional on the pick. New regex
  `CHOSEN_ANY_TARGET`. Lands **Fezandipiti ex** sv06.5-038 "Cruel Arrow" (100), **Rotom**
  sv01-069 "Linear Attack" (20), Paldean Tauros "Aqua Dive" (60), Bellibolt ex / Kilowattrel
  (50). Umbreon "Feint Attack" (a different W/R-immunity wording), Pawmot ex (a discard cost),
  Magikarp (a coin flip) stay LOUD. The Bench arm of `placeSnipe` is UNCHANGED, so the
  put-counter snipe (Hawlucha / Meowscarada) and the benched-`deals` families (Wo-Chien,
  riders) are unaffected. New `ANY_SNIPE_DECK` (both setup Actives pinned to a
  `fix-lightning-weak` body). No web change. engineVersion 0.38.0 → **0.39.0**; 1683 →
  **1693** tests. **Review: NO HIGH, NO shared-code regression** (the `placeSnipe` `next`
  threading is byte-identical for every opponentBench consumer; `validateChoice` still rejects
  an Active pick on a Bench-only prompt; 42 prior snipe/Covetous/rider tests green). **ONE MED
  found and FIXED:** `snipeActive` dropped the attacker's pre-W/R bonus (Vitality Band's +10,
  which DOES apply to an Active hit — my "consistent with the Bench arm" comment was a false
  equivalence), so a Vitality-Band Fezandipiti would have under-dealt — added
  `damageBonusBeforeWR` into the pre-W/R term + the `bonus` field, pinned by a new test
  ((20 + 10) × 2 = 60). The discriminating W/R pair (same body: Active 40 vs Bench 20) and the
  "no double when not weak" (Fezandipiti Darkness 100) are pinned. Reviewer LOW recorded:
  `snipeActive`'s Resistance/reduction/floor + the Active-KO flow are analysis-only (a verbatim
  copy of attack.ts's tested pipeline). Highest-risk slice of the session (shared machinery +
  W/R duplication); the review earned its keep.
- **2026-07-23** (build #43) — **P3-M5: the flat benched-snipe RIDER family** (D58;
  built solo with full context, then one read-only adversarial reviewer). The resume
  point's #3, the high-yield cheap step D57's catalog scan surfaced. **"This attack
  ALSO does N damage to 1 of your opponent's Benched Pokémon."** (a secondary snipe
  after the main hit, which rides the `damage` field) now SIMULATES — the SAME count-1
  `deals` `damageChosen` op as D57's Covetous Ivy WITHOUT `perTakenPrize` (a FIXED N),
  so **ZERO new op/interpreter code: one regex `ALSO_BENCHED_SNIPE` + one derive case**
  in effects.ts. Lands ~15 prints (Miraidon sv01-080 / Tadbulb sv03-076 authored as
  fixtures; Pawmot / Bellibolt / Decidueye ex / Jumpluff / Orthworm / Palafin / Pyroar
  / Dartrix all share the shape). Flamigo's "If Flamigo is on your Bench, …" (a
  board-condition gate), the "each of" spread, "2 of", and "1 of YOUR" variants stay
  LOUD. New `ALSO_SNIPE_DECK` (BOTH setup Actives pinned to fix-bigbody, 32/60, so the
  Defender survives the main hit with an empty Bench — no seed-dependent displaced
  body); no web change. engineVersion 0.37.0 → **0.38.0**; 1673 → **1683** tests.
  **Review: NO real defects** — mutation-driven, every load-bearing field pinned
  (a `count:2` injection fails 3 tests, a `perTakenPrize:true` injection fails 6; the
  captured amount is pinned by Miraidon 30 ≠ Tadbulb 10, `deals` by DAMAGE_DEALT +
  `not COUNTERS_PLACED`, main+rider coexistence by the two bases 90/30). ONE comment
  nit FIXED (the reviewer proved the whole-sentence anchor, not the word "also", is
  what keeps Covetous Ivy off this regex). This slice is the proof the D57 op
  generalizes: a big card batch for a ~26-line diff.
- **2026-07-23** (build #42) — **P3-M5: the "×" family's benched-TARGET sibling —
  Wo-Chien ex "Covetous Ivy"** (D57; built solo with full context, then one read-only
  adversarial reviewer). The resume point's #1, the last "for each Prize card your
  opponent has taken" card. **"This attack does 60 damage to 1 of your opponent's
  Benched Pokémon for each Prize card your opponent has taken."** now SIMULATES: a
  CHOSEN single Benched target (not the Defender), so it derives to a **`damageChosen`**
  op (count 1) rather than the pre-W/R fold — the put-counter snipe (Hawlucha /
  Meowscarada) extended with **`deals`** (ATTACK DAMAGE, a DAMAGE_DEALT with the benched
  reduction passive like `spreadDamage`, not a flat COUNTERS_PLACED counter) and
  **`perTakenPrize`** (amount = `60 × the opponent's TAKEN Prizes`, computed in the
  interpreter via new `snipeAmount`; 0 taken → no damage, no pick). New derive
  **`BENCHED_SNIPE_TAKEN_PRIZES`** (the "1 of" vs `SPREAD_EACH_BENCH`'s "each of" is the
  whole difference); the "6 − remaining" Prize formula extracted to the shared
  **`takenPrizes`** helper (types.ts), now used by BOTH this and the D55/D56 fold. Lands
  **Wo-Chien ex** sv02-027 (+ reprints -232/-257). New `COVETOUS_IVY_DECK`; no web change.
  engineVersion 0.36.0 → **0.37.0**; 1661 → **1673** tests. **Review: NO HIGH** — the
  recompute-at-resolve safety, the 0-guard, `deals`/`spreadDamage` parity, the
  benched-KO-through-`finishAttack` turn-END, and regex narrowness (matches ONLY Wo-Chien
  of ~20 "to 1 … Benched" catalog attacks) all confirmed. **ONE MED false-coverage found
  and FIXED, plus 2 LOWs:** the "reduction passive" test benched a passive-LESS body
  (fix-bigbody), so `dealt = amount − reduction` and the `reduction` field were unpinned
  — closed by benching real **Bouffalant sv03-174 "Bouffer"** (−20), asserting `{base:60,
  reduction:20, dealt:40}`; the purity test moved from the park path to the
  state-rewriting AUTO-TAKE path (where `placeSnipe` actually runs); the non-discriminating
  `weakness:null` is structural (the `deals` branch hard-codes null), left as the honest
  shape. Catalog scan surfaced a whole untouched family for next time — the flat "also does
  N to 1 Benched" RIDER (~15 cards), cheap now the op exists.
- **2026-07-23** (build #41) — **P3-M5: the "×"/multiply damage family — Pecharunt
  ex / Annihilape** (D56; built solo with full context, then one read-only
  adversarial reviewer). The resume point's #1, the sibling of the additive "+"
  family (D54–D55). **"This attack does N damage for each Prize card your opponent
  has taken."** (NO "more") now SIMULATES: the printed "N×" is the PER-unit, so
  `per × count` is the WHOLE damage with the printed base **DROPPED** (count 0 → 0
  damage) — a DISTINCT fold from the additive "+" (which adds `per × count` onto a
  printed base). A new reader **`deriveAttackDamageMultiplier`** + regex
  **`OPPONENT_PRIZES_MULTIPLY`** (effects.ts) reuse D55's `opponentPrizesTaken` count
  evaluator UNCHANGED; attack.ts reads BOTH scaling derivers (mutually exclusive on
  the word "more" — multiply only when additive is null) and
  **`scaledBase = damageMultiplier ? 0 : base`** drops the base for a multiply while
  the additive family keeps it. Lands **Pecharunt ex** sv06.5-039 "Irritated Outburst"
  (60×) and **Annihilape** sv01-109 "Rage Fist" (70×) — two pers on one source. The
  bigger "×" siblings — **Wo-Chien ex** (benched target) and **Chien-Pao ex**
  (discarded-Energy count) — stay LOUD as the multiply reader's anchor-guard witnesses
  (Entei stays the additive one). New `MULTIPLY_DAMAGE_DECK` (Darkness/Fighting Energy
  pay {D}{D} / {F}). No web change. engineVersion 0.35.0 → **0.36.0**; 1653 →
  **1661** tests, `bun run check` green. **Review: NO HIGH, NO MED, no surviving
  mutants.** Catalog narrowness proven EXHAUSTIVELY (of the 4 cards printing "for each
  Prize card your opponent has taken", the multiply regex matches ONLY
  Pecharunt/Annihilape; refuses Wo-Chien and Charizard's "more"); base-drop pinned two
  ways (a count-0 "no DAMAGE_DEALT" test + a count-2 "120 not 180" test); captured-per
  pinned by Annihilape's 70 ≠ Pecharunt's 60. **ONE LOW found and FIXED:** the
  Pecharunt fixture's "verbatim" comment omitted its "Subjugating Chains" Ability —
  corrected to an honest "stats + attack row verbatim; Ability OMITTED (unexercised, no
  registry row)", the false-verbatim defect this repo names explicitly. Recorded, not
  fixed: multiply W/R ordering is not INDEPENDENTLY pinned (shared pipeline line,
  already pinned by the additive "folds BEFORE weakness" test; reviewer LOW).
- **2026-07-23** (build #39) — **P3-M5: count-scaled attack damage — the additive
  "+" family lands** (D54; explored → built by a sub-agent to a tight spec → two
  adversarial review agents in isolated worktrees, 17 engine mutations). The
  resume point's #3, chosen after exploration **falsified its #1** (Sandaconda's
  "rider clause" is a shuffle-into-deck + persistent-marker job, not the `recordAs`
  the D53 note assumed). The printed **"This attack does N more damage for each
  damage counter on this Pokémon."** now folds `per × floor(attacker.damage/10)`
  into the printed base BEFORE the §8.5 W/R pipeline — a new reader
  **`deriveAttackDamageBonus`** (effects.ts, DISJOINT from `deriveAttackEffect`:
  PRE-damage math, not an `EffectOp`), attack.ts's `base + scaled + bonus`, and a
  new **`DAMAGE_DEALT.scaled`** field — the FIRST to turn the dead
  `ATTACK_EFFECT_SKIPPED` damage-modifier path into a simulated one. Lands
  **Paldean Tauros** "Raging Horns" (20+) and simulates **`fix-attacker` "Rage"**
  (10+, the default attacker); the skip condition rebuilt around
  `effectSimulated`/`modifierSimulated` (algebraically the old one for every
  non-scaling card). Web: a `· scaled +N` log breadcrumb ahead of `· boosted`.
  **Charizard ex** "Burning Darkness" (a DIFFERENT count source, the opponent's
  taken Prizes) stays UNSIMULATED as the anchor-guard witness. engineVersion
  0.33.0 → **0.34.0**; 1636 → **1647** tests. **Reviews: NO HIGH** — anchors, the
  pre-W/R fold ordering (a 40-vs-30 test), the "right Pokémon" read, `scaled`-honesty
  all die. **THREE false-coverage MED/LOWs found and FIXED, each mutation re-run:**
  the fold's `per` operand was untested (`* bonus.per → * 10` survived — every
  fixture prints 10) AND the widened `base + scaled > 0` guard was untested — both
  closed by ONE synthetic base-0 per-20 scaler ("Fury"); and the `· scaled +N` log
  breadcrumb was unpinned (deleting it survived) — closed with a rendered-string
  assertion. (Process note: a `git checkout <file>` to revert a mutation wiped the
  slice's own uncommitted edits to two files mid-session; reconstructed from the
  reviewed diffs and re-verified green — see the mutation-testing-revert memory.)
- **2026-07-23** (build #38) — **P3-M5: `damageSelf` + the two-seat attack
  epilogue — the D42 debt paid** (D53; built solo, then two adversarial review
  agents, mutation-proven). The resume point's #3, owed before any self-damaging
  attack text. **Skeledirge** sv01-038 "Blazing Shout" (190 + a 30 recoil) is the
  engine's FIRST attack that damages its OWN board, and its first reader. New op
  **`damageSelf`** places flat self-damage on the attacker's Active
  (`COUNTERS_PLACED source "self"`, outside the §8.5 W/R pipeline — the confusion
  self-hit's model), and **finishAttack's KO sweep widened from the single
  defender seat to BOTH** in `[defender, attacker]` order (§8.1 — the active
  player takes prizes first; a self-KO prizes to the DEFENDER). `collectKnockOuts`
  already owned prizes-first grouping + the §14 double-KO tie guard, so the
  widening is one argument and the now-dead `koedSeat` on the `attackEpilogue`
  stage is dropped. The §14 double-KO tie AND the §14.2 self-KO-your-last-Pokémon
  loss are now reachable from the attack path, both tested. Web: a new
  `COUNTERS_PLACED "self"` log row in the attacker's voice; no projection change.
  engineVersion 0.32.0 → **0.33.0**; 1627 → **1636** tests. **Reviews: ONE HIGH
  engine-side, the recurring FALSE-COVERAGE pattern** — the deriver's `^`-anchor
  "load-bearing" test used a lowercase-"this" leading negative the case-sensitive
  regex refuses regardless of the anchor (dropping `^` left all 738 tests green,
  agent-verified); closed with a capital-"This" killer, both anchor drops now run
  as mutations to confirm they fail. The MED (the §14.2 self-KO loss, newly
  reachable) was pinned proactively. The web reviewer found NO HIGH/MED (fixture
  verbatim vs D1, the × hexdump-checked; the "self" row asserted on text + `who`).
- **2026-07-22** (build #35) — **P3-M5: `EffectContext.sourceUid` — the printed
  "this Pokémon"** (D50; built solo, then two adversarial review agents in
  ISOLATED worktrees). A FIELD, not an op: the context now carries the top-card
  uid of the Pokémon whose effect is running, set at every run site that knows
  it (`useAbility`, the board/checkup trigger runners, the KO trigger — naming a
  card that has LEFT play, honestly — and the attacker, by uid so a mid-program
  switch cannot stale it) and ABSENT for a Trainer, whose parked context stays
  byte-identical `{seat}`. First reader: `attachFromDeck.toSelf` — "attach it to
  **this Pokémon**" — landing **Pawmot** ×2 ("Electrogenesis"), whose whole
  point is that a **benched** Pawmot feeds itself; resolution is by board TOP
  uid, so an evolved-over or departed source whiffs into the printed shuffle
  (rules doc **§9.3**, including the LATENT "a returned Pokémon is a NEW
  Pokémon" note for the first revival op). **Reviews: ONE HIGH engine-side, the
  recurring shape — a false coverage CLAIM**: the evolved-over discrimination
  was documented and "tested", but the stale-uid test sat its uid in the DECK,
  so three wrong `sourceRef` implementations (two stack-membership scans and a
  base-uid match) passed the entire suite; closed on both arms, alongside the
  MED that every shipped board benched one Pawmot at slot 0 (hard-coded-index-0
  and match-by-catalog-id both survived — the two-Pawmot board now also pins the
  per-uid once-per-turn stamp). **Web: NO HIGH, one deliberate behaviour
  change** — a sole-target `attachCards` offer (every `toSelf` park, Janine over
  a lone {D} Pokémon) violated the house "a list of one is not a decision" rule,
  so `AttachCardsDialog` now commits on the card tap and the target list never
  mounts; plus two untested mirrors pinned (`usableAbilities`' `activeOnly`,
  deletable with all tests green — the lit-row-refused-click shape again — and
  `promptKey`'s attachCards `targets`/`max` segments). `toSelf`'s rider
  exclusivity is now documented as PRECEDENCE rather than claimed as a rule the
  code never enforced. engineVersion 0.29.0 → **0.30.0**; 1526 → **1561** tests,
  `bun run check` + `vite build` green. See D50.
- **2026-07-21** (build #32) — **P3-M5: the printed number is a FLOOR, and the
  hand cost that is NOT a discard** (D47; built solo, then two adversarial review
  agents in ISOLATED git worktrees — which is how mutation testing and a clean
  main tree coexist). Two fixes that turned out to be one claim: **the printed
  number and the printed verb are the engine's to state, not the caller's to
  infer.** `choosePokemonMulti` gained `min`/`max` + `declinable` (rules doc
  **§9.1**): "put 3 damage counters on **1** of your opponent's Benched Pokémon"
  is not "up to 1", and the cost that buys it is already spent by the time the
  prompt appears, so the empty answer was a way to pay for nothing. `declinable`
  had to be its own field because Hawlucha's "**you may** choose 2" is
  all-or-nothing — 2 or none, never 1 of 2 — and the framework auto-fires optional
  triggers, so the pick is the only place that "may" can live. Then
  `discardFromHandCost` → **`payFromHand`** with a required destination:
  **Dendra** ×3 pays a chosen card UNDER THE DECK, and the printed sentence never
  says "cost" yet carries every clause of the mechanism, gate and "other"
  included. **Skwovet** ×2 reached the same destination with the whole hand for
  ZERO new ops (`handRefresh` + Iono's riders). **Reviews: no HIGH engine-side;
  one HIGH web-side** — the Ability rows had never mirrored the §7.5 gate, so
  Meowscarada ex with no Basic {G} in hand rendered lit and was refused on click
  (recorded as "deliberate" one slice ago; indefensible once both row types share
  one helper). The engine agent's MEDIUM was the slice's one behavioural reversal:
  a declinable snipe must park at **every** non-empty Bench, since the draft's
  auto-take honoured "you may" only with 3+ Benched Pokémon. Eight test holes
  closed, each proved by a surviving mutation — including the **reprint registry
  rows**, where deleting 3 of the slice's 5 catalog ids left the whole suite
  green. engineVersion 0.26.0 → **0.27.0**; 1363 → **1395** tests, `bun run check`
  + `vite build` green. See D47.
- **2026-07-21** (build #31) — **P3-M5: `discardFromHandCost` — the printed COST
  that parks, and the field it absorbed** (D46; built solo, then the usual 2-agent
  adversarial review). The resume point's #1, and the catalog reframed it twice.
  First: the SAME printed sentence is on Meowscarada ex, whose cost the engine
  already had as `AbilityProgram.cost` — a field paid before the program ran, which
  worked only because Basic {G} Energy copies are interchangeable. Tinkaton's "a
  card" is the general case and it PARKS, so the field, `findAbilityCostCard` and
  `ABILITY_COST_PAID` were **removed** and Meowscarada migrated onto the op. 4
  backlog cards became **9 catalog rows**. Second: the two printed wordings
  ("only if you discard 2 **other** cards" on Trainers, "you **must** discard … in
  order to use this Ability" on Abilities) turn out to track **where the paying
  card sits** — 3/3 and 7/7 across the catalog — so "other" is not a field on the
  op but the played uid excluded in the GATE, the one place that runs while the
  Trainer is still in hand. Revavroom is the ORDER witness (pay 1 of 5, then draw
  to 6 = two cards). `chooseCards` gained a required `min`; the gate **vetoes**,
  the mirror image of D45's ungated `attachFromTop`, because there the veto was the
  engine guessing a whiff and here the card's own text states a precondition.
  **The review's HIGH is the half worth keeping:** the HUD never mirrored the new
  gate, so Ultra Ball on `[itself, one other card]` — the ordinary late-game state,
  and the moment the card is most often dead — rendered enabled and rejected on
  click, contradicting the doctrine the same file states and the suite already pins
  for the identical error code; `handCostUnmet`/`handCostPhrase` were not even
  exported. Two more findings changed the story rather than just fixing it: the
  `searchNote` plural bug was **live on a shipped card** (Chien-Pao ex has read
  "up to 2 **a Basic Water Energy**" since it was authored, surviving because
  nothing asserted any search note), and the Radiant Blastoise filter is now
  written down as a **documented deviation** from §6.5 rather than a settled
  ruling. Also fixed: the dialog's a11y brought into line with its mandatory
  sibling (a live region that stays mounted through short→satisfied, `aria-disabled`
  on over-cap rows — one of the slice's own assertions had pinned that silence),
  the untested count-1 branch that four of the six cards use, and four comments
  that claimed more than they proved. engine 0.25.0 → **0.26.0**; 1331 → **1363**
  tests.
- **2026-07-21** (build #30) — **P3-M5: `attachFromTop` — the from-the-top ATTACH,
  and the play gate that had to be REMOVED** (D45; built solo, then the usual
  2-agent adversarial review). The variant `lookAtTopN` deferred, and it turned out
  not to be a rider on either op it sits between. **"In any way you like"** is a
  different answer SHAPE — each attached card names its own destination, so the
  prompt's answer is a MAP (card → Pokémon) rather than a list, and any split is
  legal including both Energy on one Pokémon. The **leftovers clause** is two
  mechanisms wearing one printed sentence: "shuffle the other cards back" is a
  following op (they never left the deck, and a shuffle destroys order anyway),
  while "**discard** the other cards" must name exactly the looked-at cards that
  were not attached — so it lives ON the op, and it is charged on the whiff and the
  decline as well, which is the difference between Tri Howl costing three cards and
  costing nothing. Two consumers differing in every rider: **Electric Generator**
  (Item) and **Hydreigon "Tri Howl"** (once-per-turn Ability). The filter reads the
  PRINT, never `providesEnergy` — D44's §6.5 rule from the other side.
  **The review's one HIGH is the entry's most useful half:** the first draft GATED
  the play (no Benched {L} Pokémon → refused), but `programPlayable` is an **AND
  over a program's ops**, so that vetoed the CARD including its second printed
  sentence, which always resolves — against the ruling cardplay.ts itself quotes,
  and against Great Ball / Nest Ball in this same repo. The gate is gone; the
  general rule is recorded for the first card that needs one ("no op in this program
  can do anything", not a per-op veto). Also fixed: `max` clamped to the candidate
  count; the prompt keeps the printed "you find there" / "in any way you like"; four
  engine test holes each proved by a mutation that passed all 1323 tests; and five
  web fixes, the sharpest being that a **pending** pick was announced `aria-pressed`
  although Confirm does not dispatch it, plus a dispatch-time filter against the
  offer, because a stale prompt key's failure mode is an **unescapable dialog**
  rather than a bad attach. engine 0.24.0 → **0.25.0**; 1301 → **1331** tests.
- **2026-07-21** (build #29) — **P3-M5: the `providesEnergy` CardFilter — "an
  Energy that PROVIDES {X}"** (D44; built solo, then the usual 2-agent adversarial
  review). The resume point's #1, and the ONE primitive the previous slice
  diagnosed as all that stood between the engine and the rest of the
  energy-removal family. It turned out to be more interesting than a parameter:
  reading **provision instead of print** forces the predicate to be answered on
  the **HOST** rather than on the card, because Luminous Energy provides every
  type alone and only {C} beside another Special — the same physical card is a {L}
  Energy on one board and not on another. That is what made it worth sharing with
  a second op instead of bolting a field onto the first. `continuous.ts` was split
  so the filter and §8.2's cost matcher read one `unitsOf`, giving the invariant
  that **what can PAY a {L} cost is exactly what a "{L} Energy" effect can take**;
  `matchesFilter` deliberately answers **false** for deck/hand/discard scans, so
  the one authoring mistake this filter invites is a loud no-op. Two consumers, one
  vocabulary (D40's shape): the typed self-discard DERIVED in both printed
  notations (5 catalog rows, **zero registry rows**) and `moveEnergy`'s new
  `benchToActive` route (Armarouge). Also **committed the previous session's D43
  slice**, which was complete but uncommitted. 1268 → **1301** tests. **Both review
  agents: NO HIGH.** Their value was in the net rather than the code — the engine
  agent's 49 mutants found the route's Active guard asserted three times and tested
  zero times, and the wildcard predicate's `.includes` indistinguishable from
  "first unit only" (both unreachable today, both one authored card away); the web
  agent proved two behaviours unpinned with mutations that passed all 1297 tests.
  Everything actionable was fixed, including a genuine wire-hygiene hole beside the
  slice (`ENERGY_MOVED.to` spreading the client's own object into an event). The
  energy-removal family is now **filter-complete**: what remains is sentence
  structure, not predicates.
- **2026-07-21** (build #28) — **P3-M5: the `discardEnergy` ATTACK arms — the
  opponent-side twins + the exact-N `count`** (D43; built solo, then the usual
  2-agent adversarial review). The resume point's #1, widened to also take its #2's
  cheaper half so the slice is a coherent idea rather than two regexes. **No new op
  and no registry rows** — 11 catalog rows from two deriver sentences and one
  widened field. The twins run the EXISTING `opponentActive` arm and are the first
  ops to park a decision about the OPPONENT's board mid-attack; D42's machinery
  carried them with zero changes, which is the best evidence that slice was built
  at the right seam. The exact-N half is where the thinking was: **capping the
  interchangeable collapse at `count` instead of flattening to 1** keeps every
  distinguishable answer reachable while still dropping copies that could only
  duplicate — and it makes `forcedDiscards` a single comparison that is
  simultaneously the M1 no-choice rule and §8.6 "do as much as you can" (added to
  `ptcg-rules.md` this session; Sandaconda's "If you discarded any Energy in this
  way" is the on-card corroboration). engineVersion 0.23.0; 1250 → **1268** tests.
  **Review: NO HIGH in the slice's own logic from either agent** — the engine agent
  ran all five regexes over all 978 catalog rows (11 matches, zero false positives
  or misses) and brute-forced the collapse math over 7770 configurations. The web
  agent found **one HIGH beside the slice**, and it is the lesson worth keeping:
  `ENERGY_DISCARDED` named its host by SPOT, an invariant its own doc asserted was
  safe — but an attack twin strips a defender its own damage Knocked Out in the
  SAME batch, so the log re-read an empty slot and printed "from Tide's the Active
  spot". The event now carries `host` (the top-card uid, the KNOCKED_OUT
  precedent). **Mutation testing again earned its keep**: of 10 survivors, the
  `each`-scope collapse cap of 1 was entirely unpinned (a `cap = 2` mutant changed
  shipped Giacomo behaviour with all 1266 tests green), four regex anchors were
  unpinned (my own anchor comment had the reason WRONG — Krookodile is refused by
  capitalisation as much as by `^`, so it never pinned the anchor), and two of my
  own new web tests were proven toothless. All now dead. Also fixed: three of four
  new fixtures carried wrong HP/retreat under a header claiming catalog
  verification, and `opponentEach` + a numeric count is now unrepresentable rather
  than silently ignored.
- **2026-07-21** (build #27) — **P3-M5: attack effect programs can PARK — the
  `attackEpilogue` stage, and the §8 self-discard attack cost** (D42; log entry
  written retroactively in #28 — the ritual was skipped that session). The top
  backlog row and the biggest remaining structural unlock: `attack.ts` ran an
  attack's effect program as `runProgram(...).state`, silently dropping a parked
  prompt and every op behind it. The fix inverts the order — queue the tail first,
  then run the program — via a new `attackEpilogue` PendingStage folded through
  `settleProgram`'s `resumeTail` (deliberately REDEFINED from "mid-KO-sweep" to
  "mid-TAIL"). Its first family is DERIVED, not authored: `discardEnergy` gained
  `yourActive` + `count:"all"`, landing 12 catalog rows with zero registry rows,
  and interchangeable candidates began collapsing (a Basic keys on what it
  PROVIDES, not its id — the real catalog prints Basic Fire under three ids).
  engineVersion 0.22.0; 1227 → 1250 tests. Review: no HIGH from either agent; 9 of
  56 mutants survived, all fixed.
- **2026-07-21** (build #26) — **P3-M5: `discardEnergy` — the energy-removal "hammer"
  family, and the coin-gate playability bug it exposed** (D41; built solo — full context
  — then an adversarial engine+rules + web+integration review: **no HIGH in the slice's
  own logic from either**, but the engine review reversed a documented decision of mine).
  Chosen as the resume point's #1. ONE op takes Energy off the **OPPONENT's** in-play
  Pokémon, with **`from` naming both the eligible Pokémon and how many are hit** —
  `opponentActive` (Mawile), `opponentChosen` (Crushing Hammer), `opponentEach` (Giacomo)
  — and **all three arms land with a real printed card**, so no vocabulary is
  speculative. Exactly one Energy per affected Pokémon; **no `count` field**, because
  every printed "discard 2 / discard all" variant is an ATTACK. `opponentChosen` is a
  ONE-step decision (picking the Energy IS picking the Pokémon), so unlike `moveEnergy`
  there is no coupling to validate. **The engine's first MANDATORY park** — an empty pick
  is an ERROR, not a decline. New `specialEnergy` filter; one `ENERGY_DISCARDED` per
  affected Pokémon; the card goes to its OWNER's pile. Lands **Crushing Hammer**
  (sv01-168), **Giacomo** (sv02-182/252/267), **Mawile** (sv03-143). Web: one dialog
  (grouped by host, no decline, forced groups pre-answered, the spot in the legend), one
  log row, **no projection change**. engineVersion 0.20.0 → **0.21.0**; 1196 → **1227**
  tests, `bun run check` + `vite build` green.
  **The session's most important outcome was the review reversing me.** I shipped
  Crushing Hammer as playable into an Energy-LESS board, reasoning `programPlayable`
  scans top-level ops only and "the flip happens either way". Wrong: §7 / Compendium
  ruling/906 (reconfirmed by the TPCi Rules Team 2025-06-26) covers it, because **a coin
  flip is PROCEDURE, not effect**; the apparent counter-precedent (Unown-E's Hidden Power
  forcing all flips tails) is ruling/284's OTHER branch — blocked by an EFFECT → playable,
  blocked by the **game state** → not. `programPlayable` now descends into
  `coinFlipGate.then`, which also fixed a **pre-existing** bug (Pokémon Catcher into an
  empty opponent Bench). Poké Ball deliberately untouched — a deck is not public
  knowledge, the ruling's own limit — and `conditionGate` deliberately not extended.
  **Mutation testing (engine agent): 45 mutants, 41 killed, 4 equivalent**; the 5 real
  survivors were all test-adequacy and are now dead — the sharpest being `refKeyOf`
  dropping the bench index (two benched holders would FUSE into one group and park
  instead of auto-resolving) and `!==` → `<` on the required count (in scope "one" that
  admits two Energy off two DIFFERENT Pokémon — only the exact count catches it). The web
  agent found no soft-lock, no dispatchable-but-rejected choice and no leak; its 3 MEDs
  are fixed (log-row tone, `fieldset`/`legend` grouping, six missing tests), and I took
  two further UI calls off its report (pre-answer forced groups; put the spot in the
  legend). **Recorded, not fixed:** Mawile is the first "you may" trigger that cannot be
  declined, since this is the first mandatory parking op — left as-is because the op is
  pure upside, pinned by a test, with the trigger-level yes/no confirm as the real fix.
  **The bigger find is diagnostic:** scoping the family turned up **~13 more sv01–03
  cards** on the same idea blocked NOT by the op but by `attack.ts` running an attack's
  program as `runProgram(...).state` — so a parked result silently drops the prompt and
  the remaining ops. **No attack program may hold a decision.** That is now the top
  backlog row, with the fix's shape recorded (an `attackEpilogue` pending stage folded
  through `settleProgram`'s existing `resumeTail`).
- **2026-07-21** (build #25) — **P3-M5: board conditions — one `BoardCondition`
  vocabulary with TWO consumers** (D40; built solo — full context — then an adversarial
  engine+rules + web+integration review: **no HIGH from either**; 4 engine
  test-adequacy survivors + 4 web MEDs, all addressed). Chosen as the resume point's
  #1: the `conditionalPlay` family was the biggest remaining cluster. Built as **one
  primitive rather than a per-card flag**, which is the whole point of the slice.
  **`BoardCondition`** (effects.ts) is a predicate union evaluated for ONE seat —
  **`morePrizesThanOpponent`** (strict `>`: you are BEHIND on Prizes taken),
  **`yourStadiumInPlay`**, **`noEnergyOnYourPokemon`** (Active AND Bench, Basic or
  Special) — behind a single evaluator **`conditionHolds`** and a printed-text
  describer **`conditionNote`**. **The invariant IS the design: every member reads only
  PUBLIC state**, which is exactly why **a gate emits NO event** — contrast
  `coinFlipGate`, whose flip is genuinely new information; a board condition is a fact
  both players can read off the table, and the branch's own ops emit what happened.
  **Consumer A — the printed PLAY GATE:** `CardProgram.trainerPlayableIf`, checked by
  `playTrainer` BEFORE the card leaves hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`),
  so a failed gate costs nothing. Categorically distinct from `programPlayable`'s
  would-only-whiff heuristics: this is a rule PRINTED on the card, not the engine's
  judgement about ops that would do nothing. Named `trainer…` because it is honoured on
  EXACTLY one path — `playStadium`, `rareCandy`, `attachTool` and `useAbility` all
  return before it and would ignore it SILENTLY (the `trainerEndsTurn` precedent; also
  why Luxray's Ability-level gate must NOT be authored on this field).
  **Consumer B — the mid-program branch:** the **`conditionGate`** op
  `{cond, then, otherwise?}`, spliced into runProgram's work queue exactly like
  `coinFlipGate` — so an op inside a branch can still park, and a branch may hold
  further gates — evaluated against the board AS OF the gate. One-armed is the common
  shape (Falkner); **`otherwise`** exists for the printed "…**instead**", a genuine
  if/ELSE (Grusha). **One tiny new automatic op — `drawUntilHandSize`:** it DRAWS to a
  floor and never TRIMS a bigger hand, and at a count ≤ 0 it no-ops with NO event (no
  misleading "drew 0 cards" row). **Lands 3 COMPLETE real cards** (verified vs the
  local D1 catalog): **Fighting Au Lait** (sv02-181, Item — the gate + heal 60),
  **Falkner** (sv02-180/251, Supporter — authored as TWO draw ops, not one computed
  count, so the log shows both printed instructions), **Grusha** (sv02-184/253/268,
  Supporter — the `otherwise` arm; its hand count is measured AFTER the Supporter is
  discarded up front, which is the paper ruling for the hand-size family).
  **Web: zero new events, prompts, dialogs or projection fields.** The one change is
  the HUD greying a gated Trainer out with the engine's own `conditionHolds`, carrying
  `conditionNote` as the row's `title` + an `sr-only` line — load-bearing copy, because
  disabling the button REMOVES the reject pill that used to explain the printed rule,
  and that rule is text the HUD never shows. engineVersion 0.19.0 → **0.20.0**.
  **Review: NO HIGH from either agent.** The engine agent verified the slice's riskiest
  claim — **`yourStadiumInPlay` is OWNERSHIP, not presence** — against the Japanese
  printing of ハヤト (「場に**自分の**スタジアムが出ているなら」, "if **your** Stadium
  is out on the field") and Bulbapedia's Stadium article; an opponent's Beach Court
  must NOT grant Falkner's +2. Its **24-mutant** run left 5 survivors (1 equivalent),
  ALL test-adequacy — the gate read against the program's ENTRY state, the arm pushed
  to the BACK of the queue, the splice DROPPING the queue tail, a hand ABOVE the target
  being trimmed, and `conditionNote` returning wrong text. All are now fixed and
  **re-verified dead**, via two new fixtures: **fix-gateorder** (an attach BEFORE the
  gate that flips the condition, a two-op arm, and an op AFTER the gate — one ordered
  `CARDS_DRAWN` assertion kills three mutants at once) and **fix-gatedsup** (the only
  gated SUPPORTER, pinning that a rejected gate does not burn the §7.2 allowance, since
  every real gated card is an Item), plus a never-trims test and the first assertions
  on `conditionNote`'s player-facing wording. The web agent's 4 MEDs, all addressed:
  the missing `engineVersion` bump; unpinned log rows (3 tests added, incl. Falkner's
  PAIR of identical draw rows and Grusha's zero-row case); a **self-defeating** doc
  claim that "a P4 client may evaluate one locally"; and the HUD's opponent-`prizes`
  read. It also confirmed the ternary restructure is behaviour-preserving for every
  pre-existing card class, that no drag path bypasses the gate, that nothing outside
  the engine switches over `EffectOp` (`apps/api` does not depend on the engine at
  all), and that the error code is never rendered raw. **Recorded deviation
  (deliberate):** the HUD greys out a printed `trainerPlayableIf` gate while
  `programPlayable`'s whiff gates (Boss's Orders into an empty Bench) stay live and
  explain themselves via the reject pill — a rule printed on the card is knowable
  before clicking, an engine whiff-judgement is not; the tooltip is what makes the
  mixed standard coherent rather than a silent grey row. **P4 item recorded (NOT
  fixed):** `conditionHolds` takes a `GameState`, so only a raw-state host can run it —
  the projection does not carry `stadium.owner` and redacts the prize arrays to counts.
  The sharp edge: **a redacted prize array still has a `.length`**, so
  `morePrizesThanOpponent` would fail SILENTLY rather than loudly if shipped online
  unchanged. **Carried forward (pre-existing):** Fighting Au Lait is playable with
  nothing damaged anywhere (the Potion shape), which this slice makes conspicuous by
  enforcing the card's printed legality line; and `GameLog` announces only the batch's
  LAST row to screen readers, which a Falkner drawing 4 sharpens (it announces "drew 2
  cards", understating the play — and an unchanged live region announces nothing, so a
  second Falkner is silent). **Not demo-reachable:** none of the three cards is in the
  demo decks, so none of this is visible at `/play` without a deck change. `bun run
  check` green (tsc + biome + **1196 tests**, 1164 → 1196: 26 engine
  `boardCondition.test.ts` + 3 `logFromEvents.test.ts` + 3 HUD DOM), `vite build`
  green. Files: effects.ts, interpreter.ts, registry.ts, cardplay.ts, actions.ts,
  index.ts, testFixtures.ts, boardCondition.test.ts (new); web: GameHud.tsx + its DOM
  test, logFromEvents.test.ts. See "M5 op-slice: board conditions as built" + D40.
- **2026-07-21** (build #24) — **P3-M5: Iono — the `handRefresh` riders that CLOSE the
  hand-refresh family** (D39; built solo — full context — then an adversarial
  engine+rules + web+integration review: no HIGH, 2 MED, both fixed). Chosen as the
  resume point's #1: the format's **highest-play-rate Supporter**, and the last row of a
  family already built and vetted, so it lands as small riders on a reviewed op rather
  than a new mechanism. Verified against the local D1 catalog that **Marnie does not
  exist in sv01–03**, so Iono closes the row outright. **No new op** — three composable
  riders on D38's `handRefresh`: **`toBottom?: true`** (the PLACEMENT — shuffle the
  **hand alone** and append it UNDER the deck, `[...deck, ...shuffle(hand)]`, instead of
  shuffling it into the deck, so the deck's existing order and therefore the very next
  draws SURVIVE — the whole strategic difference from Judge, pinned by a test asserting
  the drawn cards are EXACTLY the pre-play deck top, in order); **`draw:{kind:
  "prizeCount"}`** (each affected player draws their OWN remaining Prize count — the
  player behind draws more; a Prize count is public, so the draw size leaks nothing);
  **`onlyIfAnyMoved?: true`** (the draw clause fires only if ≥1 affected player actually
  moved ≥1 card — an **all-or-nothing gate ACROSS the seats**, "if EITHER player…", not
  per-seat). **The one structural change:** that cross-seat gate needs every placement
  to happen before any draw, so `handRefresh` now runs **two passes** over the affected
  seats instead of D38's interleaved move-then-draw. **Behaviour-preserving** for
  Youngster/Judge/Brassius/Katy — per-seat zones are disjoint and `drawToHand` consumes
  NO rng, so final states and rng threading are byte-identical (the engine reviewer
  reconstructed the old loop and diffed hands/decks/`rngState` at 3 seeds each: identical;
  Katy identical modulo the one turn-start draw its `trainerEndsTurn` fold causes). The
  only change is Judge's event INTERLEAVING (SHUFFLED p1, SHUFFLED p2, DRAWN p1, DRAWN
  p2), which also reads truer to "each player shuffles … and draws". `shuffle` consumes
  nothing for a length ≤ 1 input, so **an Iono into two empty hands advances the rng ZERO
  times** and reorders nothing. One new event **`HAND_TO_BOTTOM_OF_DECK {seat, count}`**
  — count-only like its sibling, but **distinct** because the public fact differs (the
  deck's order is untouched, which both players must be able to read off the log).
  **Web: one log row, no dialog** (the op still never parks → no `EffectPrompt`, GameHud
  and the projection untouched) — "shuffled their hand (N cards) and put it on the bottom
  of their deck", which must say **both** verbs since the hand IS randomized on its way
  under an unshuffled deck. engineVersion 0.18.0 → **0.19.0**. **Review: no HIGH; 2 MED,
  both FIXED.** (1) Engine MED, found by **MUTATION testing** — deleting the hand shuffle
  left all 379 engine tests green, because every bottom-of-deck assertion was
  order-insensitive and **nothing in the repo asserted `rngState`**; fixed with two
  assertions (the bottomed cards are NOT in hand order — measured stable across 12 seeds;
  the both-empty play leaves `rngState` untouched) and the mutant re-run now fails. (2)
  Web MED, raised **independently by both agents** — the log row said only "put their
  hand … on the bottom", which against its sibling row reads as "Iono does not shuffle",
  so a player who had seen that hand would think the deck's tail was known; copy fixed.
  **LOWs applied:** an Iono degenerate-deck test (deck shallower than the Prize count
  short-draws and does NOT deck out — §14.3 is a turn-START rule), the describe-title
  rename, and a real end-to-end log test pinning the grouped 5-row batch (the two-pass
  restructure was otherwise unpinned on the web side). Also tidied: the stale dispatch
  comment, and the pass-2 lookup rebuilt as an ordered pair list so a captured hand size
  can never silently default. **Verified clean:** card conservation over every degenerate
  zone combination on both sides, exact rng advance counts (`(h1−1)+(h2−1)`), "Iono itself
  is never bottomed" (playTrainer discards up front), gate semantics (the `every`,
  per-seat, and opponent-prizes mutants each die to exactly one test), the projection
  serializing ZERO opponent uids, no exhaustive-switch fall-through (`apps/api` doesn't
  depend on the engine at all), HUD playability (enabled turn 2, §4-blocked turn 1, no
  prompt path reachable), and no demo regression. **Deliberate deviation (recorded in
  D39, at the reviewers' request):** Iono with EVERY affected hand empty is a total no-op
  yet stays **legal** — no `programPlayable` gate, unlike every other could-only-whiff op
  — because the digital clients allow it, it is self-inflicted and cannot soft-lock, and
  a gate would have to reach into "playTrainer discards the played card up front" (the
  D35 leaky coupling). **Two pre-existing items the review surfaced (NOT this slice):**
  every authored Supporter (Iono, Judge, Katy, Youngster, Professor's Research) carries
  `legal_standard=0` in the local ingest, so none surface in the deck builder's default
  standard-legal search; and `GameLog` announces only the LAST entry to screen readers,
  so a 5-row batch (Iono, Judge, any KO sweep) is mostly silent — a P5 polish item.
  `bun run check` green (tsc + biome + **1164 tests**, 1156 → 1164: 6 engine
  `handRefresh.test.ts` + 2 `logFromEvents.test.ts`), `vite build` green. Files:
  effects.ts, interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts,
  handRefresh.test.ts; web: logFromEvents.ts + its test. See "M5 op-slice: handRefresh
  riders as built" + D39.
- **2026-07-20** (build #23) — **P3-M5 op-slice: `handRefresh`** (D38; built solo —
  full context — then an adversarial engine+rules + web+integration review, BOTH
  CLEAN, no code fixes). The Iono/Judge/Marnie **hand-refresh Supporter family** —
  shuffle your hand into your deck, then draw — and the **highest-value clean unlock
  left** (high-play-rate staples that land COMPLETE as a fully-automatic op).
  Chosen over the from-the-top-attach compound (higher risk) and the `conditionalPlay`
  family (each card still needs a second effect op). New op **`handRefresh`**
  (`{op, who:"you"|"both", draw:HandRefreshDraw}`, effects.ts/interpreter.ts) — the
  FIRST op in a new class: **fully AUTOMATIC** (no decision → it NEVER parks, like
  drawCards/discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`,
  Judge — the first op to reach the OPPONENT's hand/deck). Per affected seat (a fixed
  order — controller first, then, for `both`, the opponent) it captures the PRE-shuffle
  hand size, moves the whole hand into the deck, shuffles the combined pile
  (`shuffle([...deck, ...hand])` — one rng advance; append-then-shuffle = "shuffle
  into"), then draws per **`HandRefreshDraw`**: `{kind:"fixed", count}` (Youngster 5,
  Judge 4, Katy 8) or `{kind:"handPlus", delta}` (Brassius "draw that many cards plus
  1" = the pre-shuffle hand size + 1). **Card conservation** is a pure multiset move
  (`combined = [...deck, ...hand]`, then `drawToHand` slices top `drawCount` → hand,
  rest → deck — invariant under empty-hand / empty-deck / hand==whole-deck / both-empty,
  all guarded); the played Supporter is discarded UP FRONT by `playTrainer`, so it is
  never shuffled back. `rngState` is read fresh each iteration and written back into
  `next`, so the two-shuffle Judge threads controller-then-opponent with no stale reuse
  / no dropped advance (reuses rng.ts's single vetted Fisher–Yates). **Always playable**
  (no `programPlayable` gate — you may always shuffle-and-draw, even from an empty
  hand); never damages/KOs. **Katy "your turn ends"** lands the `endsTurn` fold on the
  TRAINER path: a new CardProgram flag **`trainerEndsTurn?: true`** (parallel to
  `rareCandy`) that `playTrainer` reads and passes to `settleProgram`, folded
  **byte-for-byte like `AbilityProgram.endsTurn`** (the D34 Koraidon precedent — on
  DONE it seeds `turnTail(controller)`); every non-Katy trainer passes `endsTurn:false`
  and stays byte-identical to the old no-opts call — **no regression**. One new event
  **`HAND_SHUFFLED_INTO_DECK {seat, count}`** — count-only (a shuffled hand card is
  hidden); the deck reorder is intrinsic (no separate `SHUFFLE` event — none has an
  engine-state consumer). Representatives (verified vs the local D1 catalog, all
  Supporters): **Youngster** (sv01-198, draw 5), **Judge** (sv01-176, both draw 4),
  **Brassius** (sv03-187, draw hand+1), **Katy** (sv01-177/237, draw 8 + turn ends).
  **Web: one log row, no dialog** — handRefresh never parks, so NO new `EffectPrompt`/
  dialog (GameHud untouched); `logFromEvents` gains one count-only
  `HAND_SHUFFLED_INTO_DECK` row, the draw riding the existing count-only `CARDS_DRAWN`.
  **Hidden info (Judge — the first op to touch the opponent's hand): leaks NOTHING
  new** — the opponent's `CARDS_DRAWN` uids are the standard `drawToHand` contract every
  draw uses; the log's CARDS_DRAWN + HAND_SHUFFLED_INTO_DECK arms are both count-only,
  and the per-viewer projection already redacts the opponent's hand to uid-less
  `hiddenHand` backs. Katy's turn-end needs no web change (rides the existing phase→seat
  viewer-follow). engineVersion 0.17.0 → **0.18.0**. **Review (adversarial engine+rules
  + web+integration): BOTH CLEAN, no HIGH/MED, NO code fixes.** Engine agent proved card
  conservation over all four degenerate zone states, correct two-shuffle rng threading,
  the handPlus timing (no off-by-one), the Katy endsTurn fold consistent with Koraidon
  (full 374-test engine suite passes — no regression), purity against a recursive
  freeze, and all four texts byte-matching the catalog (no missed reprint — Katy's
  sv01-237 IS mapped; Iono/Marnie correctly deferred). Web agent proved the Judge
  hidden-info safe on BOTH the log and projection paths, that no exhaustive web switch
  breaks on the new event (the one `satisfies never` is over the Phase union, and Katy
  adds no phase), and that Katy's turn-end needs no web handling. **INFO (both, not
  bugs):** an empty hand emits `count:0` ("shuffled their hand (0 cards)…" — honest,
  non-leaky, the `HAND_DISCARDED "(0 cards)"` precedent); the no-separate-`SHUFFLE`-event
  choice is cosmetic with no downstream consumer. **Scope:** authors 4 COMPLETE
  Supporters — the whole `shuffleHandIntoDeck` backlog row (Youngster / Brassius / Katy)
  **plus Judge**, and closes the `endTurn` row (Katy joins Koraidon); Iono/Marnie layer
  later (a bottom-of-deck move + a `prizeCount`/split draw spec). `bun run check` green
  (tsc + biome + **1156 tests**, 1146 → 1156: 9 engine `handRefresh.test.ts` + 1
  `logFromEvents.test.ts`), `vite build` green. Files: effects.ts, interpreter.ts,
  events.ts, registry.ts, cardplay.ts, index.ts, testFixtures.ts, handRefresh.test.ts
  (new); web: logFromEvents.ts + its test. See "M5 op-slice: handRefresh as built" + D38.
- **2026-07-20** (build #22) — **P3-M5 op-slice: `moveEnergy`** (D37; built solo —
  full context — then an adversarial engine+rules + web review plus an independent
  Opus pass, CLEAN). The next backlog op by unlock count (5), and the interpreter's
  **first op with two COUPLED decisions** (which Energy AND where). New op
  **`moveEnergy`** `{filter, max}` moves up to `max` Energy from ONE of the
  controller's own in-play Pokémon to ANOTHER. Every op before this reused one
  existing prompt; a two-endpoint move can't, so it adds a **new compound prompt**
  `moveEnergy` (`movable`: each takeable Energy uid tagged with its source
  `PokemonRef`; `destinations`: all own in-play refs) and a **new choice**
  `{uids, dest}` answering both at once — applied **ATOMICALLY** by `moveEnergyApply`
  (strip the picks off their source, append to the dest in one `withSide`; a floating
  detached-Energy state never exists, which is why it is one compound park not two
  sequential ones with a leaked intermediate). "Up to"/declinable; ALWAYS parks when
  playable (never auto-resolves), the searchDeck/lookAtTopN family. **`validateChoice`
  (cardplay.ts)** enforces every coupling the compound decision needs: each uid an
  offered `movable` (distinct, non-string rejected), ALL picks share ONE source
  Pokémon (the printed "from 1 of your Pokémon"), dest an offered ref, and **dest ≠
  source** (no moving a Pokémon's Energy onto itself) — so a crafted P4 payload can't
  apply an illegal move. **`moveEnergyApply` conserves cards** (each picked uid removed
  from exactly one non-destination Pokémon, appended once to the dest; the dest is
  never stripped → no self-move/dup; stale/dest-resident uids skipped) and is pure
  like `searchMove` (the freeze test reaches the move). New **`programPlayable` gate**
  (`moveEnergyPlayable`: ≥1 Energy the filter admits AND ≥2 of your Pokémon in play) =
  the EXACT complement of `stepOp`'s no-op condition, so a gated card is never wasted
  and a playable card always parks (no silent no-op, no soft-lock — ≥2 Pokémon
  guarantees a legal source≠dest pair). One new `CardFilter` kind **`anyEnergy`**
  (Basic OR Special — Poppy moves either; Energy Switch stays `basicEnergy`) + one new
  event **`ENERGY_MOVED {seat, uids, from, to}`** (`from`/`to` are `PokemonTarget`
  copies; no bench compaction, so both resolve post-state). Representatives (verified
  vs the local D1 catalog): **Energy Switch** (sv01-173, Item — a Basic Energy, max 1),
  **Poppy** (sv03-193/220/227, Supporter — up to 2 any Energy, max 2). **Web: a new
  dialog + a log row** — `MoveEnergyDialog` is a staged pick like Rare Candy (source
  → its Energy + a distinct destination → Confirm, or **Move none** to decline), which
  can only ever dispatch a `validateChoice`-accepted choice (dest drawn from
  destinations-minus-source; picks capped at `max`, all from the one selected source);
  new `ENERGY_MOVED` log row ("moved N energy from X to Y"). **This prompt leaks
  NOTHING** — its `movable`/`destinations` are entirely the controller's OWN face-up
  in-play Energy/Pokémon (public table facts), so — uniquely among the parking ops so
  far — no P4 redaction is even needed for it (contrast searchDeck/lookAtTopN, whose
  deck-order candidate uids are the standing P4-deferral INFO). engineVersion 0.16.0 →
  **0.17.0**. **Review: CLEAN, no HIGH/MED** — card conservation under dest==source /
  dest-resident pick / stale uid / two-source pick / bench-index shift; every illegal
  wire payload rejected; the gate ⇔ no-op equivalence; purity; rules accuracy (Poppy
  moves Special too, Energy Switch basic-only, same-source enforced, no §6.3 attach
  allowance touched); and the dialog can't dispatch a rejected choice. **One action:**
  the auto-selected single-source path was tested but the **multi-source source-picker
  stage** (and its Back/reset) was not — added a two-source Poppy DOM test. **INFO
  (not a bug):** Energy Switch's text is not "you may", so allowing a decline is a
  minor documented deviation (harmless — the player just wouldn't play the card),
  consistent with the "up to"/declinable search family. **Scope:** authors 2 of the
  op's 5 backlog cards (own→own); the other 3 layer riders — Armarouge "Fire Off" (a
  {R} Energy benched→Active, an Ability), Mismagius "Magical Flick" (the OPPONENT's
  Energy on evolve, an onEvolve trigger), Exp. Share (an on-KO Tool trigger). `bun run
  check` green (tsc + biome + **1146 tests**, 1126 → 1146: 16 engine + 1 log + 3 DOM),
  `vite build` green. See "M5 op-slice: moveEnergy as built" + D37.
- **2026-07-20** (build #21) — **P3-M5 op-slice: `lookAtTopN`** (D36; built solo —
  full context — then a 2-agent Opus review, BOTH CLEAN). The next backlog op by
  unlock count, and the **top-of-deck twin of the vetted `searchDeck` op** — look
  at the top `n` cards, put up to `max` matching a filter into HAND, then shuffle.
  New op **`lookAtTopN`** `{n, filter, max}` looks at `deck.slice(0, n)` (index 0 =
  the top, per `drawToHand`) and PARKS on the **same `chooseCards` prompt** (no new
  dialog/prompt/wire shape) — but the candidates are ONLY the `filter` matches among
  the **top `n`**, in deck order, never a deeper card. "Up to"/declinable → parks on
  ≥1 candidate; an empty top-`n` match is a no-op. **Wire-safety is free:**
  `resolveEffect`/`validateChoice` already rejects any pick not in the candidate set
  (`BAD_EFFECT_CHOICE`), so a client cannot reach past the window; the new mover
  **`revealFromTop`** (mirrors `searchMove`/`retrieveMove`) keeps the `deck.includes`
  secondary guard. "Shuffle the other cards back into your deck" is the trailing
  **`shuffleDeck`** op (the Nest Ball search-then-shuffle pattern), so a whiff OR a
  decline still shuffles. **No new `CardFilter`** (Great Ball reuses `anyPokemon`,
  Pokégear reuses the `supporter` filter added with Pal Pad in D35); **no
  `programPlayable` gate** (a look-at-top is always playable — you look and shuffle
  even on a guaranteed whiff, so it never soft-locks). One new event
  **`DECK_TOP_REVEALED {seat, uids}`** (count-only in the log — honest "looked at the
  top of their deck" rather than DECK_SEARCHED's "searched"; the taken cards are
  revealed/public per the printed "reveal", and the non-taken looked-at cards never
  enter any event). Representatives (verified vs the local D1 catalog, both Items):
  **Great Ball** (sv02-183 — top 7, reveal a Pokémon → hand), **Pokégear 3.0**
  (sv01-186 — top 7, reveal a Supporter → hand). **Web: one log row, nothing else** —
  the shared origin-agnostic `ChooseCardsDialog` (relabeled "Choose cards" in D35)
  renders the accurate `prompt.note` ("Look at the top 7 cards of your deck and put a
  Pokémon into your hand." / "…a Supporter card into your hand."), and the projection
  forwards the `chooseCards`/`dest:"hand"` prompt with no change (nothing switches on
  `dest`). engineVersion 0.15.0 → **0.16.0**. **Review (2 Opus agents — engine+rules /
  web+integration): BOTH CLEAN, no HIGH/MED correctness bugs, NO code fixes.** The
  engine agent (8-test suite + a 22-assertion probe) proved card conservation
  (symmetric deck→hand move + the shuffle permutation), candidate correctness =
  **exactly the top-`n` matches** (the window boundary PINNED — a match at index 6 IS
  a candidate, one at index 7 is NOT; a shallow deck with `n` > length and `n ≤ 0`
  both handled by `slice`/`Math.max(0,n)` with no over-read), wire-safety (a deeper /
  duplicate / over-max / non-string pick all rejected), shuffle-always-fires (the
  trailing op lives in the continuation `rest`), no flow-tail/KO interaction, purity
  (the freeze reaches `revealFromTop`), and program-vs-text. The web agent proved log
  honesty + count-only + correct hot-seat seat attribution, the projection "unchanged"
  claim (no `dest` switch; the event handled in the one web event switch), the dialog
  serves the note, and no demo regression. **INFO (both agents, PRE-EXISTING P4
  deferral — not this slice):** the parked `chooseCards` prompt carries the top-`n`
  candidate uids unredacted per-viewer — identical to `searchDeck`/`discardPileRetrieval`,
  unobservable in the local hot-seat (the dialog renders only for the acting viewer),
  and exactly what P4's server filter must redact for the non-acting viewer; a second
  INFO notes `revealFromTop` does not dedup its input before the hand-append
  (unreachable — validateChoice rejects duplicates first — and the identical contract
  as the vetted movers, kept consistent rather than singled out). **Scope:** authors
  2 of the op's 5 backlog cards; the other 3 need a from-the-top **attach** variant
  (Electric Generator sv01-170 / Hydreigon sv02-140 — which ALSO unblocks 2 of the
  remaining attachEnergyFrom cards) or an opponent-deck peek (Malamar sv03-138).
  **1117 → 1126 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts (2 Item fixtures
  + `LOOK_AT_TOP_DECK` + the `toDeckTop` surgery), lookAtTopN.test.ts (new); web:
  logFromEvents.ts, logFromEvents.test.ts.
- **2026-07-20** (build #20) — **P3-M5 op-slice: `discardPileRetrieval`** (D35;
  built solo — full context — then a 2-agent Opus review, BOTH CLEAN). The
  next-biggest backlog unlock after `attachEnergyFrom` (6 cards), and a near-exact
  **mirror of the vetted `searchDeck` op** — source = the DISCARD pile, dest = hand
  or deck. New op **`discardPileRetrieval`** `{filter, dest:"hand"|"deck", max}`
  retrieves up to `max` matching cards, "up to"/declinable, PARKS on the **same
  `chooseCards` prompt** (no new dialog/prompt/wire shape), no-op on empty match, no
  bench-space clamp (hand/deck uncapped). `dest:"deck"` appends to the deck end, so
  "Shuffle … into your deck" is authored `[discardPileRetrieval(dest:deck),
  shuffleDeck]` (the Nest Ball search-then-shuffle pattern; a whiffed play still
  shuffles — self-affecting only, never illegal). `retrieveMove` mirrors
  `searchMove` (dedup Set, only in-discard uids move, wire-checked by the existing
  `validateChoice`). Two new `CardFilter` kinds — **`supporter`** (Trainer +
  "Supporter") and **`pokemonOrBasicEnergy`** (Pokémon OR a `Normal` basic Energy —
  Special excluded) — and one new event **`DISCARD_RETRIEVED`** (count-only log; the
  discard pile is public). Representatives (verified vs local D1, all Items):
  **Energy Retrieval** (sv01-171 — 2 Basic Energy → hand), **Pal Pad** (sv01-182 — 2
  Supporters → deck), **Super Rod** (sv02-188/276 — 3 Pokémon/Basic Energy → deck).
  **Web (small honest touch, not "unchanged"):** the shared `ChooseCardsDialog`'s
  accessible label changed **"Search your deck" → "Choose cards"** (it now serves a
  deck search AND a discard retrieval; the accurate description rides `prompt.note`,
  which reproduces the printed card text), the `chooseCards` prompt `dest` union
  widened to include `"deck"` (inert at every consumer — the dialog never reads
  `dest`), and `logFromEvents` gained one `DISCARD_RETRIEVED` row (2 dom assertions
  updated). engineVersion 0.14.0 → **0.15.0**. **Review (2 Opus agents — engine+rules
  / web+integration): BOTH CLEAN, no HIGH/MED correctness bugs.** Engine agent proved
  card conservation (symmetric remove/append, no clamp needed), filter semantics
  (Special Energy + Trainers excluded), park/resume with **no deck-order leak** (park
  is before the move; the trailing `shuffleDeck` runs synchronously in the resume
  batch, never dropped), self-reference + flow-tail safety. Web agent proved no
  hidden-info leak (count-only log, both discard piles public in the projection) and
  an inert `dest` widening. **Fixes applied:** one MED — the purity test froze the
  PRE-park state and never reached `retrieveMove` (the mutation runs during the later
  `resolveEffect`), strengthened to freeze the parked state and drive the resolve;
  LOWs — pinned the `retrieveNote` strings, added the Super Rod degenerate-ends
  (only-Pokémon / only-Energy) + a take-none-with-trailing-shuffle case. **INFO
  (forward-looking, not triggered):** `playTrainer` discards the played card up
  front, so a FUTURE self-matching card (a Supporter on this op with
  `filter:supporter`) would offer itself as a candidate — flagged in the op's
  authoring note; the 3 Items are all safe (no filter matches an Item). **Scope:**
  authors 3 of the op's 6 backlog cards; the other 3 need `discardFromHandCost`
  (Superior Energy Retrieval), a conditional draw (Miriam), or an Ability (Pelipper).
  Chosen over the resume point's #1 (deck-search-attach) because that op leaves every
  one of its 4 cards still blocked on a SECOND op, while this lands complete cards.
  **1106 → 1117 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts,
  discardRetrieval.test.ts (new); web: GameHud.tsx, logFromEvents.ts,
  GameHud.cardplay.dom.test.tsx.
- **2026-07-19** (build #19) — **P3-M5 op-slice: attachEnergyFrom MULTI-attach +
  endsTurn** (D34; built solo — full context — then a 2-agent Opus review, BOTH
  CLEAN). Authoring **Koraidon ex "Dino Cry"** (sv01-125/231/247/254 — attach up to
  2 Basic {F} from discard to your Basic {F} Pokémon in any way, then your turn
  ends). Three ideas: **(1) MULTI-attach needs NO new op** — "attach up to N in any
  way you like" is just **N `attachEnergyFrom` ops** in one program (the interpreter
  parks on each op's target in turn — independent target per energy — and a later op
  that finds no matching Energy no-ops, so the program attaches min(N, available);
  the "may attach fewer" is auto-maxed, the pure-upside doctrine); **(2)**
  **`basicOnly`** — a target-filter rider (the target must be `isBasicPokemon`, with
  `targetType:"Fighting"` → "your Basic {F} Pokémon"), added to
  `attachEnergyTargets`; **(3)** **`AbilityProgram.endsTurn`** — a flag that ENDS
  the controller's turn once the program completes, folded by **`settleProgram`**
  (flow.ts: on DONE, seed `turnTail(controller)` + advance — byte-for-byte the
  normal `endTurn` action — instead of returning to turn:action), threaded across
  re-parks by a new **`endsTurn?: true`** on the `effect:choose` Phase (parallel to
  `resumeTail`, mutually exclusive). The DONE+endsTurn branch skips the mid-turn KO
  sweep (Koraidon does not damage; the folded Checkup catches any KO regardless).
  **Web: UNCHANGED** — the two sequential parks + the turn-end transition ride the
  existing effect:choose/choosePokemon path + the viewer-follow (the device flips to
  the opponent when the turn ends), exactly like the on-KO `resumeTail` re-park.
  engineVersion 0.13.0 → **0.14.0**. **Review (2 Opus agents — engine+rules / web):
  BOTH CLEAN, no HIGH/MED/LOW bugs.** Engine agent: the endsTurn fold consistent
  with the normal turn end (same `advance(turnTail)` shape → no stale-phase leak;
  the flag survives both re-parks, fires only on the final DONE), multi-attach no
  double-attach / no over-reject (op #2 re-finds energy on the post-op-#1 state),
  basicOnly total (no throw on `types:null`), and — bonus — poison-KOs during the
  folded Checkup resolve correctly. Web agent (real web-layer probe): the endsTurn
  Phase field doesn't break the exhaustive switch, both parks report the controller
  active/waiting, the turn-end flips the viewer to the opponent, the two parks
  re-render cleanly (stable dialog key), no demo regression. INFO only: a *damaging*
  endsTurn ability (none in scope) would resolve KOs via the Checkup sweep with a
  timing difference; no button cue that Dino Cry ends the turn (by design). **Scope:**
  authors Koraidon ex — **4 of the 11** attachEnergyFrom cards; the other 7 need a
  deck-search source / `lookAtTopN` / self-KO / onEvolve / can't-attack /
  attach-to-self / special-energy-by-name. **1101 → 1106 tests**, `bun run check` +
  `vite build` green. Files: effects.ts, interpreter.ts, registry.ts, types.ts,
  flow.ts, cardplay.ts, index.ts, testFixtures.ts, dinoCry.test.ts (new) + docs
  (D34, coverage-backlog.md, simulator.md, progress.md).
- **2026-07-19** (build #18) — **P3-M5 op-slice: `attachEnergyFrom` RIDERS**
  (D33; built solo — full context — then a 2-agent Opus review, BOTH CLEAN). The
  D32 attach op grew three composable RIDERS authoring the marquee **Gardevoir ex
  "Psychic Embrace"** (sv01-086/228/245): **`targetType`** (eligible targets = the
  controller's own Pokémon whose TOP card is that type — {P}), **`bonusCounters`**
  (put N HP of damage counters on the Pokémon just attached to — 2 = 20, as
  `COUNTERS_PLACED` source "ability"), **`notIfKO`** (exclude any target the
  bonusCounters would Knock Out — `damage + bonusCounters ≥ effectiveMaxHp`, the
  exact complement of the KO test, so the counters are ALWAYS non-lethal and the
  op still never KOs). The filtered candidate set is a new exported
  **`attachEnergyTargets`** (interpreter.ts), shared by the park AND
  `programPlayable` (which now also rejects when NO eligible target remains — a
  play that does nothing can't be made). Gardevoir's program: `{attachEnergyFrom,
  source:"discard", energyType:"Psychic", targetType:"Psychic", bonusCounters:20,
  notIfKO:true}`, `oncePerTurn:false` (repeatable — "as often as you like").
  **Web: UNCHANGED** — reuses the choosePokemon dialog + ENERGY_ATTACHED + the
  COUNTERS_PLACED "ability" log row + the damage chip (the 2 self-counters render
  as damage). engineVersion 0.12.0 → **0.13.0**. **Review (2 Opus agents —
  engine+rules / web): BOTH CLEAN, no HIGH/MED bugs.** Engine agent proved the
  notIfKO non-lethal guarantee AIRTIGHT (a basic-energy attach cannot shift
  `damage`/`effectiveMaxHp` between park and apply — those read only the top card +
  tools, never energy; the `≥` boundary matches the KO test; and settleProgram's
  DONE sweep is a safety net regardless — empirically Gardevoir stops at exactly
  15 uses / 300 damage, never KO'd), plus targetType/bonusCounters correctness, no
  base-op regression, wire-safety, purity. Web agent verified the reuse claim
  through the real HUD (133 tests + probe): the repeatable button never greys, the
  choosePokemon dialog dispatches a legal controller-seat choice, the self-counters
  render, the log reads sensibly, no soft-lock (a no-eligible-target Gardevoir
  rejects `NO_LEGAL_TARGET` before parking an empty dialog), no demo regression.
  One LOW (a stale COUNTERS_PLACED "ability" log COMMENT — the render was correct)
  fixed. **Scope:** authors Gardevoir ex — **3 of the 11** attachEnergyFrom cards;
  the other 8 need multi-attach / deck-search source / `lookAtTopN` / "turn ends" /
  self-KO / onEvolve / special-energy-by-name. **1095 → 1101 tests**, `bun run
  check` + `vite build` green. Files: effects.ts, interpreter.ts
  (`attachEnergyTargets` + bonusCounters), cardplay.ts (programPlayable),
  registry.ts, index.ts, testFixtures.ts, psychicEmbrace.test.ts (new),
  logFromEvents.ts (comment fix) + docs (D33, coverage-backlog.md, simulator.md,
  progress.md).
- **2026-07-19** (build #17) — **P3-M5 op-slice: `attachEnergyFrom`** (D32; built
  solo — full context — then a 2-agent Opus review, BOTH CLEAN). The first new op
  built off the D31 coverage backlog (its top unlock, 11 cards). **`attachEnergyFrom`**
  (`{op, source:"hand"|"discard", energyType?}`, effects.ts/interpreter.ts)
  attaches ONE Basic Energy from the controller's hand or discard pile onto a
  CHOSEN own in-play Pokémon (§6 acceleration). Key simplification: same-type
  Basic Energy is FUNGIBLE, so there is no "which energy" choice — the op picks
  the first match and the only decision is the TARGET, reusing the existing
  `parkOrForce` → `choosePokemon` prompt; it re-finds the first matching energy at
  APPLY time (deterministic — while parked on effect:choose only the controller's
  `resolveEffect` is legal, so the source is frozen). A source with no matching
  energy is a no-op, and **`programPlayable`** (cardplay.ts) blocks activating an
  Ability whose attach could only whiff (the gust/snipe precedent — the shared
  `firstAttachableEnergy`, exported). NOT the §6.3 one-per-turn manual attach — no
  allowance touched; reuses `ENERGY_ATTACHED` (host by uid). Representatives:
  **Quaquaval "Energy Carnival"** (sv01-054, any Basic from hand, oncePerTurn:true)
  + **Baxcalibur "Super Cold"** (sv02-060/210, {W} from hand, **REPEATABLE**
  oncePerTurn:false → the HUD button never locks out) + a FIXTURE **fix-attacher**
  for the discard branch (the clean real discard cards carry riders needing later
  ops). New test surgery `discardFromDeck`. **Web: UNCHANGED** — no new
  EffectPrompt (choosePokemon), no new event (ENERGY_ATTACHED), no new phase; the
  slice-2 Ability button + choosePokemon dialog + log row serve it as-is.
  engineVersion 0.11.0 → **0.12.0**. **Review (2 Opus agents — engine+rules /
  web+integration): BOTH CLEAN, no HIGH/MED/LOW correctness bugs.** Engine agent
  (6 probes): no energy dup/loss (found-in / removed-from zones provably
  identical), fungibility re-pick safe, wire-safety (hostile ref rejected, no
  throw), ENERGY_ATTACHED contract (copied target, no allowance, emit-only),
  discard order preserved, purity. Web agent (7 real-HUD probes): the reuse claim
  holds (no `src/` change), the repeatable button never greys, the choosePokemon
  dialog dispatches a legal controller-seat choice, the log row is source-agnostic,
  the projection keeps the viewer on the controller, no demo/`/play` regression.
  One INFO (unreachable today): `programPlayable` runs BEFORE an ability cost is
  paid, so a future cost+hand-attach ability whose only match is the cost card
  could pass the gate then no-op (wasted, never corrupt) — revisit with the
  discard-with-rider variants. **Scope:** single-attach only — authors **2 of the
  11** attachEnergyFrom backlog cards; the other 9 layer riders (multi/+counters/
  ends-turn/self-KO/deck-search/`lookAtTopN`/attach-to-self/special-energy-by-name).
  **1087 → 1095 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, cardplay.ts, registry.ts, index.ts, testFixtures.ts,
  attachEnergyFrom.test.ts (new) + docs (D32, coverage-backlog.md, simulator.md,
  progress.md).
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
