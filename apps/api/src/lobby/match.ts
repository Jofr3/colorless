// P4 — the lobby → engine handoff (online.md). When a lobby's countdown ends with
// both players ready, the DO starts a real match: it instantiates the P3 engine
// server-side and owns the RNG seed + hidden info. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// card pool from D1 (`loadCardPool`) and calls `startMatch`, then persists + redacts
// the result.

import {
  type CreateGameResult,
  type GameAction,
  type GameState,
  type Seat,
  applyAction,
  createGame,
  formatElapsed,
  logFromEvents,
} from "@luminous/engine";
import type { Card, LobbySnapshot, SeatLogEntry, WireAction } from "@luminous/schema";
import { slotOf } from "./logic";

/** The one place the lobby's seats map to the engine's: host → p1, guest → p2. */
export const SEAT_OF_SLOT = { host: "p1", guest: "p2" } as const satisfies Record<
  "host" | "guest",
  Seat
>;

/** The engine seat whose REDACTED view the socket-holder `playerId` receives —
    host → p1, guest → p2 (SEAT_OF_SLOT), or null for a player not seated in this
    lobby (a refused/observer socket). The DO's per-viewer match broadcast keys
    each socket's redaction off this. */
export function matchSeatOf(snapshot: LobbySnapshot, playerId: string): Seat | null {
  const slot = slotOf(snapshot, playerId);
  return slot === null ? null : SEAT_OF_SLOT[slot];
}

export interface StartMatchOptions {
  /** The authoritative RNG seed the DO owns for this match (shuffle + coin flip). */
  seed: number;
  /** The host's 60-card deck as a flat list of catalog ids (becomes p1). */
  hostDeck: readonly string[];
  /** The guest's 60-card deck (becomes p2). */
  guestDeck: readonly string[];
  /** Every distinct card id in either deck, resolved to its full catalog Card. */
  cardPool: Record<string, Card>;
}

/** Create the engine game for a lobby handoff. A thin, deterministic wrapper over
    `createGame` that fixes the seat mapping; returns the engine's own result (which
    validates deck size + a Basic and pauses at the first-player choice, or reports
    a `CreateError`). */
export function startMatch(opts: StartMatchOptions): CreateGameResult {
  return createGame({
    seed: opts.seed,
    decks: { p1: [...opts.hostDeck], p2: [...opts.guestDeck] },
    cardPool: opts.cardPool,
  });
}

/** What the DO persists when a lobby becomes a match: the authoritative
    full-information `GameState` plus the seed it was created from (audit/replay).
    Seats map by `SEAT_OF_SLOT`. Stored under the DO's match key and, from
    increment 1c, redacted per seat before it crosses the wire. */
export interface MatchRecord {
  /** The persisted shape's version (`MATCH_RECORD_VERSION` at write time). Read
      back through `readMatchRecord`, which retires anything that doesn't match —
      the DO has no storage migrations (online.md), so versioning IS the migration
      story: a record the running code can't trust is dropped, not guessed at. */
  version: number;
  /** The RNG seed the DO minted for this match. */
  seed: number;
  /** Epoch ms the match started — the log's "+MM:SS" elapsed origin (2b-iii-d-ii). */
  startedAt: number;
  /** Display names per seat (the lobby player names: host → p1, guest → p2) — the
      log's system rows read them ("Ana wins the toss"). Fixed for the match. */
  names: Record<Seat, string>;
  /** The engine's full game state — never sent whole to a client (online.md). */
  state: GameState;
  /** The accumulated game log, seat-keyed + leak-safe (@luminous/engine
      `logFromEvents`). Grows as actions apply; the DO broadcasts it WHOLE on every
      match frame (a reconnect gets the full backlog), and each client relabels it
      for its own seat (`viewLogEntries`). It can't be rebuilt from `state` — it is
      the running record of every event since createGame — so it is persisted here
      beside the state it describes. */
  log: SeatLogEntry[];
}

/** The version stamped into every `MatchRecord` this deploy writes.
    **BUMP IT** whenever the record's own shape changes OR the engine's
    `GameState`/`SeatLogEntry` shape changes under it — i.e. whenever a match
    persisted by the previous deploy could no longer be read correctly. A deploy
    that changes neither leaves this alone and live matches survive it.

    Why a version rather than defaulting the missing fields on read (the shape the
    2b-iii-d-ii LOW first proposed): defaulting fixes only the fields we happen to
    know went missing, and says nothing about the far more dangerous case — an
    embedded `GameState` written by an engine whose RULES have since moved, which
    reads back "fine" and then plays subtly wrong. A version covers both, and
    turns "the DO has no migrations" from a silent hazard into a loud, recoverable
    one: the match is retired and the players are told to re-ready.

    WIDENING is not a bump. 3c-ii added a `conceded` member to the engine's
    `GameOverReason` and left this at 1 on purpose: a record written before it
    holds only the older reasons, which this build still understands, so live
    matches survive the deploy. The test is always "could the PREVIOUS deploy's
    record be misread by THIS one", not "did any type change".

    1 → 2 (engine 0.75.0, D124): `InPlayPokemon` gained a REQUIRED `promotedTurn`
    field. Every in-play Pokémon in a record written by the previous deploy lacks
    it entirely — a missing required field, not a widened enum, so the embedded
    `GameState` is one this build cannot claim to have written. It would in fact
    read back benignly (`undefined === state.turn` is false, i.e. "did not move
    this turn"), and that is exactly the trap this version exists to refuse: the
    rule is "could the previous deploy's record be misread", and a silently
    defaulted rules-relevant field is the misreading the doc above names.

    2 → 3 (engine 0.89.0, D140): the engine's `damageChosen` `EffectOp` gained a
    REQUIRED `source: "ability" | "attack"` field, and that op **PARKS** — so it is
    embedded in `GameState.phase.cont.pendingOp` whenever a snipe is waiting on its
    pick, which is a live, reachable, persisted position rather than a type that
    only exists in memory. A record written by the previous deploy while such a
    park was open comes back with the field ABSENT; this build reads it, hands
    `undefined` to `placeSnipe`, and emits `COUNTERS_PLACED` with no `source` — a
    row that falls off every labelled log arm onto the active-voice default, i.e.
    it renders under the DAMAGED player's name as though they had done it. That is
    the D124 case verbatim: a MISSING REQUIRED FIELD, not a widened enum, and one
    that reads back "fine".

    ⚠️ AND THE CONTRAST WITH D139 IS THE WHOLE REASON THIS ONE BUMPS. D139 added
    the SAME field, with the same members, to `damageActive` and correctly left
    this alone — because `damageActive` never parks, so no `EffectContinuation` has
    ever carried one and nothing persisted moved. The test is not "did an op gain a
    field" but "can the previous deploy's RECORD hold the old shape", and that
    turns entirely on whether the op can be sitting in `phase.cont` when the write
    happens. Two slices, one field, opposite answers — the same shape as D131's
    widen-don't-add rule being a TEST rather than a default.

    ⚠️ 3 → 4 (D142, engine 0.91.0) — AND THIS ONE IS D124's CASE RATHER THAN
    D140's, which is why it bumps for a reason the previous paragraph does not
    cover. Nothing about an `EffectOp` moved: the change is a NEW REQUIRED FIELD ON
    `InPlayPokemon` — `attackBlock: AttackBlock | null`, the turn-stamped §11
    installation behind "During your opponent's next turn, prevent all damage
    [from and effects of] attacks done to this Pokémon." — so EVERY Pokémon in
    play in a record written by the previous deploy is missing it, exactly as
    every one of them was missing `promotedTurn` at D124.

    It would read back BENIGNLY, and that is precisely the trap this constant
    exists to refuse. `attackBlockOf` (continuous.ts) tests `block !== null &&
    block.turn === state.turn`; an absent field is `undefined`, the first test is
    true and the second is false, so an old record would resolve to "no block" —
    which even happens to be CORRECT, since no such block could have been
    installed by a deploy that had no op to install one. The bump is not because
    the value would be wrong today; it is because the TYPE would be a lie, and the
    next slice to add a durated field (Ninetales' self-attack lock, Lycanroc ex's
    installed counterattack — both stamped the same way) inherits whichever answer
    this one gave. D124 refused the soft landing on the identical shape; refusing
    it again keeps the rule a rule.

    The engine's `invokedBy?: "attack"` on `EffectContext` — the other persisted
    shape D142 touched, since `ctx` rides `EffectContinuation` into
    `phase.cont` — is an OPTIONAL field and therefore a WIDENING (D125's
    distinction): an old continuation simply lacks it, which reads as "not an
    attack" and reproduces the pre-slice behaviour exactly. It would not have
    bumped anything on its own, and the question was asked rather than folded in.

    ⚠️ 4 → 5 (D143, engine 0.92.0) — D142's case AGAIN, on the SECOND stamped
    field, and the repeat is the point rather than an embarrassment. Nothing about
    an `EffectOp` moved (the new `preventAttack` op is a new UNION MEMBER, which is
    a WIDENING by D125's distinction, and it never parks; `damageChosen` gained no
    field, so the one parking op this slice touches serializes byte-identically).
    What moved is, once more, a NEW REQUIRED FIELD ON `InPlayPokemon` —
    `attackLockedTurn: number | null`, the turn-stamped §8/§11 self-lock behind
    "During your next turn, this Pokémon can't attack." — so every Pokémon in play
    in a record written by the previous deploy lacks it.

    And once more it would read back BENIGNLY: `attackLocked` (continuous.ts) tests
    `pokemon.attackLockedTurn === state.turn`, an absent field is `undefined`, and
    `undefined === 4` is false — so an old record resolves to "not locked", which
    is even CORRECT, no such lock having been installable by a deploy with no op to
    install one. That is precisely the soft landing this constant refuses, for the
    third time on the identical shape (D124's `promotedTurn`, D142's `attackBlock`,
    now this). The rule is worth more than the three retired matches: the test is
    "can the PREVIOUS deploy's RECORD hold the new TYPE", and a field that reads
    back plausibly is the one case where getting it wrong is invisible.

    ⚠️ AND THE NEXT ONE WAS ALREADY VISIBLE — it landed at D147, and the
    generalisation this note argued for was WEIGHED AND DECLINED, so the note now
    records the verdict rather than the forecast. `InPlayPokemon.damageReduction`
    is the THIRD required stamped field and it bumps this constant 5 → 6, for
    D124/D142/D143's reason verbatim (a required key on `InPlayPokemon` makes every
    body in an old record the wrong TYPE, whatever it reads back as). The
    generalisation into ONE installed-effects record would ALSO have bumped once,
    here, and would then have made further durated effects free — that argument is
    real and it is why the question was asked with three readings in hand. What
    killed it is that the saving is a one-off ~3 lines at the §10 clear sites plus
    a bump this slice pays either way, against a permanent cost at every read site:
    a discriminated union turns `pokemon.attackBlock` (a field tsc checks) into a
    search tsc cannot check the totality of. And the read path this item was
    predicted to SHARE turned out not to be shared — the four damage sites ask two
    independent questions at two different steps of §8.5 (subtract a number vs
    supersede the result), so a union would have merged the STORAGE and lengthened
    the LOOKUP. See D147 in decisions.md for the full table and for the NEW trigger
    it names (the first caller that must ENUMERATE the installed effects rather
    than ask for one by name — the pool prints no such printing today).

    ⚠️ NO BUMP AT D144 (engine 0.93.0), asked rather than omitted — and the
    question was a real one. That slice added `coinFlipGate.onTails?: true`, and a
    `coinFlipGate` sitting behind a PARKING op genuinely does ride
    `EffectContinuation` into `phase.cont` and therefore into a persisted record.
    But it is an OPTIONAL field, i.e. a WIDENING (D125's distinction), and an old
    continuation simply LACKS the key — which `runProgram` reads as "heads wins",
    reproducing the pre-slice behaviour exactly, because every gate this engine
    could have persisted before D144 was heads-gated by construction. That is the
    opposite of the case bumped three times above: there a REQUIRED field made the
    old record's TYPE a lie whatever it read back as; here the type still describes
    the old record, and there is nothing to retire. Nothing else persisted moved —
    no `InPlayPokemon` field, no `GameState` field, no event and no log wording.

    ⚠️ NO BUMP AT D145 EITHER (engine 0.94.0), and the reason is STRONGER than
    D144's rather than the same. That slice added two `deriveAttackEffect` arms
    over the field D144 had already built, and **NEITHER of their ops can PARK** —
    `discardEnergy { count: "all" }` "asks nothing" and resolves inline, and
    `damageSelf` places counters with no decision in it — so neither derived
    program can reach `EffectContinuation` at all, and D144's persistence edge is
    not merely widened but UNREACHABLE for these two. No new op, no new field, no
    new event, no new `InPlayPokemon` key and no log wording change: there is
    nothing a previously written record could fail to describe. Asked rather than
    omitted, because "an arm over an existing field" is exactly the shape a
    session skips the question on.

    ⚠️ NO BUMP AT D146 EITHER (engine 0.95.0), and the reason is a THIRD distinct
    one — worth stating, because this slice DID add a field to a shape that gets
    persisted, which is the exact trigger three of the four bumps above fired on.
    `AttackBlock.fromClass?: "Basic"` (the printed "…by attacks from Basic
    Pokémon") lands INSIDE `AttackBlock`, not on `InPlayPokemon`. The difference
    is the whole answer: `attackBlock` itself is a REQUIRED key on every Pokémon,
    so a record missing it has a wrong TYPE for every body in play; `fromClass` is
    an OPTIONAL key on a record that only EXISTS when a block was installed, so
    the old shape `{ turn, effects }` is still a valid inhabitant of the new type
    and reads back as "refuses every attacker" — which is precisely what it meant
    when it was written. There is no lie to retire. (It is doubly moot in fact: no
    deploy before this one had an op that could write a filter, so no persisted
    block could carry one — but the argument that matters is the TYPE one, since
    the value argument is the soft landing D124 refused.) Nothing else persisted
    moved — no `InPlayPokemon` key, no `GameState` field, no `EffectContext`
    field, and `preventDamage` still never parks, so no `EffectContinuation` can
    carry the new op field into `phase.cont` either. The RENDERED `SeatLogEntry[]`
    does gain a third `ATTACK_BLOCK_APPLIED` phrasing, which is text in NEW
    records only and is D141's already-settled case.

    ⚠️ BUMPED AT D147 (engine 0.96.0), 5 → 6, and it is the FOURTH time on the
    SAME trigger rather than a fourth distinct one — which is worth saying,
    because three of the last four slices did NOT bump and the reasons were all
    different. `InPlayPokemon.damageReduction: DamageReduction | null` is a
    REQUIRED key on `InPlayPokemon` (the printed "During your opponent's next
    turn, this Pokémon takes {N} less damage from attacks"), so a record written
    by the previous deploy has, for every body in play, a shape the new type does
    not describe. It would read back BENIGNLY — `undefined.turn` is never
    `state.turn`, and no deploy before this one had an op that could install one —
    and that soft landing is exactly what D124 refused when it set the rule.
    Contrast D146 one paragraph up, whose field went INSIDE `AttackBlock`: a
    record that only exists when the effect was installed can absorb an optional
    key; `InPlayPokemon` cannot absorb a required one. Nothing else persisted
    moved — no `GameState` field, no `EffectContext` field, and `reduceDamage`
    never parks (it is deterministic and asks nothing), so no `EffectContinuation`
    carries the new op into `phase.cont` either. The RENDERED `SeatLogEntry[]`
    gains one new row type (`DAMAGE_REDUCTION_APPLIED`), which is text in NEW
    records only and is D141's already-settled case.

    ⚠️ NO BUMP AT D148 (engine 0.97.0), STAYS AT 6 — and this is the first durated
    slice in four to add NO stamped field at all, which is the whole reason. The
    OPPONENT-side attack lock ("Discard an Energy from this Pokémon. During your
    opponent's next turn, the Defending Pokémon can't attack.", 3 printings; "If
    the Defending Pokémon is a Basic Pokémon, it can't attack during your
    opponent's next turn.", 1) REUSES `InPlayPokemon.attackLockedTurn` unchanged:
    "on which turn may this body not attack" is one question about one body, and
    WHOSE attack wrote the answer is a fact about the op rather than about the
    record. So there is no new required key, no changed key and nothing on
    `InPlayPokemon` for an old record to be missing.

    What DID move on a persisted shape is `preventAttack.target?: "defender"`, and
    the question is live rather than academic — sharper than D144's, in fact.
    `preventAttack` never parks, but on Eiscue ex's compound it sits BEHIND one:
    `discardEnergy` parks whenever two different Energy are attached, so the lock
    op rides `EffectContinuation.rest` into `phase.cont` and into a persisted
    record. It is nonetheless a WIDENING (D125's distinction, D144's worked case):
    the field is OPTIONAL and absent on every one of the 22 self-lock printings, so
    an old continuation's `{ op: "preventAttack" }` is still a valid inhabitant of
    the new type and reads back as the SELF arm — which is precisely what it meant
    when it was written, no deploy before this one having had a producer that could
    write "defender". The old record's TYPE is not a lie, so there is nothing to
    retire. `BoardCondition` likewise gained a union MEMBER
    (`opponentActiveIsBasic`), which is a widening in the same sense and in the
    same place: an old `conditionGate` carries a kind the new union still contains.
    Nothing else persisted moved — no `GameState` field, no `EffectContext` field,
    no new event type and NO log wording change at all (the one `ATTACK_LOCKED`
    phrasing renders honestly under either seat, see log.ts), so even D141's
    rendered-text case does not arise.

    ⚠️ BUMPED AT D149 (engine 0.98.0), 6 → 7, and it is the FIFTH time on D124's
    SAME trigger. `InPlayPokemon.attackDamageDebuff: AttackDamageDebuff | null` is
    a REQUIRED key on `InPlayPokemon` — the printed "During your opponent's next
    turn, the Defending Pokémon's attacks do {N} less damage (before applying
    Weakness and Resistance)" — so a record written by the previous deploy has, for
    every body in play, a shape the new type does not describe. It reads back
    BENIGNLY (`undefined.turn` is never `state.turn`, and no deploy before this one
    had an op that could install one), and that soft landing is exactly what D124
    refused when it set the rule. This is D147's paragraph two up with the body
    swapped from the attacker's to the defender's; the reason to bump is identical
    because the reason is about the RECORD, not about which seat writes it.

    Nothing else persisted moved. `weakenDefenderAttacks` is a NEW op member rather
    than a field on an old one (a widening for any old continuation, which cannot
    contain it), and it never parks — deterministic, consumes no rng, asks nothing
    — so no `EffectContinuation` carries it into `phase.cont`. No `GameState`
    field, no `EffectContext` field, no `BoardCondition` member. The RENDERED
    `SeatLogEntry[]` gains one new row type (`ATTACK_DEBUFF_APPLIED`) and one new
    breadcrumb on `DAMAGE_DEALT` ("· weakened −N"), both of which are text in NEW
    records only and are D141's already-settled case. */
export const MATCH_RECORD_VERSION = 7;

/** How a persisted match read back: absent, usable, or written by an
    incompatible deploy (`stale` — the caller decides whether to retire it). */
export type MatchLoad =
  | { kind: "none" }
  | { kind: "ok"; record: MatchRecord }
  | { kind: "stale" };

/** Read a raw storage value back as a `MatchRecord`, or `null` when this deploy
    cannot trust it. PURE — the retirement (deleting it, resetting the lobby,
    telling the players) is the DO's job, because only it can broadcast.

    The check is deliberately SHALLOW: the version gate is what actually decides
    compatibility, and the field checks past it exist so the DO's own reads
    (`record.log`, `record.names[seat]`, `record.startedAt`) cannot throw on a
    truncated or hand-edited blob. It does NOT re-validate the embedded
    `GameState` — that is the engine's invariant, and a same-version state is by
    definition one this build wrote. */
export function readMatchRecord(raw: unknown): MatchRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<MatchRecord>;
  if (record.version !== MATCH_RECORD_VERSION) return null;
  if (typeof record.seed !== "number" || typeof record.startedAt !== "number") return null;
  if (typeof record.state !== "object" || record.state === null) return null;
  if (!Array.isArray(record.log)) return null;
  const names = record.names;
  if (typeof names !== "object" || names === null) return null;
  if (typeof names.p1 !== "string" || typeof names.p2 !== "string") return null;
  return record as MatchRecord;
}

/** The engine action types the online client can DRIVE and RECOVER from: setup,
    the `moveToAction` turn drags (attach energy, bench a Basic, evolve, attach a
    Tool, play a Stadium), pass, the attack + KO loop (increment 2b-i — `attack`,
    then the KOing player's `takePrizes` and the KO'd player's `promote`),
    `retreat` (2b-ii), the effect:choose answer `resolveEffect` (2b-iii-c), and —
    from increment 3b — the activated Ability + non-Stadium Trainer plays
    (`useAbility` newly ON; `playTrainer` was already on but only the Stadium DRAG
    reached it, and now the OnlineHud turn panel sends it for Items/Supporters too),
    and — from 3b-ii — **`rareCandy`** (§7.1), the last deferred turn affordance:
    the Trainer that EVOLVES rather than running a program, so it takes its own
    action + a two-step Basic/Stage-2 dialog, now fed by the phase's `rareCandy`
    pairings (`redactedRareCandyOf`) behind the flagged wire trainer row. It is
    soft-lock-safe like the rest: `applyAction` re-validates every field (the target
    shape/index, both hand uids, the Basic + chain link) and its `turnGate` rejects
    it off a turn:action, so a crafted frame changes nothing; on accept it evolves
    through the SHARED placement (`placeEvolution`), whose only park is an on-evolve
    triggered Ability's effect:choose — dialoged since 2b-iii-c (below).
    **`concede`** (3c-ii) is on the set for two triggers at once: a player giving
    the game up, and the DO applying it FOR a player whose abandonment timer ran
    out (`forfeitAbandoned`). It is the safest entry here — legal in every phase
    but `gameOver`, taking no wire values at all beyond the seat the DO binds
    itself — and it is the one action that can always END a match, which is
    precisely why a griefer gains nothing from it: the only game they can throw
    away is their own.
    The DO rejects everything else — so a crafted frame can't push the match into a
    phase the online HUD renders no control for (a soft-lock; griefing-class).

    SEQUENCING (allowing `attack`/`useAbility`/`playTrainer`/`rareCandy` is only
    soft-lock-safe because an effect:choose park they reach must have an online
    dialog): each is
    accepted and let park wherever the engine takes it — with an EFFECT attack /
    ability / trainer that is effect:choose. The invariant is "`resolveEffect` on
    this set ⟺ EVERY effect prompt kind has an online dialog." 2b-iii dialoged all
    seven kinds (a/b/c), so `resolveEffect` is ON and a real-deck effect play that
    parks at effect:choose drives to completion — the precondition real deck
    selection (3a) relied on, now MET. (`retreat` never carried the caveat — it only
    discards energy + promotes a Bench Pokémon, never parking at a decision, so it
    is soft-lock-safe with ANY deck; `useAbility`/`playTrainer`/`rareCandy` DO park,
    which is exactly why they wait for the dialoged effect layer.) `resolveEffect` is
    soft-lock-safe on any deck: `applyAction` rejects it off an effect:choose park,
    and on one it validates the choice against the parked prompt (validateChoice)
    before applying — a crafted frame rejects, never crashes/soft-locks. */
export const SUPPORTED_MATCH_ACTIONS: ReadonlySet<string> = new Set([
  "chooseFirstPlayer",
  "setupDrawExtra",
  "setupPlaceActive",
  "setupPlaceBench",
  "setupReady",
  "attachEnergy",
  "playBasicToBench",
  "evolve",
  "attachTool",
  "playTrainer",
  "useAbility",
  "rareCandy",
  "concede",
  "attack",
  "takePrizes",
  "promote",
  "retreat",
  "resolveEffect",
  "endTurn",
]);

/** Apply a client action to a persisted match (P4 increment 2). The action is
    BOUND to the actor's own `seat` — never the client-claimed `action.seat` — so
    a client can never act for its opponent, gated to the 2a-SUPPORTED types
    (`SUPPORTED_MATCH_ACTIONS`), then run through the engine's TOTAL `applyAction`
    (never throws on a bogus type/field, D14). On accept returns the next record —
    the state advanced AND the accepted events formatted into the log (`now` is the
    DO's wall clock, stamped once per action; the pure reducer takes it as an arg,
    the local `useLocalGame` pattern) — carrying seed/startedAt/names over. On
    reject returns a `reason` (an unsupported/illegal action changes nothing — the
    client's optimistic gesture already sprang back) so the DO can surface the
    transient rejection pill (P4 2b-iii-d). Pure — no DO/storage. */
export type MatchActionOutcome =
  | { ok: true; record: MatchRecord }
  | { ok: false; reason: string };

export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
  now: number,
): MatchActionOutcome {
  // Off-allowlist types never reach the engine (the soft-lock gate) — a generic
  // reason, since there is no engine message to quote.
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) {
    return { ok: false, reason: "That move isn't available here." };
  }
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  // The engine's own rejection message is safe to surface: it describes the
  // ACTOR's own illegal move / wrong phase, never the opponent's hidden zones.
  if (!result.ok) return { ok: false, reason: result.error.message };
  // Format the accepted events into log rows (leak-safe: counts for hidden draws,
  // names off public state) and append. The log grows; seed/startedAt/names ride on.
  const entries = logFromEvents(result.events, {
    names: record.names,
    state: result.state,
    elapsed: formatElapsed(now - record.startedAt),
  });
  return {
    ok: true,
    record: { ...record, state: result.state, log: [...record.log, ...entries] },
  };
}
