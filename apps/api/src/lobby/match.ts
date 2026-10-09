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
    records only and are D141's already-settled case.

    ⚠️ NO BUMP AT D151 (engine 0.99.0), STAYS AT 7 — the always-on twin of D149's
    sentence (Entei sv03-030 "Pressure") put its flag on the CATALOG
    (`PassiveEffects`, a registry type), read through a pure cross-board scan. No
    key moved on `InPlayPokemon` at all, which is D148's no-bump reason a second
    time and the CONTROL that shows D124's trigger is literally "a required key
    appeared on `InPlayPokemon`" and not "a durated slice landed".

    ⚠️ BUMPED AT D152 (engine 0.100.0), 7 → 8, and it is the SIXTH time on D124's
    SAME trigger. `InPlayPokemon.installedRecoil: InstalledRecoil | null` is a
    REQUIRED key on `InPlayPokemon` — the printed "During your opponent's next
    turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put
    10 damage counters on the Attacking Pokémon." (Lycanroc ex sv02-117/-241
    "Scary Fangs") — so a record written by the previous deploy has, for every body
    in play, a shape the new type does not describe. It reads back BENIGNLY
    (`undefined.turn` is never `state.turn`, and no deploy before this one had an
    op that could arm one), and that soft landing is exactly what D124 refused when
    it set the rule. D147's paragraph with the field renamed: the reason is about
    the RECORD, not about what the number does once read.

    Nothing else persisted moved. `installRecoil` is a NEW op member rather than a
    field on an old one (a widening for any old continuation, which cannot contain
    it), and it never parks — deterministic, consumes no rng, asks nothing — so no
    `EffectContinuation` carries it into `phase.cont`. No `GameState` field, no
    `EffectContext` field, no `BoardCondition` member, no `COUNTERS_PLACED` member
    (the recoil it produces reuses D141's `"counterattack"`). The RENDERED
    `SeatLogEntry[]` gains one new row type (`RECOIL_ARMED`), which is text in NEW
    records only and is D141's already-settled case.

    ⚠️ BUMPED AT D154 (engine 0.102.0), 8 → 9, and it is the SEVENTH time on
    D124's SAME trigger. `InPlayPokemon.lockedAttack: LockedAttack | null` is a
    REQUIRED key on `InPlayPokemon` — the printed "During your next turn, this
    Pokémon can't use {AttackName}." (Munkidori ex sv06.5-037/-083/-091, Lucario
    sv01-114, Skarmory sv03-142, Greedent ex sv03-179) — so a record written by the
    previous deploy has, for every body in play, a shape the new type does not
    describe. It reads back BENIGNLY (`lockedAttackIndex` tests
    `locked === null || locked.turn !== state.turn`, and an absent field is
    `undefined`, so an old record throws rather than lying — which is worse than
    D142's silent `false` and is the one variant of this trigger where the soft
    landing is not even soft). The rule does not turn on that: the test is "can the
    PREVIOUS deploy's RECORD hold the new TYPE", and it cannot.

    ⚠️ AND THE OTHER TWO PERSISTED SHAPES THIS SLICE TOUCHES DO **NOT** BUMP IT,
    which is worth stating because both are new keys. `preventAttackUse` is a NEW
    op member rather than a field on an old one (a widening for any old
    continuation, which cannot contain it), and it never parks — deterministic,
    consumes no rng, asks nothing — so no `EffectContinuation` carries it into
    `phase.cont`. `ATTACK_LOCKED.attack?: string` is an OPTIONAL field on a
    `GameEvent`, and `GameEvent` is not PERSISTED at all — `MatchRecord` writes the
    RENDERED `SeatLogEntry[]`, which is the only thing this module ever stores from
    an event, and no other storage key holds one. (D203 narrowed this: D153's sweep
    was recorded here as "it appears in no file outside `packages/engine/src`",
    which is FALSE and was false when written — `src/features/game/useLocalGame.ts`
    holds a `GameEvent[]` in React state and `packages/schema/src/match/log.ts`
    names the type in prose. Neither is durable, so the CONCLUSION survives; the
    sweep that "supported" it did not, and an unfalsifiable claim propping up a
    true one is the shape this whole slice is about.) So the row wording changes
    for NEW rows only — D141's
    already-settled cosmetic seam. No `GameState` field, no `EffectContext` field,
    no `BoardCondition` member, no new error code (the §8 gate reuses
    `ATTACK_PREVENTED`).

    ⚠️ BUMPED AT D155 (engine 0.103.0), 9 → 10, and it is the EIGHTH time on
    D124's SAME trigger — two consecutive slices now, which is worth saying because
    the previous seven were spaced out by no-bump controls (D148, D151, D153).
    `InPlayPokemon.boostedAttack: BoostedAttack | null` is a REQUIRED key on
    `InPlayPokemon` — the printed "During your next turn, this Pokémon's
    {AttackName} attack does {N} more damage (before applying Weakness and
    Resistance)." (Seismitoad sv03-052 "Echoed Voice") — so a record written by the
    previous deploy has, for every body in play, a shape the new type does not
    describe. D154's paragraph with the field renamed, and the same reading of the
    soft landing: `boostedAttackDamage` tests `boost === null || …`, so an absent
    field throws rather than lying. The rule does not turn on that either way — the
    test is "can the PREVIOUS deploy's RECORD hold the new TYPE".

    ⚠️ AND THE OPTION TO DODGE IT WAS PRICED RATHER THAN ASSUMED. Two dodges exist:
    make the key OPTIONAL (D146's fourth reason), or hang the amount off D154's
    `lockedAttack` as `{ turn, attackIndex, amount? }`, which passes D131's
    widen-don't-add test on the SHAPE. Both were refused on grounds that are about
    the design and not about the bump: the six sibling durated fields are all
    required and read through a `=== null` reader (D124's no-defensive-`undefined`
    rule), and a shared record would hand `attack.ts`'s §8 gate the index of the
    attack the card just BOUGHT (types.ts `BoostedAttack`). A bump avoided by
    contorting either is a bump paid for twice.

    Nothing else persisted moved. `boostAttack` is a NEW op member rather than a
    field on an old one (a widening for any old continuation, which cannot contain
    it), and it never parks — deterministic, consumes no rng, asks nothing — so no
    `EffectContinuation` carries it into `phase.cont`. No `GameState` field, no
    `EffectContext` field (the read site takes the declared index from `attack.ts`'s
    own scope), no `BoardCondition` member, no `DAMAGE_DEALT` member (the bonus it
    pays is reported in the `bonus` field that has existed since Vitality Band). The
    RENDERED `SeatLogEntry[]` gains one new row type (`ATTACK_BOOSTED`), which is
    text in NEW records only and is D141's already-settled case.

    ⚠️ BUMPED AT D165 (engine 0.111.0), 10 → 11, and it is the NINTH time on
    D124's SAME trigger — but the FIRST that is a CHANGED type rather than a new
    key, which is the variant that makes the rule's own wording earn its keep.
    `InPlayPokemon.lockedAttack: LockedAttack | null` became
    `InPlayPokemon.lockedAttacks: LockedAttack[]` (a REVIEW FIX — the field has two
    writers, `preventAttackUse` at `state.turn + 2` and `lockDefenderAttack` at
    `state.turn + 1`, which collide from adjacent turns, and the single slot
    silently deleted a live bar). D124's test has never been "did a new key
    appear" but **"can the PREVIOUS deploy's RECORD hold the new TYPE"**, and it
    cannot: every body in a version-10 record carries `lockedAttack`, which the
    new type does not describe, and carries NO `lockedAttacks`, which it requires.
    The soft landing is not even soft — `lockedAttackIndexes` calls `.filter` on
    an absent field and THROWS — and the rule does not turn on that either way.
    TEN bumps, TEN reasons, one test. (D203 corrected this tally, which read
    "NINE bumps": NINE is how many fired on D124's `InPlayPokemon` trigger — this
    one included — but the count of BUMPS is ten, because D140's 2 → 3 was an
    `EffectOp` field and belongs in the total.)

    Nothing else persisted moved. No op was added or removed and neither writer
    parks (`preventChosenAttack`'s park predates this and its `chooseAttack`
    prompt/choice shapes are untouched), so no `EffectContinuation` and no
    `phase.cont` inhabitant changed. `ATTACK_LOCKED` is unchanged in shape AND in
    wording — two live bars are two rows installed on two different turns, each
    naming its own attack, so no row had to learn to say "and also". No
    `GameState` field, no `EffectContext` field, no `BoardCondition` member, no
    new error code (the §8 gate still reuses `ATTACK_PREVENTED`), and no
    `@luminous/schema` diff: `redactedAttacksOf` still folds the fact into the
    per-attack `playable` boolean the wire already carries, so the WIRE shape is
    byte-identical across this bump and only the DO's stored `GameState` moves.

    ⚠️ BUMPED AT D189 (engine 0.122.1 → 0.123.0), 11 → 12, AND IT IS THE SECOND OF
    THE ELEVEN THAT IS NOT AN `InPlayPokemon` FIELD. (D203 corrected this sentence,
    which claimed FIRST OF THE TWELVE and "eight of the nine bumps above": there
    are TEN bumps above, NINE of them on that trigger — a required key, or at D165
    a changed type, on `InPlayPokemon` — and the tenth, D140's 2 → 3, already landed
    on an `EffectOp`. Twelve is the VERSION, not the bump count; version 1 was never
    bumped INTO. The miscount is cosmetic and the rule below is not, which is
    exactly why it was worth fixing rather than leaving as a second confident
    number.) This one lands on `GameState.pending` — the STAGED TURN TAIL
    — and the rule that has governed all ten reads it identically without being
    stretched, which is the useful thing about it. `PendingStage`'s
    `attackEpilogue` member becomes `{ kind; seat; uid: string }`. `pending` is a
    `GameState` field, `GameState` is `MatchRecord.state`, so a version-11 record
    saved MID-ATTACK — the effect program parked on an `effect:choose`, which is
    precisely and only when this stage exists — carries `{ kind, seat }` and no
    `uid` at all. **Can the PREVIOUS deploy's RECORD hold the new TYPE?** No: the
    key is required and absent. Retire it.

    ⚠️ AND THE SOFT LANDING IS REFUSED FOR THE TENTH TIME, ON THE ONE SHAPE WHERE
    IT WOULD HAVE BEEN GENUINELY TEMPTING. An optional `uid?: string` reads back on
    an old record as "fall back to `players[seat].active`" — which is not merely
    plausible, it is CORRECT for every record version 11 could have written, since
    no deploy before this one had an attack that could move its own actor off the
    Active Spot. That is the strongest form of D124's temptation: the value would
    be right, the code would work, and the parked matches would survive. It is
    refused for D124's reason and for one more that is specific to this field —
    an optional `uid` leaves the DEFECT one absent key away FOREVER, because the
    fallback IS the bug. The type would then carry the wrong behaviour as a
    supported inhabitant rather than as history.

    WHY THE FIELD EXISTS AT ALL, in one line, because a reader here will not have
    the engine open: `finishAttack` places the §8.1 KO-conditioned recoil (Vengeful
    Punch sv03-197) on "the Attacking Pokémon", and D189 taught the deriver to read
    "Switch this Pokémon with 1 of your Benched Pokémon." off ATTACK text — so the
    attacker can be standing on its own Bench by the time the epilogue runs, and
    the spot holds a body that never attacked.

    WHAT ELSE MOVED WITH IT: NOTHING, and that was checked rather than assumed.
    `readMatchRecord` below needs no arm — the version gate IS the compatibility
    check and a mismatched record is `stale`, which is how all ten previous bumps
    were handled (this repo has no migration path, by design; D165's commit is the
    worked precedent — `match.ts`, `match.test.ts`, and the engine, nothing else).
    No `@luminous/schema` diff: `PendingStage` is not projected to the wire at all
    — `redactGame` derives what a client needs from `phase` — and the one web
    reader of `pending` (`koParkActiveSeat`) keys on `kind` + `seat` and never on
    the new field. No new `EffectOp` inhabitant (`switchActive` has existed since
    M4; what widened is which values are REACHABLE from the attack seam, which is
    D125's widening-not-a-missing-field distinction and would NOT have bumped on
    its own — D181 derived four such ops and stayed at 11). No `EffectPrompt` /
    `EffectChoice` / `EffectContinuation` change, no `InPlayPokemon` key, no event
    shape, no error code and no log wording. ELEVEN bumps, ELEVEN reasons, one
    test.

    ⚠️ NO BUMP AT D186, D202, D204 OR D205 — STAYS AT 12, and the four are
    recorded together because they are ONE reading of the rule, not four. D203
    audited them rather than assuming, since a block that stops narrating reads
    exactly like a block with nothing to narrate:
      · D186's `optional {note, then}` is a NEW `EffectOp` member and its
        `confirm` a NEW `EffectPrompt`/wire-prompt member. It PARKS — so it does
        reach `EffectContinuation` and `phase.cont` — but a version-12 record
        written before it simply cannot CONTAIN one, and every inhabitant it does
        contain is still in the widened union. D125's widening, D144's worked
        case.
      · D202 added two `deriveAttackEffect` anchors over D186's field: no new op,
        no new key, nothing persisted moved at all (D145's reason verbatim).
      · D204's `AttachTargetRiders.ownerPokemon` and D205's
        `attachEnergyFrom.count` / `moveCountersToDefender.ownerPokemon` are
        OPTIONAL riders on ops that DO park. An old continuation lacks the key,
        which reads back as the unfiltered / single-Energy behaviour — precisely
        what it meant when it was written, since no deploy before them had a
        producer that could set one. The old record's TYPE is not a lie, so there
        is nothing to retire.
      · D236's `attachEnergyFrom.healTarget` is the SAME reading a fifth time,
        and it is recorded because it is the first new op field in three slices
        and therefore the first that could have owed one. Optional rider, on the
        same parking op D205's `count` rides; an old continuation lacks the key,
        which reads back as "attach and heal nothing" — exactly what every
        program written before this deploy meant, because no producer could set
        it. The old record's TYPE is not a lie, so there is nothing to retire.
        ⚠️ The thing that WOULD have bumped is on the other side of the same
        slice and did not happen: had the heal been built as `recordGate` →
        `healChosen`, the program would have grown a SECOND park, and a
        version-12 record parked mid-attack would resume into a prompt that deploy
        never wrote. Refusing that design for FIDELITY reasons kept the record
        shape still as a side effect.
      · D248's `attachEnergyFrom.toEach` is the SIXTH reading and the FIRST that
        cannot reach a continuation AT ALL, which is a stronger argument than the
        five above rather than the same one again. Those are optional riders on a
        PARKING op, so the reasoning has to be about what an absent key reads back
        as; this field's whole meaning is that the op does NOT park, so no
        `EffectContinuation` this deploy or any earlier one can contain it. There
        is nothing to widen and nothing to retire. ⚠️ The thing that WOULD have
        bumped is again on the other side of the same slice: had the spread been
        built as N sequential parks (the `anyWay` reading, installed as the mutant
        `D248-spread-destination-becomes-a-distribution`), it would have grown a
        park where the print asks no question — and the FIDELITY argument that
        refused it kept the record shape still, exactly as D236's did.
    ⚠️ BUMPED AT D239 (engine 0.155.0), 12 → 13, AND IT IS THE EXACT MIRROR OF
    THE D146 NO-BUMP ARGUED FOUR PARAGRAPHS UP — same field, opposite verdict,
    which is why both stay on this page. D146 ADDED an optional key
    (`AttackBlock.fromClass?: "Basic"`), so `{ turn, effects }` remained a valid
    inhabitant of the new type and read back meaning what it always meant. D239
    RETYPES that key: `fromClass` goes from the string literal `"Basic"` to an
    `AttackerClass` RECORD (`{ stage: "basic"; excludingType?: PokemonType }`, the
    printed *"Basic non-{C} Pokémon"*), and a persisted `"Basic"` is not an
    inhabitant of the new type at all. It would not even read back benignly: the
    predicate now asks `cls.stage`, which is `undefined` on the old string, so an
    older block would silently stop matching any attacker and quietly protect
    NOTHING — the widening direction this family forbids. Retired, not softened
    (D124's rule).
    ⚠️ It is REACHABLE rather than theoretical, unlike D146's own moot half: three
    legal printings of the string-valued sentence have been derivable since
    0.95.0, so a live record CAN carry the old shape.
    ⚠️ The RENDERED `SeatLogEntry[]` also changes wording for those blocks
    ("Basic non-Colorless Pokémon's attacks"), which is text in NEW records only
    and D141's already-settled case. Nothing else persisted moved — no
    `InPlayPokemon` key, no `GameState` field, no `EffectContext` field, and
    `preventDamage` still never parks, so no `EffectContinuation` can carry the
    retyped op field into `phase.cont` either.

    ⚠️ NOT BUMPED AT D240 (engine 0.156.0), AND IT IS THE SAME FIELD FAMILY A
    THIRD TIME — `AttackBlock` gains `maxDamage?: number`, the printed damage CAP
    (*"…if that damage is 40 or less"*). A key ADDED, so this is D146's case and
    not D239's: every version-13 record is still an inhabitant of the new type
    with the key absent, and `attackBlockOf` reads an absent `maxDamage` as
    "no cap", which is precisely what those records already meant. The predicate
    guards on `!== undefined` before it compares, so an older block cannot be
    silently narrowed OR widened by the new field's arrival.
    ⚠️ The RENDERED `SeatLogEntry[]` gains a trailing clause for capped blocks
    only, so every previously-persisted row renders byte for byte as before —
    D141's case with nothing to argue.
    ⚠️ Nothing else persisted moved: no `InPlayPokemon` key, no `GameState` field,
    no `EffectContext` field, and `preventDamage` still never parks, so no
    `EffectContinuation` can carry the new op field into `phase.cont` either.
    ⚠️ THE PAIR IS NOW THE WORKED EXAMPLE THIS PAGE WANTED — one field,
    `AttackBlock`, producing a NO-BUMP (D146, add), a BUMP (D239, retype) and a
    NO-BUMP (D240, add) in three consecutive slices of one milestone.

    ⚠️ BUMPED AT D271 (engine 0.187.0), 13 → 14, AND IT IS THE FIRST NEW REQUIRED
    FIELD ON `GameState` ITSELF rather than on `InPlayPokemon` or on an `EffectOp`.
    `GameState.lastKoTurn: Record<Seat, number | null>` — the turn number during
    which each seat most recently had one of its own Pokémon Knocked Out, stamped
    by `knockOut` (flow.ts) and read by the new `BoardCondition` member
    `yourPokemonKoedOnOpponentsLastTurn` behind Unfair Stamp `sv06-165` and Hassel
    `sv06-151`/`-205` (*"You can use this card only if any of your Pokémon were
    Knocked Out during your opponent's last turn"*). Every version-13 record's
    embedded state lacks the key entirely, so it is D124's shape (`promotedTurn`),
    D142's (`attackBlock`) and D143's (`attackLockedTurn`) a fourth time — and the
    bump was DRIVEN rather than argued, in
    `packages/engine/src/lastTurnKo.test.ts`'s replay `it`, which rebuilds the
    version-13 shape by DELETING the key off a real post-Knock-Out state and
    replays the play through `applyAction`.

    ⚠️ AND IT IS THE FIRST OF THE FOUR THAT DOES **NOT** READ BACK BENIGNLY, which
    is a stronger argument than the three above rather than the same one again.
    Those each defaulted to a plausible answer (`undefined === turn` is false, i.e.
    "nothing happened here") and were refused anyway, because a silently defaulted
    rules-relevant field is the misreading this constant exists to catch. This one
    does not get that far: the reader INDEXES the record (`state.lastKoTurn[seat]`)
    before it compares, so a version-13 state resumed under this deploy THROWS the
    moment a player reaches for the card. A retired match is strictly better than a
    crashed Durable Object, and the version is what turns the second into the
    first.

    ⚠️ Nothing ELSE persisted moved, and each was asked rather than folded in. No
    `InPlayPokemon` key (the field is per-SEAT, not per-body — the Pokémon the
    sentence is about has left play, which is the whole reason it could not be an
    `InPlayPokemon` stamp). No `EffectOp` field and no new op, so no
    `EffectContinuation` in `phase.cont` serializes differently. No event shape
    changed — `KNOCKED_OUT` is byte-identical and the stamp emits nothing of its
    own, since both players watched the Knock Out and can count turns. The new
    `BoardCondition` member is a UNION WIDENING (D125), which on its own would not
    have bumped anything: no record can contain a member no deploy could author.

    The test never moved: **"can the PREVIOUS deploy's RECORD hold the new
    TYPE"** — not "did a type change", and not "did a durated/attach slice land".
    Thirteen bumps, six consecutive no-bumps, one test.

    🆕 ⚠️ **BUMPED AT D283 (engine 0.197.0), 14 → 15, AND IT IS THE SECOND NEW
    REQUIRED FIELD ON `GameState` ITSELF** — eleven consecutive no-bumps since
    D271, which is the longest run this constant has had.
    `GameState.handPlayLockedTurn: Record<Seat, Record<HandPlayClass, number |
    null>>` — the turn number during which each seat may not play Item /
    Supporter cards from hand, stamped by the new `EffectOp` `preventHandPlay`
    (interpreter.ts) and read by `handPlayBarred` (types.ts) at `playTrainer`'s
    gate plus both HUD mirrors, behind Scream Tail ex `sv06-094`/`-197`
    (*"Your opponent can't play any Supporter cards from their hand during their
    next turn."*), Galvantula ex `sv07-051`/`-159`/`-168`, Budew `sv08.5-004` and
    Frillish `sv10.5w-044`/`-126` (*"During your opponent's next turn, they can't
    play any Item cards from their hand."*).

    ⚠️ **AND IT IS THE SECOND OF THE FIVE THAT DOES NOT READ BACK BENIGNLY — THE
    SAME ARGUMENT D271 MADE, AND IT IS THE STRONGER ONE, SO IT IS RE-MADE RATHER
    THAN CITED.** D124/D142/D143 each defaulted to a plausible answer and were
    refused anyway. This one cannot: `handPlayBarred` INDEXES TWICE
    (`state.handPlayLockedTurn[seat][klass]`), so a version-14 state resumed under
    this deploy throws `TypeError: Cannot read properties of undefined` the moment
    ANY player tries to play ANY Item or Supporter — which on a real board is
    within the first two turns, not on the rare line D271's card needed. A retired
    match is strictly better than a crashed Durable Object, and the version is
    what turns the second into the first.
    ⚠️ **DRIVEN IN BOTH DIRECTIONS, NOT ARGUED** —
    `packages/engine/src/screamTail.test.ts` §6 replays a version-14 bag built by
    DELETING the key off a real post-attack state (it throws, by name), and pairs
    that with the literal key-list anchor D280/D281/D282 each installed — all
    three of which went RED on their own when the field landed, which is the
    guard those anchors exist for reporting for the first time.

    ⚠️ Nothing ELSE persisted moved, and each was asked rather than folded in. No
    `InPlayPokemon` key — the bar is per-SEAT and deliberately survives every §10
    clear that lifts `retreatBlocked` and `attackLockedTurn`, which is precisely
    why it could not be a body stamp. No `TurnAllowances` key: `freshAllowances()`
    wipes that bag at every `startTurn`, and crossing that boundary is this
    window's whole job. The new `EffectOp` member `preventHandPlay` is a UNION
    WIDENING (D125) which on its own would not bump anything — no version-14
    record can contain an op no version-14 deploy could author — but it DOES reach
    `EffectContinuation` in principle, and does not in fact: the op never parks.
    ONE new `GameEvent` (`HAND_PLAY_BLOCKED`) and ONE new `ErrorCode`
    (`HAND_PLAY_BLOCKED`), both of which appear in NEW records only — D141's
    already-settled case — so every previously-persisted log renders byte for byte
    as before.

    🆕 ⚠️ **BUMPED AT D285 (engine 0.199.0), 15 → 16, AND IT IS THE FIRST BUMP IN
    THIS RUN THAT IS A *KEY* ON AN EXISTING FIELD RATHER THAN A NEW FIELD.**
    `GameState.handPlayLockedTurn` is re-keyed from `StampedHandPlayClass` to
    `StampedPlayLockKey` and gains `"evolve"` — the turn during which a seat may
    not play a Pokémon from hand TO EVOLVE, stamped by the widened `EffectOp`
    `preventHandPlay` behind Bronzong `sv05-069` "Evolution Jammer" (*"During your
    opponent's next turn, they can't play any Pokémon from their hand to evolve
    their Pokémon."*, 1 legal printing) and read by `pokemonPlayBarred`
    (continuous.ts) at turn.ts's `evolve` gate.

    🛑 **AND THE DIAGNOSIS IS THE *WEAK* ONE, WHICH IS WHY IT IS RE-DERIVED RATHER
    THAN CITED FROM D283.** D283 added a whole FIELD, so its reader indexed twice
    and a version-14 bag THREW on the first Item either player reached for. This
    one adds a KEY to a field that already exists: `state.handPlayLockedTurn[seat]`
    still resolves and only the second index comes back `undefined`, so
    `undefined === state.turn` is FALSE and a version-15 record resumes with the
    bar SILENTLY GONE. **THAT IS D124/D142/D143's SHAPE — the plausible default —
    AND ALL THREE OF THOSE WERE BUMPED ANYWAY.** The test never moved: *can the
    PREVIOUS deploy's RECORD hold the new TYPE*, and a v15 record cannot, because
    it is missing a key the type requires. A silently defaulted rules-relevant
    field is precisely the misreading this constant exists to catch, and it is
    worse here than a crash would be — nobody would ever notice.
    ⚠️ **DRIVEN IN BOTH DIRECTIONS, NOT ARGUED** —
    `packages/engine/src/pokemonPlayLock.test.ts` §6 builds a v15 bag by DELETING
    the key off a real post-attack board and shows it does NOT throw and DOES lose
    the bar (through `applyAction`, not only through the reader), pairs that with
    the literal key-list anchor over four seeds (D279's half-guard rule), and adds
    a real JSON round trip showing the STAMPED source survives only because the
    number is written down while the CONTINUOUS one is recomputed.

    ⚠️ Nothing ELSE persisted moved, and each was asked rather than folded in. No
    `InPlayPokemon` key and no `TurnAllowances` key — the bar is per-SEAT and must
    cross the `freshAllowances()` boundary, which is the window's whole job. The
    new `PassiveEffects` field (`preventOpponentPokemonPlay`) and the new
    `CardFilter` member (`abilityPokemon`) are REGISTRY data and reach no record.
    ⚠️ **THE `EffectOp`/`GameEvent` FIELD RENAME (`cards` → `bars`) IS THE ONE
    THING THAT WOULD HAVE BUMPED THIS ON ITS OWN.** `preventHandPlay` never parks,
    so no `EffectContinuation` in `phase.cont` can carry it; but `HAND_PLAY_BLOCKED`
    IS a logged event, and a version-15 log holds rows spelled `cards`. Under this
    deploy `log.ts` would read `event.bars` as `undefined` and render "can't play
    undefined cards" — D141's already-settled case in reverse, and a second
    independent reason the version had to move.

    🆕 🛑 **BUMPED AT D299 (engine 0.210.0), 16 → 17, AND THE BUMP IS *D298's
    DEBT*, NOT THIS SLICE'S.** `GameState.oncePerGameSpent` — the per-GAME latch
    behind Legacy Energy `sv06-167` and Lillie's Pearl `sv09-151` — shipped at
    D298 (commit `794f7c5`) **and this constant did not move with it.** D298's own
    handoff records the bump as done (*"16 → 17, the first bump since D285 …
    driven; forward THROWS, backward round-trips"*) and `git log -S` finds no
    commit that ever wrote 17. **The DRIVE was real and the EDIT never landed** —
    which is the sharpest possible argument for this file's standing rule that a
    version question is settled by a REPLAY and not by a memory, since here the
    replay was run, passed, and then recorded against a tree it had not changed.

    🛑 **AND THE DIAGNOSIS IS THE *STRONG* ONE — D283's, not D285's.** `onKoPrize`
    (flow.ts) reads `next.oncePerGameSpent[ref.seat]` and INDEXES TWICE, on the
    line before the latch is even consulted, so a version-16 record resumed under
    the D298+ deploy throws `TypeError: Cannot read properties of undefined` on
    **the first Knock Out of the game with any prize-reducing rider in play** —
    and the read is unconditional on the rider, so it is every KO on which the
    loop reaches an entry at all. A retired match beats a crashed Durable Object;
    the version is what turns the second into the first.
    ⚠️ **DRIVEN IN BOTH DIRECTIONS, NOT ARGUED** —
    `packages/engine/src/returnBenched.test.ts` §5 replays a v16 bag built by
    DELETING the key off a real board (it throws, by name), pairs it with a
    LITERAL key-list anchor over the whole `GameState`, and shows the same board
    round-trips through JSON with the key present.

    ⚠️ **WHAT D299 ITSELF ADDED AND WHY NONE OF IT WOULD HAVE BUMPED ANYTHING.**
    ONE new `EffectOp` member (`returnBenched`) — a union widening (D125), and
    although this one DOES park (so it can sit in `phase.cont`'s
    `EffectContinuation`), no version-16 deploy could author it, which is D125's
    condition exactly. ONE new `GameEvent` (`POKEMON_RETURNED`), appearing in NEW
    records only — D141's already-settled case. NO `GameState` key, NO
    `InPlayPokemon` key, NO `PlayerSide` key: the op moves cards between zones
    that already exist and stamps nothing, which is why the forecast for this
    slice said "stays put" and would have been RIGHT about its own row.

    🆕 🛑 **D307 - STILL 17, AND THE SKIP IS D299's PARAGRAPH ABOVE REACHED A
    SECOND TIME.** The evolve-from-deck family ships ONE new `EffectOp`
    (`evolveFromDeck`) that PARKS - so it can sit in `phase.cont.pendingOp` - and
    ONE new `EffectPrompt` value (`chooseCards.dest: "evolve"`, the first member of
    that union that is not a zone). Both are things a stored phase can now hold and
    could not before, and **neither bumps this**, for D125's condition: this
    constant gates a record written by an OLDER deploy, and no version-17 deploy
    can author either value. Nothing else persisted moved - no `GameState` key
    (anchored literally in `evolveFromDeck.test.ts` §6), no `InPlayPokemon` key, no
    `PlayerSide` key, and no new `GameEvent`: the placement files the
    `POKEMON_EVOLVED` it has filed since M4 and deliberately files no
    `DECK_SEARCHED`, so no logged row gains a spelling `log.ts` cannot render.
    ⚠️ **THIS SLICE PREDICTED A BUMP TO 18 AND THE PREDICTION IS A LOSS**,
    recorded here rather than argued away - the replay is what settles a version
    question, and the replay says the old records are all still readable.

    🆕 🛑 **D308 - STILL 17, AND THE SKIP IS THE SAME PARAGRAPH REACHED A THIRD
    TIME, ON A SHAPE NEITHER OF THE OTHER TWO HAD.** The iterated evolve-from-deck
    sentence ships ONE new `EffectOp` (`evolveFromDeckEachBenched`, no fields) and
    ONE new OPTIONAL FIELD on an existing one (`evolveFromDeck.ontoBench`). ⚠️
    **THE NEW THING A STORED PHASE CAN HOLD IS NOT THE PENDING OP - IT IS
    `cont.rest`.** The scheduler resolves synchronously into D216's `schedule`, so
    a parked continuation now carries a QUEUE of further `evolveFromDeck` ops
    waiting their turn, and that queue is what a resumed record must replay. It
    **still does not bump this**, for D125's condition unchanged: this constant
    gates a record written by an OLDER deploy, and no version-17 deploy can author
    an `ontoBench` field, a scheduler op, or a `rest` holding either. Nothing else
    persisted moved - no `GameState` key (anchored literally in
    `evolveEachBenched.test.ts` §4), no `InPlayPokemon` key, no `PlayerSide` key,
    no new `GameEvent`, and no `packages/schema` diff at all. ✅ **AND THIS SLICE
    PREDICTED THE SKIP RATHER THAN A BUMP**, which is D307's loss paid back.

    🆕 🛑 **D309 - 17 → 18, AND IT IS THE FIRST BUMP THIS PAGE HAS OWED TO A
    RENAME RATHER THAN TO A NEW FIELD.** The body-choice evolve-from-deck sentence
    (Duosion `sv10.5b-038`/`-119`) can be answered with the **ACTIVE**, so D308's
    `evolveFromDeck.ontoBench?: number` - a bench INDEX - cannot hold the answer
    and became `onto?: PokemonTarget`. ⚠️ **THAT IS THE ONE SHAPE D125's
    distinction does NOT excuse.** Every skip above rests on *"no older deploy can
    author the new value"*, and it is true of a widening by construction. A rename
    inverts it: the OLD deploy authors the OLD spelling, and it is THIS deploy that
    cannot read it. **D308's engine is `0.214.0`, its own released minor**, and it
    writes `{ op: "evolveFromDeck", ontoBench: n }` into `phase.cont.pendingOp` and
    into the `cont.rest` QUEUE the paragraph above describes. Resumed under a D309
    deploy that key is dead: `onto` is `undefined`, `evolveFromDeckOffer` falls
    back to `sourceRef`, and the player is asked to evolve **the attacker instead
    of the benched body the record named** - a silent wrong-body resolution, not a
    throw, which is the worse of the two failures this constant prevents. 🛑 **A
    SILENT MISREAD IS THE CONDITION**; the D299 bump's throw was merely the loud
    version of it. Driven both directions in `evolveBodyChoice.test.ts` §5, which
    resumes a hand-built v17 bag and shows the wrong body being offered. ⚠️ **AND
    THE NEAR-MISS IS WORTH RECORDING**: the slice's own first draft argued a SKIP
    on the premise that both ops landed in one unreleased minor. `git log --
    packages/engine/package.json` says otherwise in one line, and a premise about
    releases is checkable in the repo rather than reasonable-sounding. */
/** 🆕 🛑 **D326 — 18 → 19, AND IT IS D271's CASE A SECOND TIME ON THE SAME
    FIELD'S NEIGHBOUR: A NEW *REQUIRED* KEY ON `GameState` ITSELF.**
    `lastKoMarks` is not optional and not defaulted, so every state a version-18
    deploy wrote lacks it outright. **DRIVEN BY A REPLAY AND NOT ARGUED**
    (`lastKoOwnerMark.test.ts` §8): a v18 board is rebuilt by DELETING the key
    off a real post-Knock-Out state and replayed through `applyAction`.

    ⚠️ **AND IT DOES NOT LAND SOFTLY, WHICH IS D271's FINDING REPEATED.**
    `koedMarksOnOpponentsLastTurn` INDEXES the record (`state.lastKoMarks[seat]`)
    before anything compares it, so a v18 record resumed under this deploy
    THROWS the moment a player reaches for Team Rocket's Archer or uses one of
    the six revenge attacks — a retired match beats a thrown one. Widening an
    enum is not a bump (D125); adding a required key always is.

    🆕🆕 **19 → 20 AT D335, AND IT IS THE RENAME CASE — THE ONE EXCEPTION D309
    NAMED AND THE FIRST SLICE SINCE TO SPEND IT.** D334 gave `lookAtTopN` a
    leftovers flag `discardRest?: true`; D335 widened that axis to three printed
    destinations and the key became `restTo`. **AN `EffectOp` IS PERSISTED** —
    `EffectContinuation.pendingOp` sits inside `GameState.phase` (types.ts), and
    this op PARKS — so a v19 record can hold `lookAtTopN{…, discardRest: true}`,
    which under this deploy reads as `restTo === undefined` and silently leaves on
    top of the deck the four cards Explorer's Guidance printed *"Discard the other
    cards"* about. That is not a widening: the old key is not merely unread, its
    ABSENCE now MEANS something different, so the record is refused rather than
    misread. ⚠️ **THE TEST IS "WOULD AN OLD RECORD MEAN SOMETHING ELSE", NOT "IS THE
    TYPE STILL ASSIGNABLE"** — D333 and D334 both measured NO bump for changes to
    this very op (a widened `max` union, an added optional `exact`), and both were
    right for exactly that reason: a v19 record missing `exact` resumes to the
    pre-D334 behaviour, which is what the old record MEANT.

    🆕🆕 **20 → 21 AT D352, AND IT IS THE RENAME CASE A SECOND TIME — THE SAME
    AXIS, ONE OP OVER.** D352 gave `attachFromTop` the leftovers DESTINATION its
    sibling `lookAtTopN` has carried since D335, and its `discardRest?: true`
    became `restTo?: "discard" | "shuffledBottom"`. `attachFromTop` PARKS (its
    answer is the `attachCards` MAP), so a v20 record can hold
    `attachFromTop{…, discardRest: true}` inside `EffectContinuation.pendingOp` —
    which under this deploy reads as `restTo === undefined` and silently leaves on
    TOP OF THE DECK the cards Hydreigon "Tri Howl" printed *"Discard the other
    cards"* about. The old key is not merely unread: its ABSENCE now MEANS
    something different, so the record is refused rather than misread.

    ⚠️ **AND THE PRE-PRICE THAT BOUGHT THE FIELD DID NOT NAME THIS CONSTANT.**
    `effects.ts` has said since D335 that widening this op *"costs the field and
    nothing else, because the apply below is shared in shape"* — true of the ENGINE
    diff, and it stayed true. What it missed is that the field is PERSISTED. **A
    PRICE THAT NAMES A FIELD HAS NOT THEREBY NAMED WHAT PERSISTS IT**, which is
    the D352 lesson and the reason this paragraph sits beside D335's rather than
    replacing it. Driven both directions in `metalMaker.test.ts` §7.

    🆕🆕 **21 → 22 AT D359, AND IT IS THE RENAME CASE A THIRD TIME — THIS TIME ON
    A PROMPT RATHER THAN AN OP.** D359 gave `choosePokemon` the printed QUANTITY
    the *"attach up to N"* sentences ask for, and D358's one-slice-old
    `declinable?: true` became `upTo?: number` — the same right at every width
    instead of at width one. This prompt rides the persisted `effect:choose`
    phase, so a v21 record can hold `{kind:"choosePokemon", declinable: true}`,
    which under this deploy reads as `upTo === undefined`, i.e. MANDATORY. A
    resumed match would refuse the decline the player was promised and force an
    Archaludon ex attach they had already been offered the right to refuse.

    🛑 **AND THE DISCRIMINATOR IS NOT "DID A FIELD CHANGE" BUT "DOES THE OLD BYTE
    STRING STILL MEAN WHAT IT MEANT".** D358 added `declinable` to this very
    prompt and correctly did NOT move this constant: a v20 record carried no key,
    and no key meant mandatory both before and after. One slice later the same
    field is renamed and the constant MUST move, because now the old key's
    ABSENCE-after-parsing means something the writer never said. A WIDENING is
    free and a RENAME is not, and the two are one edit apart on one field.

    🆕🆕 **22 → 23 AT D386, AND IT IS THE *FIRST* CASE AGAIN — A MISSING REQUIRED
    FIELD, WHICH IS THE ONE SHAPE THIS BLOCK HAS NOT SEEN SINCE D326.** D386 gave
    `InPlayPokemon` a second per-turn stamp, `healedTurn: number | null`, so the
    printed *"If this Pokémon was healed during this turn"* has somewhere to read.
    It is **REQUIRED**, not optional, for `promotedTurn`'s reason: a nullable-but-
    present field is a fact the model always knows, while an absent one is a fact
    it merely has not been told, and `conditionHolds` must never confuse the two.
    Every in-play Pokémon in a v22 record therefore lacks a key this deploy's type
    says is always there — the record is refused rather than resumed with
    `undefined === state.turn` quietly reading false on a board where the player
    had in fact healed. **D124's bump (1 → 2) was this exact case at this exact
    address**, which is why no argument is offered here beyond the precedent.

    ⚠️ **AND THE DISCRIMINATOR ABOVE IS WHY THE THREE SLICES BEFORE THIS ONE DID
    NOT MOVE IT.** D383 widened a persisted op field's union, D384 added a nullary
    `BoardCondition` member and D385 added another: a v22 byte string means exactly
    what it meant under all three. Adding a FIELD to a persisted structure is the
    case none of that covers.

    🆕🆕 **23 → 24 AT D393, AND IT IS D386's CASE AT D386's ADDRESS — A SECOND
    MISSING REQUIRED FIELD ON `InPlayPokemon`.** D393 gave the body a THIRD
    per-turn stamp, `evolvedTurn: number | null`, so the printed *"If this Pokémon
    evolved from Gimmighoul during this turn"* (Gholdengo `sv08-131`) and *"…from
    Misty's Staryu…"* (Misty's Starmie `sv10-047`) have somewhere to read. It is
    **REQUIRED** for `healedTurn`'s reason verbatim: a nullable-but-present field
    is a fact the model always knows, an absent one is a fact it has merely not
    been told, and `conditionHolds` must never confuse the two.

    🛑 **AND THIS ONE IS SHARPER THAN D386's, BECAUSE THE MISREAD IS NOT SYMMETRIC.**
    A resumed v23 record's in-play Pokémon carry no `evolvedTurn` at all, so
    `undefined === state.turn` reads FALSE — which silently withholds a +90 from a
    player who DID evolve into the attacker on the turn the match was interrupted,
    on the one turn the whole card is about. The record is refused rather than
    resumed into a board where the bonus has quietly stopped existing.

    ⚠️ **THE SIX SLICES BETWEEN D386 AND THIS ONE DID NOT MOVE IT, AND THE
    DISCRIMINATOR ABOVE IS WHY.** D387 through D390 and D392 each added a
    `BoardCondition` MEMBER (a v23 byte string still means what it meant — a new
    member cannot re-interpret a stored one) and D391 added an OPTIONAL field
    (absent still means unnarrowed). **A NEW REQUIRED FIELD ON A PERSISTED
    STRUCTURE IS THE ONE CASE NONE OF THAT COVERS**, and it is the second time in
    eight slices that the answer has been anything but "stays".

    🆕🆕 **24 → 25 AT D394, AND IT IS THE FIRST BUMP THIS RUN THAT CARRIES *TWO*
    MISSING REQUIRED FIELDS RATHER THAN ONE.** D394 gave the body a FOURTH per-turn
    stamp, `usedAttack: { name, turn } | null`, so the printed *"If this Pokémon
    used Form Ranks during your last turn"* (Falinks `sv07-088`) and *"…used
    Pervasive Gas…"* (Weezing `sv09-092`) have somewhere to read — REQUIRED for
    `evolvedTurn`'s reason verbatim. **And it gave `PendingStage`'s
    `attackEpilogue` a REQUIRED `attack: string`**, because that stage is the one
    of the five routes into `finishAttack` on which the declared attack's printed
    name is out of scope, and `finishAttack` is where the stamp is written.

    🛑 **THE SECOND FIELD IS WHY THIS ONE CANNOT BE ARGUED DOWN TO A WIDENING.** A
    v24 record's in-play Pokémon carry no `usedAttack` at all, so a resumed match
    reads the pair's bonus as FALSE forever — the D393 failure mode one field over.
    But a v24 record that was saved **PARKED MID-ATTACK** is worse than silent: its
    `attackEpilogue` stage has no `attack` key, so draining it would stamp the
    attacking body with `undefined` as a name and the record would go on looking
    healthy. **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT**, which is
    D124's refusal of the soft landing at a second address in one slice.

    🆕🆕 **25 → 26 AT D412, AND IT IS D386's CASE AT D386's ADDRESS FOR THE
    FOURTH TIME — A MISSING REQUIRED FIELD ON `InPlayPokemon`.** D412 gave the
    body `retreatLockedTurn: number | null`, the SELF-installed §11 retreat lock
    (*"During your next turn, this Pokémon can't retreat."* — 3 legal printings,
    all of them the tail of a `"Heal {N} damage from this Pokémon."` compound).
    It is a STAMP rather than a second boolean because the window is the
    installer's OWN next turn (`state.turn + 2`), which `retreatBlocked`'s
    paralysis clock cannot express. It is **REQUIRED** for `healedTurn`'s and
    `evolvedTurn`'s reason verbatim: a nullable-but-present field is a fact the
    model always knows, an absent one is a fact it has merely not been told, and
    the read sites must never confuse the two.

    🛑 **AND A v25 RECORD CANNOT BE READ BENIGNLY, WHICH IS THE RETIREMENT
    REASON EVERY REQUIRED ADDITION ABOVE GIVES.** Every in-play Pokémon in a v25
    record lacks a key this deploy's type says is always there, so
    `retreatLocked` (continuous.ts) reads `undefined === state.turn` as FALSE and
    a resumed board silently HANDS BACK a retreat the player had already paid a
    heal for — D393's failure mode one field over, and on the one turn the whole
    rider is about. The record is refused rather than resumed with the drawback
    quietly gone. **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT.**

    🆕🆕 **26 → 27 AT D432, AND IT IS D386's CASE AT D386's ADDRESS FOR THE
    FIFTH TIME — A MISSING REQUIRED FIELD ON `InPlayPokemon`.** D432 gave the body
    `noWeaknessTurn: number | null`, the attack-installed NO-WEAKNESS bar (*"During
    your opponent's next turn, this Pokémon has no Weakness."* — 1 sentence, 3
    legal printings). It is a BARE STAMP rather than a record because the printed
    sentence has no amount, no attacker filter and no type narrowing: it removes
    §8.5's Weakness STEP rather than moving a number, so the only fact to store is
    *when*.

    🛑 **THE REQUIRED-VS-OPTIONAL QUESTION WAS ASKED IN BOTH DIRECTIONS AND THE
    ANSWER IS DECIDED BY D421's OWN RULE FAILING TO APPLY.** An optional
    `noWeaknessTurn?: number` is a WIDENING and costs no bump — D146's case, and
    genuinely available here. D421 takes that road safely by *choosing the rest of
    the record so that LOSING the key is detectable*: its `LockedAttack.turn` is
    stamped with the INSTALL turn so a dropped rider produces a bar for a turn
    already spent, visible on the very next board. **That mitigation is unavailable
    to this field, because there is no rest of the record.** A dropped optional key
    here reproduces the pre-D432 engine exactly — the bar silently never bites,
    Weakness doubles the hit, and the board looks entirely normal. That is the
    benign soft landing D124 refused for `promotedTurn`, D142 for `attackBlock`,
    D143 for `attackLockedTurn`, D147 for `damageReduction` and D412 for
    `retreatLockedTurn`, arriving for the sixth time.

    🛑 **AND A v26 RECORD CANNOT BE READ BENIGNLY.** Every in-play Pokémon in a
    v26 record lacks a key this deploy's type says is always there, so
    `installedNoWeakness` (continuous.ts) reads `undefined === state.turn` as FALSE
    and a resumed board hands the OPPONENT back a doubled hit the installer had
    already paid an attack for — on the one turn the whole rider is about. The
    record is refused rather than resumed with the protection quietly gone.
    **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT.**

    ⚠️ Nothing else persisted moved — no `GameState` field, no `EffectContext`
    field, and `removeWeakness` never parks (it is deterministic and asks nothing),
    so no `EffectContinuation` carries the new op into `phase.cont` either. The
    RENDERED `SeatLogEntry[]` gains one new row type (`WEAKNESS_REMOVED`), which is
    text in NEW records only and is D141's already-settled case.

    🆕🆕 **27 → 28 AT D434, AND IT IS D386's CASE AT D386's ADDRESS FOR THE SIXTH
    TIME — A MISSING REQUIRED FIELD ON `InPlayPokemon`.** D434 gave the body
    `scheduledCounters: ScheduledCounters | null`, the attack-scheduled DELAYED
    counter placement (*"At the end of your opponent's next turn, put 9 damage
    counters on the Defending Pokémon."* — 1 sentence, 3 legal printings). It is a
    RECORD rather than a bare stamp, which is the one axis on which it differs from
    D432's bar directly above: the printed sentence carries an AMOUNT as well as a
    clock, and the amount is a `(\d+)` capture rather than a literal.

    🛑 **AND THE SECOND KEY DOES NOT BUY THE OPTIONAL ROAD, WHICH IS THIS SLICE'S
    FINDING AND SHARPENS D432's RULE RATHER THAN REPEATING IT.** D432 wrote that
    D421's mitigation — *choose the rest of the record so that losing the key is
    detectable* — is unavailable *"when the stored fact is a single number with
    nothing beside it"*. That is true and it is not the whole rule. **The "rest" D421
    means is the rest that ALREADY EXISTS in records a previous deploy wrote.** Both
    of this record's keys arrive in the SAME deploy, so neither can witness the
    other's loss: a v27 record does not hold a `scheduledCounters` missing one key,
    it holds no `scheduledCounters` at all. **A REST MUST BE OLD, NOT MERELY
    PLURAL** — and a slice reading D432's rule as "a record with two fields may go
    optional" would have shipped exactly the soft landing this constant exists to
    refuse. Asked in both directions and DRIVEN both ways in
    `delayedCounters.test.ts` §8.

🛑 **AND A v27 RECORD IS NOT MERELY UNSAFE HERE, IT IS UNREADABLE — WHICH IS A
    SHARPER RETIREMENT REASON THAN THE SIX ABOVE, AND WAS MEASURED RATHER THAN
    INHERITED.** The six preceding entries all name D124's BENIGN soft landing: a
    missing STAMP reads as `undefined === state.turn`, i.e. FALSE, and a rule quietly
    stops existing. A missing RECORD reads as `undefined !== null`, and
    `scheduledCountersDue`'s next comparison dereferences `.turn`. Every Checkup calls
    that reader on the ended seat's Active, so a v27 record resumed on this deploy
    **throws at the next turn boundary**. The reader carries no defensive
    `=== undefined` arm on purpose — `attackBlockOf` and `installedReductionOf`
    (continuous.ts) are the two shipped record-valued fields and both state in their
    own comments that the absent-key arm is THIS CONSTANT's job. **A KEY THE WRITER
    NEVER WROTE IS NOT A KEY WITH A DEFAULT**, and here it is not even a key with a
    wrong answer.

    ⚠️ THE BENIGN LANDING IS WHAT THE **OPTIONAL** ROAD WOULD HAVE BOUGHT, which is
    the other half of the argument and is driven rather than argued: an optional key
    forces the reader to admit `undefined`, at which point the loss is silent and the
    board looks entirely normal — D432's case exactly. Both roads are refused, and
    `delayedCounters.test.ts` §8 drives them side by side.

    🆕🆕 **28 → 29 AT D435, AND IT IS THE FIRST ENTRY IN THIS BLOCK WHERE D421's
    OPTIONAL ROAD IS GENUINELY AVAILABLE AND IS REFUSED ANYWAY.** D435 closed the
    delayed-effect family — *"At the end of your opponent's next turn, discard the
    Defending Pokémon and all attached cards."* (corpus row 53, 1 legal printing) and
    *"…the Defending Pokémon will be Knocked Out."* (corpus row 113, 2 printings) —
    which turns D434's `ScheduledCounters` record into a DISCRIMINATED UNION
    `ScheduledEffect`. **TWO INDEPENDENT REASONS POINT AT THE SAME BUMP AND NEITHER IS
    THE OTHER COUNTED TWICE:**

      · a new REQUIRED key (`kind`) on a persisted structure — D386's case at D386's
        address for the SEVENTH time; and
      · a RENAME — of the type, of the `InPlayPokemon` field (`scheduledCounters` →
        `scheduledEffect`) and of the reader (`scheduledCountersDue` →
        `scheduledEffectDue`) — which is **D359's** case, and the discriminator this
        block states outright: *"a WIDENING is free and a RENAME is not"*.

    🛑 **AND THE OPTIONAL ROAD WAS PRICED RATHER THAN DISMISSED, BECAUSE THE TWO
    REFUSALS THIS RUN ALREADY RECORDED DO NOT REACH IT.** D432's rule is *a record with
    no rest must be required*; this record HAS a rest. D434's sharpening is *a rest
    must be OLD, not merely PLURAL*; here it IS old — `{turn, amount}` were both
    written by the v28 deploy, so a v28 record genuinely is a `scheduledEffect` missing
    exactly one key, which is precisely the shape D421's mitigation was written for.
    **A `kind?: "counters"` defaulting to counters would have kept every v28 byte
    string meaning what it meant, and would have cost no bump at all.**

    🛑 **IT IS REFUSED ON D421's OWN CRITERION, APPLIED RATHER THAN COPIED (D425's
    rule).** The criterion is *choose the rest of the record so that LOSING the key is
    DETECTABLE*, so the question is what the loss actually degrades into — and it was
    MEASURED. A v29-authored `{turn, kind: "discard"}` that drops its `kind` reads as
    the counters member with `amount === undefined`; the Checkup computes
    `damage + undefined` → **`NaN`**; and `isLethallyDamaged` answers `NaN >= hp` →
    **false**. The body is not discarded, is not Knocked Out, can never be Knocked Out
    again, and the board looks entirely normal. **That is neither D124's benign soft
    landing nor a loud failure — it is silent CORRUPTION**, which is strictly worse
    than the six entries above, and it is driven in `delayedCounters.test.ts` §8
    rather than argued.

    So the sequence now has three entries with three DIFFERENT reasons: D432 *no
    rest*, D434 *rest not old*, D435 *rest old, optional available, and the
    degradation is `NaN` rather than a soft landing*.

    🛑 **AND A v28 RECORD IS UNREADABLE FOR D434's REASON VERBATIM, WHICH IS WHY THE
    RENAME'S DIRECTION DOES NOT SOFTEN IT.** A v28 body carries `scheduledCounters` and
    no `scheduledEffect`, so `scheduledEffectDue` reads `undefined !== null` and
    dereferences `.turn` on the very next line. Every Checkup calls that reader on the
    ended seat's Active, so a v28 record resumed on this deploy **throws at the next
    turn boundary** — the leftover `scheduledCounters` key is not read by anything and
    does not rescue it. **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT**,
    and a key under a different name is not that key.

    ⚠️ Nothing else persisted moved. TWO new `EffectOp` members (`scheduleDiscard`,
    `scheduleKnockOut`) are a WIDENING (D383–D385: a v28 byte string still means what
    it meant, and no older deploy can author the new members), neither op parks, and
    no `PendingStage` inhabitant is added — the delayed discard reuses the shipped
    `promote` stage and the delayed Knock Out reuses §8.1's own `takePrizes`. The
    RENDERED `SeatLogEntry[]` gains two new rows and one renamed one
    (`COUNTERS_SCHEDULED` → `EFFECT_SCHEDULED`), which is text in NEW records only and
    is D141's already-settled case.

    ⚠️ Nothing else persisted moved — no `GameState` field, and `scheduleCounters`
    never parks (it is deterministic and asks nothing), so no `EffectContinuation`
    carries the new op into `phase.cont` either. The `COUNTERS_PLACED.source` enum
    gains `"delayed"`, which is a WIDENING and not a shape change (the enum's own
    note above says so), and the RENDERED `SeatLogEntry[]` gains one new row type
    (`COUNTERS_SCHEDULED`) plus one new rendering of an existing one — text in NEW
    records only, D141's already-settled case.

    🆕🆕 **STAYS 29 AT D446, AND THE QUESTION WAS ASKED AT THREE ADDRESSES BECAUSE
    THE SLICE HAS THREE SHAPE CHANGES (D443).** The FILTERED IN-PLAY BODY COUNT on
    both seats — 5 sentences / 9 legal printings — moves:

      · **`CardFilter` gains two members** (`attackNamePokemon`, `suffixPokemon`).
        ⚠️ **THIS IS THE ONE AT A PERSISTED ADDRESS AND IT IS NOT THE ONE THAT
        LOOKS LIKE IT.** Nine `EffectOp` fields carry a `CardFilter`, and an op
        rides `state.phase.cont.pendingOp` — so this union really is inside
        `MatchRecord.state`, where D285's `abilityPokemon` note above is careless
        in saying a `CardFilter` member *"reaches no record"* (true of THAT member,
        which is registry-only; not true of the union). **It costs nothing anyway,
        and the reason is D333's, quoted in this block already: a WIDENING is free.**
        No v29 byte string can hold either new member — nothing produces them into
        an op, only into a parse-time `DamageCountSource` — and every pre-existing
        inhabitant reads identically, because the two arms are two new `case`s in
        two exhaustive switches and two new entries in one `Set`. **Driven over the
        bytes** in `bodiesInPlayScaling.test.ts` §6 DIRECTION 3, over a
        COMPILE-ENFORCED `Record<CardFilter["kind"], CardFilter>` — all 21 members
        written out, read back, and `matchesFilter` required to answer identically
        across a five-card cast.
      · **`DamageCountSource.yourPokemonInPlay` → `pokemonInPlay` with a required
        `seat`.** A RENAME plus a REQUIRED key is D359's + D386's case and would
        owe a bump AT A PERSISTED ADDRESS — this one is not at one. The type is
        PARSE-TIME: derived from card text and consumed in the same tick by
        `scaledAttackDamage`; no `EffectOp` carries one, no `GameState` field
        stores one, no `GameEvent` names one. Driven as a property of the
        SERIALIZED bytes (§6 DIRECTION 2 asserts BOTH spellings absent from the
        wire, the old one as well as the new — a rung naming only the current
        spelling stops discriminating the moment somebody reverts).
      · **`DiscardPileSeat` → `CountSeat`.** A TYPE ALIAS. There is no runtime
        value and no byte; the old name is kept as an alias so three shipped mutant
        rows keep their anchors.

    ⚠️ Nothing else moved: no `GameState` field, no `InPlayPokemon` key, no
    `EffectOp` inhabitant or field, no prompt kind, no `GameEvent`, no `route`
    value, no error code, no `SeatLogEntry` row and no `packages/schema` byte.

    🆕🆕 **STAYS 29 AT D456 — AND THIS IS THE FIRST SLICE IN FOUR WHERE THE REACHABILITY
    ARGUMENT DOES NOT APPLY AT ALL, SO IT IS NOT USED.** D453, D454 and D455 each held 29
    partly on *"an `EffectOp` reaches storage only through a continuation's `pendingOp`
    and its `rest`, written only on a park"*. D456 changes shape at **three** addresses
    and only one of them is an `EffectOp`:

      · **`InstalledRecoil` gains `ofDamageTaken?: true`** (types.ts) — the printed
        *"…put damage counters on the Attacking Pokémon equal to the damage done to this
        Pokémon."* (corpus line 180, 2 legal printings). 🛑 **THIS ONE IS AT A PERSISTED
        ADDRESS AND THERE IS NO PARK IN FRONT OF IT**: `InPlayPokemon.installedRecoil` is
        a `GameState` field and rides `MatchRecord.state` on every save. So the question
        is answered on THIS BLOCK'S OWN DISCRIMINATOR — *"does the OLD byte string still
        mean what it meant"* — and it does: a v29 record's `{turn, amount}` carries no
        rider, absence reads as the flat family, and the flat family is exactly what a
        v29 writer meant by those bytes. **A WIDENING IS FREE AND A RENAME IS NOT**, and
        this is a widening at the one address where that had to be argued rather than
        inherited.
        ⚠️ **AND THE OPTIONAL-VS-REQUIRED QUESTION WAS ASKED WITH D421's CRITERION
        APPLIED RATHER THAN COPIED (D425).** The criterion is *choose the REST of the
        record so that LOSING the key is DETECTABLE*. D432/D142/D143/D147/D412 all made
        their key REQUIRED because there WAS no rest — a one-key record whose loss is a
        benign soft landing. D435 had a rest and still refused, because the loss produced
        `NaN` and a body that could never be Knocked Out again. **This one has an OLD rest
        (`turn` and `amount` were both written by the v29 deploy) and its loss is neither
        of those**: the residue is `{turn, amount: 0}`, the trap is inert, and that byte
        string is UNAUTHORABLE by the surviving path — the deriver's `counters >= 1` guard
        is the only producer of a flat `installRecoil` in the engine, measured over the
        whole corpus and the whole registry rather than asserted. Detectable in the bytes,
        inert on the board. Driven in `installedRecoil.test.ts` §5, three directions.
      · **`EffectOp.installRecoil.amount` becomes `number | "damageTaken"`** — a new
        UNION INHABITANT on an existing field, which is D125's WIDENING and `heal.amount`'s
        D427 case verbatim; the op never parks, so it never reaches `phase.cont` either.
      · **`GameEvent.RECOIL_ARMED` gains `ofDamageTaken?: true`** — a `GameEvent` is NOT
        persisted (`MatchRecord.log` holds the RENDERED `SeatLogEntry[]`), so this is new
        TEXT in NEW records only, D141's already-settled case. It exists because the row
        would otherwise render *"will counterattack for 0 damage"* at the instant a real
        trap is armed, which is a false claim rather than a wording preference (D421).

    ⚠️ Nothing else moved: no other `GameState` field, no other `InPlayPokemon` key, no
    prompt kind, no choice kind, no `route` value, no error code, no `CardFilter` member,
    no registry row, no `packages/schema` byte and no `redact.ts` byte.

    🆕🆕🆕 **STAYS 30 AT D544 — D456's ARGUMENT, RUN AGAIN AT A SECOND PERSISTED ADDRESS
    AND WRITTEN BESIDE IT FOR THAT REASON.** (It sits here rather than after D501's block
    below because it is D456's test applied, not D501's.)

    🛑 **THE ADDRESS, NAMED FIRST (D456's rule).** `BoostedAttack` gains `base?: number`
    (types.ts) — the printed *"During your next turn, this Pokémon's Hyper Fang attack's
    base damage is 240."* (`censusAttackCorpus.ts` file line 166, 2 legal printings). The
    record is `InPlayPokemon.boostedAttack`, inside `PlayerSide.{active, bench[]}`, inside
    `GameState.players`, inside `MatchRecord.state` — **PERSISTED ON EVERY SAVE with no
    park in front of it**, so the reachability and serialized-alphabet arguments are
    inapplicable and are not used. The only discriminator is this block's own: *does the
    OLD byte string still mean what it meant.*

      · **D441 — the ABSENT key still means what a v30 writer meant.** Every v30
        `boostedAttack` is ADDITIVE (`{turn, attackIndex, amount}`, D155's template —
        three legal sentences, Echoed Voice, Meteor Mash and Tornado Rush, measured by
        deriving `legalAttackCorpus()` — 🆕🆕🆕 D546: FIVE additive sentences now, the
        two ALL-ATTACKS ones (`:76`, `:148`) writing `attackIndex: null`, see the D546
        paragraph below; a v30 record still carries a NUMBER there), and absent `base` reads as "no override" — `boostedAttackBase` answers
        `null` and `attack.ts` falls back to the printed base. Exactly the v30 meaning.
      · **D434 — the rest is OLD.** `turn`, `attackIndex` and `amount` were all written
        by the v30 deploy; the new key sits beside three old ones.
      · **D456 — the LOSS is detectable in the bytes and inert on the board.** A base
        install writes `{turn, attackIndex, amount: 0, base}`; a build that drops `base`
        leaves `{turn, attackIndex, amount: 0}`, which pays `+0` on the printed base —
        INERT, not D435's `NaN`. And that residue is **UNAUTHORABLE by the surviving
        path**: arm 24b's `amount >= 1` guard (effects.ts, `SELF_ATTACK_BOOST`'s arm) is
        the sole producer of an ADDITIVE `boostAttack`, and `registry.ts` has none, so no
        additive install can write `amount: 0`. A reader who finds that byte string has
        found the dropped key. Driven over SERIALIZED BYTES in three directions, with
        every producer measured, in `attackBaseOverride.test.ts` §10.
      · 🛑 **THE ONE EXCEPTION, NAMED RATHER THAN HIDDEN**: the CONSTRUCTED mixed-mode
        composite `{amount > 0, base}` — a base and an additive install merged on one
        address — does NOT have that property: stripped, it leaves an ordinary-looking
        additive record and pays the printed base plus the bonus. It is unreachable off
        any printing — the ground is the turn structure, not a count of the ~~four~~ legal
        sentences that write this record (🆕🆕🆕 D546: SIX now, measured —
        `attackBaseOverride.test.ts` §1) (a declared attack ends the turn [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which opens the attack-again window instead (flow.ts `finishAttack`); the window keeps `state.turn`, so no turn-stamp argument here moves], and two
        installs merge only when they name the same index for the same stamped turn) —
        which is why it is priced here and pinned (§9 of the same suite)
        rather than designed around.

    ⚠️ **WHY D155's OWN REFUSAL (above, *"make the key OPTIONAL … or hang the amount off
    D154's `lockedAttack`"*) DOES NOT TRANSFER.** It refused making the WHOLE field
    optional — a sibling of six required durated fields read through `=== null` — and a
    record SHARED with `lockedAttack`, whose §8 gate REFUSES the index this one pays.
    Neither is what D544 does: `boostedAttack` stays REQUIRED and null-read (the null
    reader is untouched), the new key is optional INSIDE a present record, and ~~BOTH modes
    PAY the named attack~~ 🆕🆕🆕 (D546: all THREE modes PAY — the named additive, the
    named base-set, and the all-attacks buff, which names no attack and pays every one)
    — the §8 gate never reads this record at all. The refusal's
    grounds are about the field and the gate; this key touches neither.

    🛑 **WHAT WOULD REVERSE THIS (D422).** A second base-set producer with no
    `amount >= 1` guard on its additive side (so `{turn, attackIndex, amount: 0}` became
    authorable and the loss stopped being detectable), or a PRINTING that reaches the
    mixed-mode composite (so the exception above became a real board). Either one makes
    this a 30 → 31 bump.

    ⚠️ Nothing else persisted moved: `EffectOp.boostAttack` gains an optional
    `base?: true` (D125/D334's widening — the op never parks, so it never reaches
    `phase.cont`), and `GameEvent.ATTACK_BOOSTED` gains `base?: true` (a `GameEvent` is not
    persisted; D141). No schema, redact, projection or client byte.

    🆕🆕🆕 **STAYS 30 AT D546 — THE SAME ADDRESS AGAIN, AND THIS TIME AN OLD KEY'S VALUE
    WIDENS.** Written out in full rather than inherited from D544's block, because the
    sentence prints a DURATION ("During your next turn"), which is exactly the class
    `conventions.md` (*"does the sentence print a duration or a schedule?"*) says can force
    a bump — so the argument is owed, not assumed.

    🛑 **THE ADDRESS, NAMED FIRST (D456's rule).** `BoostedAttack.attackIndex: number` →
    `number | null` (types.ts) — the printed *"During your next turn, attacks used by this
    Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness
    and Resistance)."* (`censusAttackCorpus.ts` file line 148) and the same sentence behind
    *"Both Active Pokémon are now Asleep."* (file line 76), 2 sentences / 2 legal printings.
    `null` means EVERY attack index. The record is `InPlayPokemon.boostedAttack`, inside
    `PlayerSide.{active, bench[]}`, inside `GameState.players`, inside `MatchRecord.state` —
    PERSISTED ON EVERY SAVE with no park in front of it. The KEY stays REQUIRED; only its
    VALUE set widens.

      · **D441 — every v30 value keeps its meaning.** Every v30 `attackIndex` is a NUMBER
        (the v30 installer resolved a printed name or wrote nothing), and a number still
        means "that one attack" to every reader: `boostedAttackDamage` pays it on that
        index only, `boostedAttackBase` answers for that index only. Nothing a v30 deploy
        wrote reads differently here.
      · **D434 — the rest is OLD.** `turn` and `amount` are written exactly as before
        (`state.turn + 2`, the printed number); no key was added or renamed.
      · **D456 — the NEW value is detectable in the bytes and inert under a rollback.**
        `"attackIndex":null` is written by NO v30 writer, so a record carrying it is
        identifiably this deploy's. A ROLLBACK deploy reading it computes
        `boost.attackIndex !== index` → `null !== index` → true and pays **0** on every
        index — the buff is lost, never mis-paid onto one attack — its installer
        overwrites the record on the holder's next install, and the turn stamp retires it
        after its one window anyway, so it is inert on the board.
        Its `boostedAttackBase` answers `null` for the same reason, and no all-attacks
        record carries `base` (this deploy's installer REFUSES `{attack: null, base:
        true}`). The FORWARD half is driven over SERIALIZED BYTES in
        `everyAttackBoost.test.ts` §9 (this deploy's null record round-trips and pays
        every index; a numbered v30 record still pays one). The ROLLBACK half is driven
        by the mutant `D546-reader-pays-null-nowhere`, whose replace is 8e2cdfe7's
        `boostedAttackDamage` line byte for byte: with the v30 expression inside the
        engine, the null record pays 0 on every index and the boards of §3 and §9 go
        red. §9's own rollback test re-computes that expression locally and is an
        ILLUSTRATION only — no engine change can turn it red.
      · **D544's D456 argument is UNMOVED**: arm 24b'' carries 24b's `amount >= 1` guard
        verbatim, so every additive producer — named or all-attacks — still writes
        `amount >= 1`, and `{turn, attackIndex, amount: 0}` stays unauthorable
        (`attackBaseOverride.test.ts` §10 now enumerates FIVE additive amounts, all >= 1).

    🛑 **WHAT WOULD REVERSE THIS (D422).** A reader that must distinguish "every attack"
    from a NAMED index at a GATE (§8 declaration or §11 refusal — a rollback deploy would
    then answer that gate wrongly rather than inertly), or ANY second meaning given to a
    `null` index (a v31 reader could not tell which a stored `null` meant). Either one
    makes this a 30 → 31 bump.

    ⚠️ Nothing else persisted moved: `EffectOp.boostAttack.attack` widens to `string |
    null` (the op never parks, so it never reaches `phase.cont`, D334), and
    `GameEvent.ATTACK_BOOSTED.attack` widens to `string | null` (a `GameEvent` is not
    persisted; D141). No schema, redact, projection or client byte.

    🆕🆕🆕 **THE FIFTH POSITION, WRITTEN AT D547 — A REST THAT IS OLD, AN OPTION THAT IS
    GENUINELY AVAILABLE, AND A LOSS THAT IS DETECTABLE IN THE BYTES BUT NOT INERT ON THE
    BOARD.** (It sits here, beside D456/D544/D546, because it is D456's test run and
    FAILED; the bump it forces is written at D547's own block below.) The sequence D501
    counted to four — D432 *no rest*, D434 *rest not old*, D435 *rest old and the
    degradation is `NaN`*, D501 *rest old, option available, rest cannot witness the loss* —
    gains a fifth at D547, and it is the one D456's test was written to answer.

    🛑 **THE ADDRESS, NAMED FIRST (D456's rule).** Two new facts on `InPlayPokemon` —
    `attackFlipLockTurn` (*"During your opponent's next turn, if the Defending Pokémon tries
    to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."*,
    `censusAttackCorpus.ts:176`) and `damageVulnerability` (*"During your next turn, the
    Defending Pokémon takes 50 more damage from attacks (after applying Weakness and
    Resistance)."*, `:150`) — inside `PlayerSide.{active, bench[]}`, inside
    `GameState.players`, inside `MatchRecord.state`: PERSISTED ON EVERY SAVE with no park in
    front of them.

    🛑 **THE OPTIONAL ROUTES, NAMED AND REFUSED.** Three spellings would have held 30:
      · **`attackFlipLockTurn?: number`** — an optional key beside the required stamps;
      · **`damageVulnerability?: DamageVulnerability`** — likewise, beside `damageReduction`;
      · **the paired `attackLockFlips?: true`** — a rider on the OLD `attackLockedTurn`
        stamp (the REST is then old: the stamp was written by the v30 deploy), which is the
        `preventAttack`-rider build `effects.ts` refuses on D131's test and the one route
        where D434's *rest must be OLD* is satisfied.
    Each passes D441 (an ABSENT key reads as "no lock / no vulnerability", which is what a
    v30 writer meant) and each is **DETECTABLE IN THE BYTES** (no v30 writer emits the key).
    Each is refused because D456's second clause — *"inert on the board"* — FAILS: a ROLLBACK
    deploy reading a v31 record SILENTLY DROPS a live gate and a live damage term. For
    `attackLockFlips?` it is worse than a drop: the v30 reader sees the old `attackLockedTurn`
    stamp WITHOUT the rider and REFUSES the declaration outright — a coin that would have been
    heads half the time becomes a certain lock. D456 held because its residue was
    `{turn, amount: 0}`, an inert trap; D544's because `{…, amount: 0}` pays +0. Here the
    residue is a PLAYED effect missing from the board (a rollback's Defending Pokémon attacks
    with no coin, or takes 50 less than the printed card promised) — **detectable in the
    bytes, NOT inert on the board**, so the D456 shape does not apply and the fields are
    REQUIRED (D432/D434's shape), which retires a v30 record rather than reading it.

    🛑 **WHAT WOULD REVERSE THIS (D422).** A rollback-safety rule that accepts a silently
    DROPPED effect as inert (i.e. D456's second clause re-worded to "never MIS-PAID" rather
    than "inert"), or a deploy pipeline that forbids rollback across a record-shape change.
    Either one would make the optional route available at the next address.

    🆕🆕🆕 **D548 — THE FIFTH POSITION, APPLIED A SECOND TIME, TO A `PlayerSide` FIELD.** The
    address: `PlayerSide.faceUpPrizes` (the prizes Crescent Purge turned face up,
    `censusAttackCorpus.ts:664`), inside `GameState.players`, inside `MatchRecord.state` —
    persisted on every save. The optional route is **`faceUpPrizes?: string[]`**: it passes
    D441 (an absent key reads as "nothing face up", which is exactly what a v31 writer
    meant) and it is DETECTABLE IN THE BYTES (no v31 writer emits the key). It is REFUSED on
    D456's second clause, the D547 test above: a ROLLBACK deploy reading a v32 record drops
    the key, so a card BOTH players have seen goes silently FACE DOWN again, and — worse than
    a dropped display fact — the rollback's cost gate (none: the v31 engine cannot read the
    sentence at all) and any future `yourFaceDownPrizeRemains` reader would re-count it as
    face down and RE-ARM the gate on it: a second Purge could turn the same card "up" again
    and pay +80 for a cost already paid. Detectable in the bytes, NOT inert on the board. So
    the field is REQUIRED. **Reversal (D422)**: the D547 reversal above verbatim (a
    rollback-safety rule that accepts a silently dropped effect as inert, or a deploy that
    forbids rollback across a record-shape change), OR a rules ruling that a face-up Prize
    may be turned face down again — then the loss would be a legal board, and inert.

    🆕🆕🆕 **29 → 30 AT D501 — AND IT IS THE FIRST FIELD EVER ADDED TO
    `SpecialConditions`, WHICH IS A NESTED STRUCTURE AT D386's ADDRESS RATHER THAN
    D386's ADDRESS ITSELF.** D501 gave `InPlayPokemon.conditions` a required
    `confusionDamage: number` — the raised §8 step-3 self-hit (*"Your opponent's
    Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that
    Pokémon for this Special Condition."*, `censusAttackCorpus.ts` FILE LINE 685,
    1 sentence / 1 legal printing).

    🛑 **THE ADDRESS, NAMED FIRST (D456's rule).** `SpecialConditions` sits inside
    `InPlayPokemon.conditions`, inside `PlayerState.{active, bench[]}` (🆕🆕🆕 D548: read
    `PlayerSide` — the lobby's `PlayerState` is a different type), inside
    `GameState.players`, inside `MatchRecord.state`. **PERSISTED ON EVERY SAVE**,
    with no park anywhere in front of it — so the REACHABILITY argument (D450/D461)
    and the SERIALIZED-ALPHABET argument (D462/D473) are both INAPPLICABLE here and
    neither is used. D498's *no carrier at all* is inapplicable for the same reason.
    ⚠️ **THE LAST FOUR SLICES ALL HELD 29 AND THREE OF THEM HELD IT ON EXACTLY
    THOSE ARGUMENTS**, every one of which assumes the byte does not reach a
    persisted required slot. The only discriminator available is this block's own:
    *does the OLD byte string still mean what it meant*.

    ⚠️ **AND THE SHIPPED SIBLING AT THIS EXACT ADDRESS IS NOT A PRECEDENT FOR THE
    VERSION — RE-DERIVED RATHER THAN ASSUMED.** `SpecialConditions.poisonDamage` is
    REQUIRED and is the same fact one status over, which reads like the strongest
    possible citation. It is not: `git log -S "poisonDamage" -- packages/engine/src/types.ts`
    bottoms out at **`04551439`, 2026-07-17 (P3-M3, D20/D21)**, and
    `apps/api/src/lobby/match.ts` did not exist until **`bc91ea14`, 2026-07-23**,
    with record versioning landing at `95ca679b` (D71–D74). **The sibling did not
    bump because there was nothing to bump.** It is a precedent for the SHAPE — an
    amount on the condition, counters→HP at the producer, an OPTIONAL op rider
    resolved against a rule constant — and silent on the constant.

    🛑 **REQUIRED RATHER THAN OPTIONAL, AND THE REASON IS A SHIPPED COMPILE-TIME
    GUARD RATHER THAN A PREFERENCE.** D441's discriminator — *does the ABSENT key
    still say what the old writer meant* — answers **YES** here, which is unusual
    and is why the optional road had to be refused on other grounds rather than
    dismissed: absent would read as `DEFAULT_CONFUSION_DAMAGE`, and every v29
    confusion self-hit genuinely WAS 30. D434's *a rest must be OLD* is likewise
    SATISFIED for only the second time on record (`rotation`, `poisonDamage` and
    `burned` were all written by the v29 deploy). What decides it:

      · **TWO SHIPPED `satisfies SpecialConditions` GUARDS EXIST SO THAT AN ADDED
        ENGINE FIELD IS A COMPILE ERROR RATHER THAN A SILENT DROP**, and both say so
        in their own doc blocks — `redact.ts`'s `copyConditions` (*"the `satisfies`
        makes an added engine field a compile error here rather than a silent
        drop"*) and `projection.ts`'s `battleStateOf` (*"the copy alone would NOT
        pin that restatement — a field added to SpecialConditions would just be
        dropped here and silently never render"*). **An OPTIONAL key satisfies both
        guards while reaching neither surface.** It would have disarmed, silently,
        the two instruments written to catch exactly this — D418's disarmed-tripwire
        shape arriving at a type assertion. Both guards fired on the real edit,
        which is the evidence rather than the claim.
      · **D421's mitigation is unavailable even though the rest is old.** The rest
        cannot witness the loss: `rotation: "confused"` is byte-identical on a body
        at 30 and a body at 80, so a dropped optional rider degrades into a
        plausible-looking wrong answer on the one board the printing is about. That
        is a FOURTH position in the sequence — D432 *no rest*, D434 *rest not old*,
        D435 *rest old and the degradation is `NaN`*, and now **D501 *rest old, the
        option genuinely available, and the rest cannot witness the loss***.
      · **D159/D421 — same fact, same spelling, every surface.** An optional twin
        beside a required `poisonDamage` at one address is a second answer to one
        question.

    🛑 **AND A v29 RECORD IS NOT MERELY UNSAFE, IT IS SILENTLY CORRUPTING — WHICH IS
    D435's OUTCOME AND THE SHARPEST RETIREMENT REASON IN THIS BLOCK.** Every in-play
    Pokémon in a v29 record lacks a key this deploy's type says is always there, so
    `attack.ts`'s §8 step-3 flip computes `active.damage + undefined` → **`NaN`**,
    `isLethallyDamaged` answers `NaN >= hp` → **false**, and the body is not Knocked
    Out, **can never be Knocked Out again**, and looks entirely normal on the board.
    The `COUNTERS_PLACED` row renders *"Confusion: X hit itself for undefined"*.
    This is NOT D124's benign soft landing: it is silent corruption, driven in
    `confusionDamage.test.ts` §7 over a reconstructed v29 body rather than argued.
    **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT.**

    ⚠️ Also moved, and neither is a second reason counted twice: **`EffectOp.applyStatus`
    gains an OPTIONAL `confusionDamage?: number`** — a new optional field on a
    persisted op, which is D334/D146's WIDENING (absent means the rule default,
    which is what every v29 program meant), free on its own; and
    **`redactedConditionsSchema` gains `confusionDamage: z.number()`** — the wire
    shape, which is NOT in a `MatchRecord` at all (`state` is a `GameState`;
    redaction is a per-request projection) and rides along because `GameHud.tsx`
    renders the number.

    ⚠️ Nothing else moved: no other `GameState` field, no other `InPlayPokemon` key,
    no new `EffectOp` member, no prompt kind, no choice kind, no `route` value, no
    error code, no `CardFilter` member, no `PendingStage` inhabitant and no registry
    row. `GameEvent.STATUS_APPLIED` gains an optional `confusionDamage?: number`,
    and a `GameEvent` is not persisted (`MatchRecord.log` holds the RENDERED
    `SeatLogEntry[]`), so that is new TEXT in NEW records only — D141's
    already-settled case.

    🆕🆕🆕 **30 → 31 AT D547 — TWO NEW REQUIRED FIELDS ON `InPlayPokemon`, AND THE REST IS
    NOT OLD (D432/D434).** `attackFlipLockTurn: number | null` (the FLIP-TO-ATTACK lock,
    `censusAttackCorpus.ts:176`, a bare stamp — D432's *no rest*) and `damageVulnerability:
    DamageVulnerability | null` (the NEXT-TURN VULNERABILITY, `:150`, `{turn, amount}` —
    D434's *both keys arrive together and cannot witness each other's loss*). The optional
    routes are refused on D456's test in THE FIFTH POSITION above.

    🛑 **AND A v30 RECORD IS NOT READ BENIGNLY — MEASURED, IN TWO DIFFERENT DEGRADATIONS.**
    Every in-play body in a v30 record lacks both keys:
      · `attackFlipLocked` computes `undefined === state.turn` → false, so a live lock's coin
        is SILENTLY never flipped — D124's soft landing, a plausible-looking wrong board
        (`attackFlipLock.test.ts` §12);
      · `installedVulnerabilityOf` asks `=== null` and then dereferences `.turn` of
        `undefined` → **`TypeError` on EVERY hit into ANY v30 body**, vulnerable or not —
        D326's throw on the first read of a missing required key
        (`damageVulnerability.test.ts` §11).
    Either alone owes the bump; the second makes a v30 match unplayable past its next attack.

    ⚠️ Also moved, and none is a second reason: two new `EffectOp` members
    (`flipLockAttack`, `exposeDefender { amount }` — new INHABITANTS, D333's widening; neither
    parks, so neither reaches `phase.cont`), and `GameEvent` gains `ATTACK_LOCKED.flip?`,
    `ATTACK_FLIP_LOCK_CHECK`, `ATTACK_FAILED.reason: "flipLock"`, `DAMAGE_VULNERABILITY_APPLIED`
    and `DAMAGE_DEALT.vulnerability?` (a `GameEvent` is not persisted, D141). No schema,
    redact, projection or client byte: the flip lock leaves the declaration LEGAL, so
    `redactedAttacksOf`'s `playable` and GameHud read `attackLocked` unchanged.

    🆕🆕🆕 **31 → 32 AT D548 — ONE NEW REQUIRED FIELD ON `PlayerSide`, `faceUpPrizes:
    string[]`** (Cresselia `sv06.5-021` "Crescent Purge", `censusAttackCorpus.ts:664`: *"You
    may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more
    damage. (That Prize card remains face up for the rest of the game.)"*). UIDS, a subset of
    `prizes`, ordered by when each was turned (types.ts). The optional route
    (`faceUpPrizes?`) is refused under THE FIFTH POSITION above, with its reversal condition.

    🛑 **THE REASON IS MEASURED, NOT ARGUED: A v31 RECORD THROWS.** A reconstructed v31
    `GameState` has no `faceUpPrizes` key on either side, and the field is read
    UNCONDITIONALLY on two paths every match walks: `redactedSideOf` (redact.ts) asks
    `side.faceUpPrizes.includes(uid)` for every prize on EVERY projection of EVERY viewer,
    and `resolveTakePrizes` (flow.ts) filters it on EVERY prize take. Both are
    `TypeError: undefined is not an object` — D326's class, the throw on the first read of a
    missing required key — so a v31 match could not even be BROADCAST once loaded
    (`crescentPurge.test.ts` §11 drives both throws on a v31-shaped state).

    ⚠️ Also moved, and none is a second reason: a new `EffectOp` member (`turnPrizeFaceUp`,
    field-free — 🆕🆕🆕 D567 (D539): no longer, it gained the optional `side` / `recordAs`, see the
    D567 block), a new `BoardCondition` member (`yourFaceDownPrizeRemains`, nullary), a new
    `EffectPrompt` kind (`choosePrize { indices }`) and a new `EffectChoice` member
    (`{kind: "prize", index}`) — all D333 widenings: the op PARKS, so the prompt and the op
    reach a persisted `phase.cont` (and the condition rides the program's `conditionGate`
    inside it), but a new INHABITANT of a persisted union is a widening a v31 writer never
    produced, which D333 settled. `GameEvent` gains `PRIZE_TURNED_FACE_UP` (not persisted,
    D141). The wire (`RedactedSide.faceUpPrizes`, the `choosePrize` prompt arm) is not a
    persisted shape at all.

    🆕🆕🆕 **32 → 33 AT D549 — THE SIXTH POSITION: THREE REQUIRED FIELDS AT TWO ADDRESSES, AND
    THE FIFTH POSITION'S ROLLBACK ARGUMENT APPLIED TO EACH.** The addresses, named first
    (D456's rule), all persisted on every save with no park in front of them:
      · `InPlayPokemon.costTaxTurn: number | null` — the COST TAX (*"During your opponent's
        next turn, attacks used by the Defending Pokémon cost {C} more, and its Retreat Cost
        is {C} more."*, `censusAttackCorpus.ts:171`), a BARE STAMP: D432's *no rest*;
      · `InPlayPokemon.koBounty: KoBounty | null` — the KNOCK OUT BOUNTY (*"During your next
        turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards."*, `:149`),
        `{turn, amount}`: D434's *both keys arrive together*;
      · `PlayerSide.sideAttackLock: SideAttackLock | null` — the SIDE-WIDE ATTACK LOCK
        (`:169`, *"During your next turn, your Pokémon can't attack. (This includes new
        Pokémon that come into play.)"*, and `:170`, the opponent's bodies with *"2 or less
        Energy attached"*), `{turn, maxEnergy}`: D434's case again, on a SIDE.

    🛑 **WHY NONE MAY BE OPTIONAL — THE FIFTH POSITION'S TEST, RUN THREE TIMES AND FAILED
    THREE TIMES.** Each optional spelling (`costTaxTurn?`, `koBounty?`, `sideAttackLock?`)
    passes D441 (an ABSENT key reads as "no tax / no bounty / no lock", which is what a v32
    writer meant) and is DETECTABLE IN THE BYTES (no v32 writer emits the key). Each fails
    D456's second clause, *"inert on the board"*: a ROLLBACK deploy reading a v33 record
    silently DROPS a live effect — the taxed Defending Pokémon attacks and retreats at its
    printed cost, the marked body pays its face value, and a locked side ATTACKS on the turn
    the printed card forbids it. A dropped lock is the worst of the three: it turns a
    forbidden action into a legal one. The residue is a PLAYED effect missing from the board,
    exactly the fifth position's finding, so the fields are REQUIRED and a v32 record is
    RETIRED rather than read. Reversal condition: the fifth position's (a rollback-safety rule
    that accepts a silently dropped effect as inert, or a pipeline that forbids rollback
    across a record-shape change).

    🛑 **AND A v32 RECORD IS NOT READ BENIGNLY — MEASURED: THREE ABSENT FIELDS, TWO CLASSES**
    **OF DEGRADATION** (two D326 `TypeError`s and one D124 silent soft landing).
      · `PlayerSide.sideAttackLock` absent: `attackLocked` asks `=== null` and dereferences
        `.turn` of `undefined` → **`TypeError` on EVERY attack declaration AND on the turn
        player's EVERY projection** (`redactedAttacksOf` asks `attackLocked` for the viewer's
        Active) — a v32 match could not even be broadcast once loaded
        (`sideAttackLock.test.ts` §12, `costTax.test.ts` §11);
      · `InPlayPokemon.koBounty` absent: `koPrizeBonus` dereferences `.turn` of `undefined`
        on the Knock Out of ANY Active outside a Checkup → `TypeError` (`koBounty.test.ts`
        §11) — D326's class;
      · `InPlayPokemon.costTaxTurn` absent: `undefined === state.turn` → the surcharge is 0,
        SILENTLY — D124's soft landing, a plausible wrong board (`costTax.test.ts` §11).
    Any one owes the bump; the first makes a v32 match unplayable.

    ⚠️ Also moved, and none is a second reason: three new `EffectOp` members (`taxDefender`,
    `bountyDefender { amount }`, `lockSideAttacks { whose, maxEnergy }` — D333 widenings;
    none parks, so none reaches `phase.cont`), and `GameEvent` gains `COST_TAX_APPLIED`,
    `KO_BOUNTY_APPLIED` and `SIDE_ATTACKS_LOCKED` (not persisted, D141). No schema, redact,
    projection or client byte: the side lock reaches every `playable` through
    `attackLocked`, and the tax reaches every cost through the two cost functions.

    🆕🆕🆕 **33 → 34 AT D552 — THE SEVENTH POSITION: A PARKED CONTINUATION WHOSE REST IS OLD
    AND WHOSE ROLLBACK DROPS A LIVE DAMAGE TERM, AND A REQUIRED FIELD THAT RIDES WITH IT.**
    The addresses, named first (D456's rule):
      · **`phase.cont.pendingOp` and `phase.cont.rest`** — `censusAttackCorpus.ts:569`
        (*"This attack does 30 damage for each {W} Energy attached to this Pokémon. Before
        doing damage, you may attach any number of Basic {W} Energy cards from your hand to
        this Pokémon."*) PARKS its attack program on `attachCards`, so a `MatchRecord`
        saved mid-attack persists `pendingOp: { op: "attachFromHand", filter, toSelf: true,
        recordAs: "moved" }` with `rest: [{ op: "damageDefender", base, per: 30, count:
        "moved" }]` behind it. Both keys on the op are OPTIONAL widenings of a shipped op
        (D333/D334), and the `damageDefender` in `rest` is a SHIPPED shape (D403's `base`
        rider). So this is the FIRST position whose REST IS OLD AT A PARK: every byte a v33
        reader meets is one it already knows how to read.
      · **`InPlayPokemon.weaknessRetype: WeaknessRetype | null`** — the rider,
        `censusAttackCorpus.ts:629` (*"Until the end of your next turn, the Defending
        Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)"*),
        `{turn, type}` on the opponent's Active, persisted on every save with no park in
        front of it (D434's case: both keys arrive together).

    🛑 **THE D456 TEST AT THE PARK, DRIVEN — AND IT FAILS.** D456 holds a version only
    when the old reader's residue is INERT on the board. A v33 (rollback) deploy resuming a
    v34 record parked here runs HEAD's `attachFromHand` apply arm,
    `attachFromZoneApply(state, choice.assignments, "hand", ctx, events).state`, which
    never files `recordAs`: the chosen Basic {W} Energy ARE attached, the `moved` slot is
    never written, and the `damageDefender` in `rest` counts an empty slot — it deals only
    the declaration-time head. On D503's own board (2 {W} on the attacker, 5 attached)
    that is **60 where the printed card deals 210**, with the five Energy on the body
    (`selfHandAttachBoost.test.ts` §5, driven through this engine by removing the one key
    the v33 arm ignores; the red-capable engine row is `D552-hand-apply-drops-the-record`).
    Detectable in the bytes (no v33 writer emits `recordAs` on this op), and **NOT inert
    on the board**: a live damage term silently dropped — THE FIFTH POSITION's finding, now
    at a park rather than at a field. So the version is owed.
    🛑 **AND THE RIDER'S FIELD FAILS THE SAME TEST ON ITS OWN.** An optional
    `weaknessRetype?` passes D441 and is detectable in the bytes, and a rollback reading a
    v34 record hits the retyped Defending Pokémon at its PRINTED Weakness type — the
    printed card's ×2 from a {C} attacker silently gone (`weaknessRetype.test.ts` §8). So
    the field is REQUIRED, and it rides this bump rather than owing its own (it had been
    carried as "the rider for the NEXT record bump" since D548).

    🛑 **AND A v33 RECORD IS NOT READ BENIGNLY — MEASURED.** Every in-play body in a v33
    record lacks `weaknessRetype`; `installedWeaknessRetypeOf` asks `=== null` and
    dereferences `.turn` of `undefined` → **`TypeError` on every main hit that reads target
    effects into ANY v33 body** (attack.ts reads it before the null paths,
    `weaknessRetype.test.ts` §8; a `suppressTargetEffects` hit — the *"isn't affected by any
    effects on your opponent's Active Pokémon"* family — skips the reader and does not
    throw) — D326's class. A v33 match is unplayable past its next such attack, so the
    record is RETIRED.

    🛑 **WHAT WOULD REVERSE THIS (D422).** The fifth position's reversal (a rollback-safety
    rule that accepts a silently dropped effect as inert, or a pipeline that forbids
    rollback across a record-shape change); OR, for the park half alone, a v33 apply arm
    that already filed `recordAs` (it did not — 9f4ec316).

    ⚠️ Also moved, and none is a second reason: a new `AttackDiscardScaledBoost` member
    (`selfHandAttach` — a reading, derived from text at the attack site and never
    persisted), a new `EffectOp` member (`retypeDefenderWeakness { type }` — a D333
    widening; it never parks), and `GameEvent.WEAKNESS_RETYPED` (not persisted, D141). No
    schema, redact, projection or client byte: the wire does not carry a body's Weakness,
    so the HUD does not show a retype (a carried display debt, decisions.md D552).

    🆕🆕🆕 **STAYS 35 AT D563 — ONE PERSISTED ADDRESS IS WRITTEN, AND IT IS D546's.** (Placed ABOVE the
    D556 block, out of date order, so the declaration's anchor lines stay byte-identical.)
    Feraligatr "Torrential Heart" (*"during this turn, attacks used by this Pokémon do 120
    more damage to your opponent's Active Pokémon …"*) writes `InPlayPokemon.boostedAttack`
    — persisted on every save — with the SAME three keys D546's all-attacks install writes,
    `{turn, attackIndex: null, amount}`; only the stamp's VALUE differs (`state.turn`, not
    `state.turn + 2`), and the holder may be a BENCHED body (the record already lived in
    `bench[]` bodies' shape). D441: no key added or renamed. D456: a v35 reader of this
    deploy's record — a ROLLBACK resuming a save taken mid-turn, after the use and before the
    attack — pays the +120 exactly as this deploy does, because `boostedAttackDamage` /
    `everyAttackBoostOf` compare `turn === state.turn` and are unedited; the turn stamp
    retires it at the next turn either way (`torrentialHeartD563.test.ts` §8, over serialized
    bytes). Nothing else persists: the two new op riders (`damageSelf.on`, `boostAttack.holder`
    / `.thisTurn`) never park, so no `phase.cont` carries them (D334); `attackCostClause`,
    `evolveAsNamed`, `intoPlayOnlyVia` and `BoardCondition.opponentDiscardHasNameContaining`
    are CATALOG data re-read on every call (a new `BoardCondition` member can ride a parked
    `rest` only inside a `conditionGate`, and no D563 row authors one); the `ATTACK_BOOSTED.
    thisTurn` widening and the new `EVOLVE_ONLY_VIA_ABILITY` code are not persisted (D141).

    🆕🆕🆕 **34 → 35 AT D556 — THE EIGHTH POSITION: A REQUIRED KEY ON THE ALLOWANCE BAG,
    AND A BAG THAT LIVES ONE TURN.** The address, named first (D456's rule):
      · **`GameState.allowances.sideAttackBonuses: SideAttackBonus[]`** — Black Belt's
        Training (*"During this turn, attacks used by your Pokémon do 40 more damage to
        your opponent's Active Pokémon ex (before applying Weakness and Resistance)."*,
        9 legal printings), `{amount, target}` entries appended by the new
        `boostSideAttacksThisTurn` op and summed at both pre-W/R sites. Persisted on
        every save with no park in front of it; it LIVES ONE TURN (`freshAllowances()`
        wipes it at every `startTurn`), which is the one thing no earlier position had.

    🛑 **THE FIFTH POSITION'S TEST, RUN ON A ONE-TURN BAG — AND IT FAILS (driven).** An
    optional `sideAttackBonuses?` passes D441 (an ABSENT key reads as "no bonus", which is
    what a v34 writer meant) and is detectable in the bytes. It fails D456's *"inert on
    the board"*: a v34 ROLLBACK deploy resuming a v35 record saved MID-TURN, after the
    Supporter was played and before the attack, ignores the key and hits the Active ex
    for 40 LESS than the printed card — the Supporter is spent and its effect is silently
    gone (`sideAttackBonusThisTurn.test.ts` §9, driven by clearing the one key a v34
    engine never reads). THE ONE-TURN LIFETIME SHRINKS THE WINDOW AND DOES NOT CLOSE IT:
    the residue is a PLAYED effect missing from the board for the rest of that turn, the
    fifth position's finding. So the key is REQUIRED and the version is owed.

    🛑 **AND A v34 RECORD IS NOT READ BENIGNLY — MEASURED.** A v34 bag has no
    `sideAttackBonuses` key. `sideAttackBonusThisTurn` passes its seat guard for the turn
    owner and iterates `undefined` → **`TypeError` on the turn owner's first DAMAGING
    attack** (main hit or `snipeActive`) and on any Black Belt's Training played (the
    installer spreads the absent array) — D326's class (§9 of the same suite). The next
    `startTurn` would write a fresh bag and heal the match, so the damage is ONE turn
    wide; it is retired anyway, by `readMatchRecord`'s version gate, on D124's rule (a key
    the writer never wrote is not a key with a default).

    🛑 **WHAT WOULD REVERSE THIS (D422).** The fifth position's reversal (a rollback-safety
    rule that accepts a silently dropped effect as inert, or a pipeline that forbids
    rollback across a record-shape change); OR a rule that saves are only taken between
    turns (the bag is empty at every `startTurn`, so such a record would carry `[]` and
    lose nothing) — neither holds today.

    ⚠️ Also moved, and none is a second reason: a new `EffectOp` member
    (`boostSideAttacksThisTurn { amount, target }` — a D333 widening; it never parks),
    three new `BoardCondition` members (`yourPokemonAllOwner`, `yourHandAtLeast`,
    `yourActiveHasType` — D333 widenings; a `conditionGate` holding one can ride a parked
    `rest` only as a new inhabitant a v34 writer never produced), and
    `GameEvent.SIDE_ATTACKS_BOOSTED` (not persisted, D141). No schema, redact, projection
    or client byte: the redacted view does not carry `allowances`, so the HUD does not
    show the side bonus (a carried display debt, decisions.md D556).

    🆕🆕🆕 **STAYS 36 AT D569 — THE PARADOX BANNER UNLOCK (SLICE 2 PART a) CHANGES NO GameState, Card,
    EVENT OR PROMPT SHAPE; EVERY PERSISTED CHANGE IS A D125 WIDENING, AND THE 0.452 ROLLBACK READINGS ARE
    NAMED, MEASURED FROM 0.452's SOURCE.** (Placed ABOVE the D568 block, out of date order, so the
    declaration's anchor lines stay byte-identical — D563's placement.) The addresses, named first (D456's
    rule): `MatchRecord.state.phase.cont.pendingOp` / `.rest` and `phase.prompt`. ⑴ `healChosen`'s NEW
    optional `filter` (Scream Tail "Supportive Singing") and `moveCountersToDefender`'s NEW optional `filter`
    (Flutter Mane "Perplexing Transfer") ride `pendingOp` when the pick PARKS (two or more Benched Ancient
    bodies) — on the EXISTING `choosePokemon` prompt. ⑵ `attachFromDiscard`'s NEW optional `targetBanner` /
    `each` (Reboot Pod) ride `pendingOp` when it parks — on the EXISTING `attachCards` prompt, whose shape is
    unchanged (no `min` was added: the mandatory half is an apply-time top-up). ⑶ `attachFromDeck.targetBanner`
    now carries "Future" (Miraidon "Peak Acceleration") at the same address D568 opened. ⑷ `drawCards.per`'s
    NEW `pokemonInPlay` member (Awakening Drum) is NEVER persisted: the Item's lone `drawCards` neither parks
    nor rides a `rest`. ⑸ The NEW `CardFilter` `bannerCard` reaches NO persisted address — it is read by a
    deriver row (`DISCARD_PILE_NOUNS`, a parse-time `DamageCountSource`) and inside `conditionHolds`' code,
    never written into an op. ⑹ The NEW `BoardCondition`s `opponentBannerPokemonInPlay` /
    `yourPlayedBannerSupporterThisTurn` are evaluated at step time and never written into a park: Iron
    Smasher's and Majestic Sword's are derived damage bonuses read at §8.5, and Land Collapse's
    `conditionGate` follows a `discardDeckTop` that cannot park, so the gate runs in the same action. No
    `GameState` key is added (the played Supporter is the EXISTING `allowances.supporterPlayedUid`), the
    86 Ancient/Future ids are CATALOG data (`banners.ts`), and no event gains a member. D441: nothing is
    renamed or removed, and a v36 record written by 0.452 cannot hold any of the new values — every older
    record means what it meant. THE 0.452 ROLLBACK READINGS (D456's test — does a reading GRANT an illegal
    action, or only whiff / narrow?), each read off 0.452's own bytes:
      • a parked Supportive Singing / Perplexing Transfer resumes AS BUILT — 0.452's `validateChoice`
        (`choosePokemon`) checks the answer against the PERSISTED prompt's candidates (the Ancient bodies
        the offer already chose) and `applyChoice` heals / moves the picked ref without re-reading the op;
        the D561 `healChosen` precedent's key was read at the APPLY, this one only at the OFFER, so nothing
        is ignored on the way out. ⚠️ The widening the pricing round predicted — 0.452 ignoring `filter`
        and offering every Benched body — needs 0.452 to STEP the op fresh, i.e. the op in `rest` behind an
        earlier park; NO D569 program puts a parking op before either rider (each is its attack's only
        op, and an attack's program starts in the declaring action), so that reading is unreachable from
        a v36 record, and is named here rather than assumed away;
      • a parked Reboot Pod resumes with the answer AS GIVEN and NO top-up — 0.452's `applyChoice` arm
        is `attachFromZoneApply` alone (it never reads `each`), so a short or empty answer stands: a
        NARROWING (fewer Energy attached, the Item spent), never an illegal attach — every uid and body is
        still checked against the persisted prompt, `maxPerTarget` 1 included;
      • a parked Peak Acceleration resumes AS BUILT (the targets are the prompt's; 0.452's apply re-reads
        no `targetBanner`);
      • off the park, "Ancient"/"Future" are ABSENT from 0.452's `BANNER_BY_ID`, so `bannerOf` answers
        `undefined` and every banner read narrows: Cobalt Command's `bannerPokemon Future` beneficiary
        matches nobody (no bonus — and 0.452 ignores `exceptName`, which could only have narrowed further);
        the unknown `BoardCondition` kinds and `bannerCard` fall out of 0.452's `conditionHolds` /
        `matchesFilter` switches with `undefined` (falsy — no bonus, no gate); the four reader rows and the
        seven registry rows are absent, so those sentences are skipped loudly and those cards are unbuilt.
    No reading grants an illegal action, so no printing was dropped and `MATCH_RECORD_VERSION` stays 36.
    No client byte moved (the prompt notes are strings the HUDs already render).

    🆕🆕🆕 **STAYS 36 AT D568 — THE TERA BANNER UNLOCK CHANGES NO GameState, Card, EVENT OR PROMPT
    SHAPE; EVERY PERSISTED CHANGE IS A D125 WIDENING, AND THE 0.451 ROLLBACK READINGS ARE NAMED,
    MEASURED FROM 0.451's SOURCE.** (Placed ABOVE the D567 block, out of date order, so the
    declaration's anchor lines stay byte-identical — D563's placement.) The addresses, named first
    (D456's rule): `MatchRecord.state.phase.cont.pendingOp` / `.rest` and `phase.prompt`. ⑴ The NEW
    `EffectOp` member `attachFromDiscard` (Glass Trumpet) can ride `pendingOp` — it PARKS on the
    existing `attachCards` prompt, whose shape is unchanged. ⑵ `attachFromDeck`'s NEW optional
    `targetBanner` / `distinctEnergyTypes` (Terapagos "Prism Charge") can ride `pendingOp`; the NEW
    `CardFilter` member `bannerPokemon` can ride `pendingOp.filter` (Tera Orb's `searchDeck`) and
    `rest` (Prism Charge's filter is `basicEnergy`; Jewel Seeker's search is `trainerCard`). ⑶ The NEW
    `BoardCondition` members are read at step time, never written into a park (Jewel Seeker's
    `conditionGate` is evaluated before its search parks; Glass Trumpet's and Briar's gates are
    `trainerPlayableIf`, catalog data). No `GameState` key is added: Briar reads the EXISTING
    `allowances.supporterPlayedUid`, the Tera table is CATALOG data (`banners.ts`), and no event gains
    a member (`PRIZE_BONUS` is reused). D441: nothing is renamed or removed, and a v36 record written
    by 0.451 cannot hold any of the new values — so every older record means what it meant. The 0.451
    ROLLBACK readings (D456), each read off 0.451's own bytes: a benched Tera ex takes attack damage
    again (0.451's `benchShieldScan` has no banner conjunct); a Briar bonus is not paid (0.451's
    `koPrizeBonus` has three sources); an attached Sparkling Crystal is INERT (0.451's
    `toolAttackCostDiscount` reads the term as a {C} discount, and its `holder` — `bannerPokemon`,
    unknown to 0.451's `matchesFilter`, which falls out of its `switch` with `undefined` — never
    matches, so nothing is taken off); Sparkling Scales protects nothing (the passive key is unknown);
    Ho-Oh and Regigigas lose their bonuses (the clause rows are absent; the sentence is skipped
    loudly). Of the parks: a parked TERA ORB resumes AS BUILT (the candidates are the prompt's, and
    0.451's `searchMove` re-reads no filter); a parked PRISM CHARGE resumes AS BUILT (the new keys are
    read only by the OFFER, which already ran; the `attachCards` answer applies through the unchanged
    `attachFromZoneApply`); a parked GLASS TRUMPET resumes as a SILENT WHIFF — 0.451's `applyChoice`
    has no `attachFromDiscard` arm and ends in `default: return state`, so a validated answer is
    dropped, nothing attaches, and the Item is spent (not a hard failure: no `stepOp` is reached, the
    op is the parked one and `rest` is empty). A parked Jewel Seeker search resumes as built. No
    client byte moved (the prompt notes are strings the HUDs already render).

    🆕🆕🆕 **STAYS 36 AT D567 — EVERY PERSISTED CHANGE IS A D125 WIDENING, AND THE 0.450 ROLLBACK
    READINGS ARE NAMED, MEASURED FROM 0.450's SOURCE.** (Placed ABOVE the D566 block, out of date
    order, so the declaration's anchor lines stay byte-identical — D563's placement.) The addresses,
    named first (D456's rule): `MatchRecord.state.phase.cont.pendingOp` / `.rest` / `.record` and
    `phase.prompt` (written on a PARK). ⑴ `lookAtTopN`'s NEW optional `whose` (Accompanying Flute)
    can ride `pendingOp`. ⑵ `turnPrizeFaceUp`'s NEW optional `side` and `recordAs` (Bother-Bot) can
    ride `pendingOp`; `randomFromOpponentHand`'s NEW `to` member `"reveal"` and optional `recordAs`
    and the NEW `EffectOp` member `swapTurnedPrizeWithRevealed` can ride `rest` (the latter inside
    an `optional.then`, which can itself be `pendingOp`); `EffectRecord` can carry the NEW
    `EffectSlot` keys `turnedPrize` / `revealed` in `cont.record`. ⑶ `evolveFromDeckChosen`'s NEW
    optional `bodyStage` / `evolveTimingGates` / `thenEvolveAgain` and `evolveFromDeck`'s NEW optional
    `thenEvolveAgain` (Grand Tree) can ride `pendingOp`. The `choosePrize` prompt's shape is
    unchanged (`{indices, note}`). D441: no key is renamed or removed, every added key is OPTIONAL or
    a new union member, and a v36 record written by 0.450 cannot hold any of them — so every older
    record means exactly what it meant (driven: `trainerBundleD567.test.ts` round-trips the Flute
    park, both Bother-Bot parks — the confirm WITH its `cont.record` — and the Grand Tree Stage 1
    park through JSON and resumes each). The 0.450 ROLLBACK readings (D456), named rather than
    implied, each read off 0.450's own bytes: a parked FLUTE resumes as a SILENT WHIFF — 0.450's
    `revealFromTop` filters the picks against the CONTROLLER's deck, so no opponent uid lands, the
    look row names nothing, and the program's `shuffleDeck { whose: "opponent" }` still runs (the Item
    is spent for nothing). A parked BOTHER-BOT `choosePrize` resumes MISDIRECTED, not as a whiff:
    0.450's `applyChoice` arm calls `turnPrizeFaceUpAt(state, index, ctx, …)` on the CONTROLLER's OWN
    row (the index was offered off the opponent's), then 0.450's `randomFromOpponentHand` treats every
    `to` that is not `"discard"` as the deck route — the revealed card is SHUFFLED INTO the opponent's
    deck — and, `recordAs` being unknown there, both `recordGate`s read empty slots and no switch is
    offered. A parked BOTHER-BOT CONFIRM answered YES is a HARD FAILURE: `continuationOps` splices
    `swapTurnedPrizeWithRevealed`, 0.450's `stepOp` switch has no arm and no `default`, so it returns
    `undefined` and `runProgram`'s `"park" in stepped` throws (a NO resumes cleanly — `otherwise` is
    absent, nothing runs). A parked GRAND TREE Stage 1 resumes as a PARTIAL WHIFF: 0.450 places the
    Stage 1 (`evolveFromDeck` ignores the unknown key) but its `continuationOps` has no
    `thenEvolveAgain` member, so the printed Stage 2 question is silently never asked, and the shuffle
    runs; a parked Grand Tree BODY question resumes the same way (0.450's `evolveBodyAnswered` drops
    the rider). Do not roll back over a record parked on a Bother-Bot confirm. Nothing else persists:
    the registry rows and `stadium.ability` are CATALOG data; `PRIZES_CYCLED`,
    `RANDOM_CARD_REVEALED`, `PRIZE_SWITCHED_WITH_HAND` and the `actor?` keys on
    `PRIZE_TURNED_FACE_UP` / `DECK_TOP_REVEALED` are events (D141); Redeemable Ticket never parks.
    No client byte moved (the prompt note is a string the HUDs already render).

    🆕🆕🆕 **STAYS 36 AT D566 — EVERY PERSISTED CHANGE IS A D125 WIDENING, AND THE 0.449 ROLLBACK
    READINGS ARE NAMED.** (Placed ABOVE the D565 block, out of date order, so the declaration's
    anchor lines stay byte-identical — D563's placement.) The addresses, named first (D456's rule):
    `MatchRecord.state.phase.cont.pendingOp` / `.rest` and `phase.prompt` (written on a PARK), and
    `MatchRecord.state.pending` (the stage queue). ⑴ `searchDeck`'s NEW optional `orElse` (Brock's
    Scouting) can ride `pendingOp`, and its park writes the chooseCards prompt's NEW optional
    `capsAnyOf`. ⑵ The NEW `EffectOp` member `switchWithDiscardNamed` (Ogre's Mask) can ride
    `pendingOp` with its optional engine-written `bodyUid`; its second park writes the prompt dest's
    NEW member `"swap"`; `CardFilter.pokemonNameContaining` gains an optional `suffix` inside it. ⑶
    The stage queue gains the optional `koTrigger.toolUid` (Amulet of Hope), the optional
    `endTurn.toolsDone` and the NEW member `endTurnToolTrigger { seat, toolUid }` (Powerglass). D441:
    no key is renamed or removed, every added key is OPTIONAL, and a v36 record written by 0.449
    cannot hold any of them — so every older record means exactly what it meant (driven: the D566
    suites round-trip each new park through JSON and resume it). The 0.449 ROLLBACK readings (D456),
    named rather than implied: a parked Brock's Scouting resumes under 0.449, whose `validateChoice`
    does not know `capsAnyOf` — a MIXED answer (1 Basic + 1 Evolution) would then be ACCEPTED (the
    flat `max` of 2 is the only check left), and 0.449's wire schema strips the key; a parked Ogre's
    Mask pick resumes as a WHIFF (0.449's `applyChoice` default and `continuationOps` buy nothing —
    the Item is spent for no effect), and 0.449's schema has no `"swap"` dest; a `koTrigger` carrying
    a `toolUid` runs 0.449's BODY lookup instead — a whiff on a body with no on-KO Ability, and a
    SECOND run of that Ability on one that has one; a live Powerglass park resumes under 0.449 as
    the OLD `attachEnergyFrom` op it is, and 0.449 reads the re-queued `endTurn`'s `toolsDone` as
    nothing and simply ends the turn (0.449 has no Powerglass row to seed from). An
    `endTurnToolTrigger` stage itself reaches a persisted queue only BEHIND a first Powerglass park —
    i.e. only on an Active carrying TWO live Powerglass, a Tool-cap-raising board — and there 0.449's
    `advance` switch does not know the kind: it falls out of the switch and returns no result, a hard
    failure on resume rather than a whiff (named, not hidden: do not roll back over such a record).
    Nothing else
    persists: the registry rows, the three `TriggerTiming` members, `StadiumEffects.disableAbilities`
    and the aura's `targetType` are CATALOG data; `POKEMON_SWAPPED_FROM_DISCARD` is an event (D141). A
    client byte moves (the chooseCards verb record gains `"swap"` in both HUDs; `GameHud`'s `cappedOut`
    reads `capsAnyOf`) and is not a reason: no persisted shape changes with it.

    🆕🆕🆕 **STAYS 36 AT D565 — EVERY PERSISTED CHANGE IS A D125 WIDENING, AND THE 0.448 ROLLBACK
    READINGS ARE NAMED.** (Placed ABOVE the D564 block, out of date order, so the declaration's
    anchor lines stay byte-identical — D563's placement, one block down.) The addresses, named
    first (D456's rule): `MatchRecord.state.phase.cont.pendingOp` / `.rest` and `phase.prompt`,
    written only on a PARK. Three NEW `EffectOp` inhabitants can reach them: Rocket Brain's
    `moveCounterOwnChosen` (with its engine-written `from` on the second park), Ruffian's
    `discardToolAndSpecialEnergyChosen`, and `searchDeck`'s new `dest: "attachToSelf"` VALUE
    (Impromptu Carrier), whose prompt carries the new chooseCards `dest: "attach"`; Ruffian's
    answer can also park a `discardEnergy { from: "opponentChosen", bodyUid }` — D561's optional
    key under an existing `from`. D441: no key is renamed or removed, every added key is
    OPTIONAL, and a v36 record written by 0.448 cannot hold any of them, so every older record
    means exactly what it meant — the union widening D557's `discardTools` rows and D561's
    `bodyUid` took without a bump (driven: both D565 suites round-trip a parked continuation
    through JSON and resume it). The 0.448 ROLLBACK readings (D456), named rather than implied:
    a parked Rocket Brain or Ruffian pick resumes as a WHIFF (0.448's `applyChoice` default and
    `continuationOps` buy nothing — the Ability use, or the played Supporter, is spent for no
    effect); a parked Impromptu Carrier search resumes through 0.448's `searchMove`, whose
    fall-through arm puts the picked Tool into the HAND rather than attaching it, and 0.448's
    wire schema has no `"attach"` member for the prompt dest; a parked body-narrowed Special Energy pick
    applies identically (the prompt already offered only that body's Energy). Nothing else
    persists: `discardDeckBottom`, `returnSelf`'s `"deckTop"` and `switchWithDeckNamed` never
    park and never ride a `rest`; `benchOnly`, `TriggeredAbility.oncePerTurn` and the registry
    rows are CATALOG data; the Zero to Hero lock is a `${uid}:${name}` string on the EXISTING
    `abilitiesUsed`; the three event changes (`DECK_BOTTOM_DISCARDED`, `POKEMON_SWAPPED_FROM_DECK`,
    `POKEMON_RETURNED.dest` `"deckTop"`) are not persisted (D141) and the `ABILITY_BENCH_ONLY` code
    is not either. A client byte moves (the chooseCards verb record gains `"attach"` in both HUDs;
    `GameHud` folds `benchOnly`) and is not a reason: no persisted shape changes with it.

    🆕🆕🆕 **35 → 36 AT D564 — THE NINTH POSITION: THREE REQUIRED KEYS, EACH A PLAYED EFFECT.**
    The addresses, named first (D456's rule):
      · **`GameState.allowances.supporterPlayedUid: string | null`** — the Supporter the turn's
        owner played from hand this turn, written by `playTrainer` alone beside
        `supporterPlayed: true`; read back BY NAME for Team Rocket's Factory `sv10-173` (*"if
        they played a Supporter card that has "Team Rocket" in its name …"*) and Crobat
        `sv06.5-029` "Shadowy Envoy" (*"if you played Janine's Secret Art …"*). One turn wide.
      · **`GameState.allowances.endOfTurnHandDiscard: number | null`** — Amarys
        `sv08.5-093`/`-132`/`-170`'s printed threshold (*"At the end of this turn, if you have 5
        or more cards in your hand, discard your hand."*), paid by flow.ts's `endTurn` stage.
        One turn wide.
      · **`PlayerSide.sideDamageReduction: { turn, amount } | null`** — Jasmine's Gaze
        `sv08-178`/`-233`/`-245` (*"During your opponent's next turn, all of your Pokémon take
        30 less damage …"*), stamped `state.turn + 1` and read by `seatDamageReduction`. It
        OUTLIVES the turn it is played on — the window is the opponent's next turn.

    🛑 **THE FIFTH POSITION'S TEST, RUN ON EACH KEY — AND EACH FAILS (driven).** Each optional
    spelling passes D441 (an absent key reads as "nothing pending", which is what a v35
    writer meant) and is detectable in the bytes; each fails D456's *"inert on the board"*,
    because a v35 ROLLBACK deploy resuming a v36 record ignores the key and silently drops a
    played Supporter's effect:
      · a save taken after Team Rocket's Ariana (or Janine's Secret Art) and before the
        Factory's (or Crobat's) use — the licence the Supporter bought is gone
        (`trainerBundleD564.test.ts` §9 (i));
      · a save taken after Amarys — the discard the player accepted when they drew 4 is gone,
        and the turn ends on a hand the card forbids (§9 (i));
      · a save taken in the opponent's turn after Jasmine's Gaze — every hit lands 30 harder
        than the printed card allows (`sideDamageNextTurnD564.test.ts` §9 (i)). This one is
        NOT a one-turn residue: the window IS the turn after the play, so a between-turns
        save carries it too.
    So all three keys are REQUIRED and the version is owed.

    🛑 **AND A v35 RECORD IS NOT READ BENIGNLY — MEASURED.** A v35 `PlayerSide` has no
    `sideDamageReduction` key: `seatDamageReduction` reads `.turn` of `undefined` on the
    FIRST damaging hit across the table → **`TypeError`** (D326's class,
    `sideDamageNextTurnD564.test.ts` §9 (ii)). The two allowance keys read benignly when absent
    (no discard, no licence — `trainerBundleD564.test.ts` §9 (ii)), and the next `startTurn`
    would write a fresh bag; the record is retired anyway, by `readMatchRecord`'s version gate,
    on D124's rule (a key the writer never wrote is not a key with a default).

    🛑 **WHAT WOULD REVERSE THIS (D422).** The fifth position's reversal (a rollback-safety
    rule that accepts a silently dropped effect as inert, or a pipeline that forbids rollback
    across a record-shape change) — neither holds today. The eighth position's second escape
    (saves only between turns) would cover the two ALLOWANCE keys and NOT the side record.

    ⚠️ Also moved, and none is a second reason: three new `EffectOp` members
    (`installSideDamageReductionNextTurn`, `scheduleEndOfTurnHandDiscard`,
    `shufflePlayedCardIntoDeck` — D333 widenings; none parks), two new `BoardCondition` members
    (`youPlayedSupporterNamedThisTurn`, `stadiumInPlayNamed` — a `conditionGate` holding one can
    ride a parked `rest` only as a new inhabitant a v35 writer never produced), the OPTIONAL
    `EffectContext.playedUid` (it rides EVERY parked Trainer continuation now — a widening, D125:
    a v35 continuation lacks it and reads as "no played card", which only
    `shufflePlayedCardIntoDeck` reads and no parking program authors), the catalog-only
    `StadiumAbility.playableIf`, and two events (`SIDE_DAMAGE_REDUCTION_INSTALLED`,
    `HAND_DISCARD_SCHEDULED` — not persisted, D141). One CLIENT byte does move, and it is not
    a reason either: GameHud.tsx's `stadiumAbilityOption` folds the catalog's
    `StadiumAbility.playableIf` into its disabled/reason (the third reader beside cardplay and
    redact). The three persisted keys themselves move no schema, redact-shape, projection or
    client byte: the redacted view carries neither the side reduction nor a pending Amarys
    discard, so the HUD shows neither (a carried display debt, `sideAttackLock`'s and
    `sideAttackBonuses`' precedent, decisions.md D564).

    🆕🆕🆕 **STAYS 37 AT D574 — THE COPY-FAMILY REMAINDER (HAUGHTY ORDER, SEEK INSPIRATION) + THE BUNDLE A
    RIDER (MALAMAR, SABLEYE, ALAKAZAM) ADDS TWO PARKING OPS UNDER NEW NAMES, BOTH WIDENINGS; BOTH 0.457 ROLLBACK
    READINGS ARE DRIVEN AND INERT.** (Placed ABOVE the D573 block, out of date order, so the declaration's
    anchor lines — and every `*-record-version-not-bumped` row's `find` and the D570 doc tail — stay
    byte-identical: D563's placement.) The addresses, named first (D456's rule): ⑴ the NEW `EffectOp`
    `useFoundAttackAs { from, index, candidates, accepted? }` is written into `phase.cont.pendingOp` by
    attack.ts's MID-ATTACK copy park (Haughty Order's confirm and flattened `chooseAttack`; Seek
    Inspiration's `chooseAttack`), with `resumeTail: true` on the phase and an `attackEpilogue` QUEUED in
    `pending` (attack.ts's in-attack park shape) — a new union member, D125's widening. 🛑 It is a NEW NAME
    and NOT a `useAttackAs` widening ON PURPOSE: 0.457 routes EVERY `useAttackAs` to `resolveCopiedAttack`,
    which re-derives the copier's text with 0.457's `deriveAttackCopy`, gets `null` for these two sentences
    and returns PHASE_DESYNC — a parked match no answer could leave (verified at attack.ts's re-validation).
    ⑵ the NEW `EffectOp` `moveCountersOpponentAnyWay { from, budget?, source?, take? }` (Sableye / Alakazam)
    PARKS each round (Q1 `choosePokemon` with `upTo` + `takeVerb "move"`, Q2 `choosePokemon`) — a new
    union member, D125's widening; the prompt kinds and keys are 0.457's own. ⑶ `ATTACK_COPY_RESOLVED` and
    `DECK_TOP_REVEALED.dest: "deck"` are EVENT shapes and `GameEvent` is not persisted (D141). ⑷ Malamar is
    a registry row over EXISTING ops (no vocabulary); `ResolvedAttackCopy` is a READER result, never stored.
    D441: nothing is renamed or removed. THE 0.457 ROLLBACK READINGS, DRIVEN rather than argued
    (`copyRemainderBundleD574.test.ts` §6, the D567 / D573 precedent): 0.457 has no route for either name in
    `resolveEffect`, so a parked answer goes `validateChoice` (0.457's own prompt kinds) → `resumeProgram` →
    `applyChoice`'s `default: return state` → `continuationOps` → `[]` → `runProgram([])` → `settleProgram`
    with `resumeTail` → `advance` drains the queued `attackEpilogue` → `finishAttack`. So the attack ENDS
    having copied / moved NOTHING — an INERT WHIFF: the first half's public facts (the declaration, the
    coins, Haughty Order's reveal and shuffle, Seek Inspiration's mill) stand as they were already applied
    and logged, no board byte is reinterpreted, no illegal action is granted, the `usedAttack` stamp is the
    copier's own name, and the turn passes. For Haughty Order the rolled-back board is BYTE-IDENTICAL to
    0.458's own DECLINE (driven). No printing is dropped and `MATCH_RECORD_VERSION` stays 37. (Had either
    whiff not been inert, the off-ramp was 37 → 38 at the eleventh position — not taken.) No client byte
    moved (the new prompts are the existing kinds; the log rows are engine-rendered).

    🆕🆕🆕 **STAYS 37 AT D573 — THE COPY-ATTACK SUBSTITUTION (NIGHT JOKER, FOUL PLAY, METRONOME, GEMSTONE
    MIMICRY, TRY TO IMITATE) ADDS ONE PARK-ONLY OP, A WIDENING; THE 0.456 ROLLBACK READING IS DRIVEN AND INERT.**
    (Placed ABOVE the D572 block, out of date order, so the declaration's anchor lines — and every
    `*-record-version-not-bumped` row's `find` and the D570 doc tail — stay byte-identical: D563's placement.)
    The addresses, named first (D456's rule): ⑴ the NEW `EffectOp` `useAttackAs { from, owner?, flip?, index,
    sourceRef? }` is written into `phase.cont.pendingOp` by attack.ts's DECLARATION-TIME park (two or more
    candidate attacks, or — Night Joker — two or more eligible Benched N's bodies), with `rest: []` and
    `ctx: { seat, sourceUid }` — a new union member, D125's widening: no v37 record written by 0.456 can hold
    it. The prompts it parks are the EXISTING `chooseAttack` and `choosePokemon` kinds, shapes unchanged. ⑵
    `ATTACK_DECLARED.as` is an EVENT key and `GameEvent` is not persisted (D141). ⑶ `deriveAttackCopy` is a
    READER over catalog text; nothing it returns is stored. D441: nothing is renamed or removed. THE 0.456
    ROLLBACK READING, DRIVEN rather than argued (`copyAttackD573.test.ts` §5, the D567 precedent): 0.456 has no
    `useAttackAs` route in `resolveEffect`, so a parked copy goes `validateChoice` (the prompt kinds are
    0.456's own) → `resumeProgram` → `applyChoice`'s `default: return state` → `continuationOps` → `[]` →
    `runProgram([])` → `settleProgram` → `turn:action` for the copier's seat. The park itself wrote NO board
    change, NO RNG step and no event but EFFECT_PENDING (it sits BEFORE ATTACK_DECLARED), so the rolled-back
    resolution is INERT: no ATTACK_DECLARED, no damage, no `usedAttack` stamp, the board and `rngState`
    byte-identical, and the player simply holds an undeclared turn (at 0.456 a re-declared copy is the old
    loud `ATTACK_EFFECT_SKIPPED`). No reading grants an illegal action or reinterprets a persisted byte, so no
    printing was dropped and `MATCH_RECORD_VERSION` stays 37. No client byte moved (the prompt notes are
    strings the HUDs already render; the log's "(as …)" suffix is engine-rendered).

    🆕🆕🆕 **STAYS 37 AT D572 — "CALM DIVERS" (ADRENA-BRAIN, MENTALLY CALM, DIVER'S CATCH, EMERGENCY ROTATION)
    ADDS ONE PARKING OP AND ONE OPTIONAL PROMPT KEY, BOTH WIDENINGS; THE 0.455 ROLLBACK READINGS ARE NAMED.**
    (Placed ABOVE the D571 block, out of date order, so the declaration's anchor lines — and every
    `*-record-version-not-bumped` row's `find` — stay byte-identical: D563's placement.) The addresses,
    named first (D456's rule): ⑴ the NEW `EffectOp` `moveCountersToOpponentChosen { upTo, from? }`
    (Munkidori "Adrena-Brain") PARKS twice, so it IS written into `phase.cont.pendingOp` — a new union
    member, D125's widening: no v37 record written by 0.455 can hold it. ⑵ The NEW optional
    `choosePokemon.takeVerb: "move"` rides the persisted `effect:choose` prompt — OPTIONAL with "attach" as
    its absent reading, which is what every older park meant (D441's test). ⑶ `KNOCKED_OUT.toHand` (Huntail
    "Diver's Catch") is an EVENT key and `GameEvent` is not persisted (D141). ⑷
    `PassiveEffects.opponentInPlayToHandBlocked` / `.koBasicEnergyToHand`, `CardProgram.benchFromHand` and the
    two new `BoardCondition` members (`opponentStage2PokemonInPlay` is catalog-only; `yourInPlayToHandAllowed`
    sits in Zarude's cost gate, evaluated before anything in that program parks) are CATALOG-only. ⑸ The
    Klinklang allowance is a plain `${uid}:Emergency Rotation` string in the existing
    `allowances.abilitiesUsed`. D441: nothing is renamed or removed. THE 0.455 ROLLBACK READINGS: a PARKED
    Adrena-Brain resumes as a WHIFF (0.455's `applyChoice` / `continuationOps` default arms move nothing for
    an op they do not know — the counters stay put, the use is spent); its prompt's `takeVerb` is stripped by
    0.455's zod schema and the quantity rows caption "attach" (display only — the answer's `take` is the same
    number); Huntail, Milotic and Klinklang are CATALOG-ONLY there (0.455 has no `DIVERS_CATCH`,
    `MENTALLY_CALM` or `EMERGENCY_ROTATION` row — the Energy is discarded, nothing is locked, a Klinklang in
    hand is NOT_A_BASIC_POKEMON). No reading reinterprets a persisted byte, so no printing was dropped and
    `MATCH_RECORD_VERSION` stays 37. Client bytes moved: the optional `takeVerb` caption only.

    🆕🆕🆕 **STAYS 37 AT D571 — PARADOX PART b (IRON THORNS) + THE IGNITION RIDER CHANGES NO GameState,
    PendingStage, Card, EVENT OR PROMPT SHAPE; NOTHING NEW PARKS, AND THE 0.454 ROLLBACK READINGS ARE NAMED.**
    (Placed ABOVE the D570 block, out of date order, so the declaration's anchor lines — and
    `D570-record-version-not-bumped`'s `find` — stay byte-identical: D563's placement.) The addresses,
    named first (D456's rule): none is persisted. ⑴ `disableAbilities.ruleBox` / `.exemptBanner` (Iron
    Thorns ex "Initialization") are CATALOG-only keys on `PassiveEffects`, read from the registry on every
    `disabledAbilityUids` call; the stratified lock pass (R-LK2) is computed, never stored. ⑵ The NEW
    `EffectOp` `revealTopDiscardMatching` (Iron Thorns "Destructo-Press") NEVER parks and no D571 program puts
    a parking op before it, so it is never written into `phase.cont.pendingOp` or `.rest`. ⑶
    `EnergyProgram.discardAtEndOfYourTurn` (Ignition Energy) is CATALOG-only, read by flow.ts's `endTurn`
    stage, which pays it in the same action (no new `PendingStage`). ⑷ No event gains a member or a field
    (the discards are the EXISTING `DECK_TOP_DISCARDED` / `ENERGY_DISCARDED` / `SHUFFLE`). D441: nothing is
    renamed or removed, and a v37 record written by 0.454 cannot hold any new value. THE 0.454 ROLLBACK
    READINGS, each the reading of a card 0.454 does not build (the D569 block's "those cards are unbuilt"),
    not of a record shape: Initialization reads as NO LOCK (0.454 has no `INITIALIZATION` row, and its
    `disabledAbilityUids` is the single ungated pass); Destructo-Press is an UNBUILT ATTACK (the printed
    column, the sentence skipped loudly); Ignition Energy is NEVER discarded and provides `Normal` → `{C}`
    through `energyProvidesOf` (0.454 has no `IGNITION_ENERGY` row); every catalog-only key and the new
    op kind are non-reasons, because no v37 record can carry them. No reading reinterprets a persisted
    byte, so no printing was dropped and `MATCH_RECORD_VERSION` stays 37. No client byte moved.

    🆕🆕🆕 **36 → 37 AT D570 — THE TENTH POSITION: ONE REQUIRED KEY, A TURN-MACHINE WINDOW.**
    The address, named first (D456's rule):
      · **`GameState.allowances.attackAgainUid: string | null`** — Festival Lead's attack-again
        window (Dipplin `sv06-018`/`-170`/`sv08.5-010`, Goldeen `sv06-044`/`sv08.5-020`, Swirlix
        `sv06-089`, Seaking `sv08.5-021`: *"If Festival Grounds is in play, this Pokémon may use
        an attack it has twice. …"*): the uid of the Active that may declare a SECOND attack
        this turn, written ONLY by flow.ts `finishAttack` on the first finish, read by turn.ts
        `turnGate` (only `attack` / `endTurn` while it is non-null — R-FL1), by
        `attackAgainBarred` (the second declaration's re-read — R-FL2) and by `finishAttack`
        itself (no third attack) [🆕 D570 landing (D539): and read DIRECTLY by flow.ts
        `resumeTurn` (the `ATTACK_AGAIN_OFFERED` row), redact.ts `mainPhase` and GameHud.tsx
        `attackAgainWindow`]. One turn wide: `freshAllowances()` wipes it at `startTurn`.

    🛑 **THE FIFTH POSITION'S TEST, RUN ON THE KEY — AND IT FAILS (driven).** The optional
    spelling passes D441 (an absent key reads as "no window", which is what a v36 writer
    meant) and is detectable in the bytes; it fails D456's *"inert on the board"*, because a
    0.453 ROLLBACK deploy resuming a v37 record saved INSIDE the window ignores the key and
    hands the turn owner a whole main phase between the two attacks: Trainer, attach,
    retreat, evolve and Ability plays the printed card never allows
    (`festivalLeadD570.test.ts` §8 (i)). A save taken mid-window is an ordinary save — the
    window survives the first attack's prize and promotion PARKS, and the attacker's own
    turn:action is a resting point — so this is not a residue a between-turns pipeline
    escapes. The key is REQUIRED and the version is owed.

    🛑 **AND A v36 RECORD IS NOT READ BENIGNLY — MEASURED.** A v36 bag has no
    `attackAgainUid` key: `turnGate` reads `undefined !== null` as an OPEN window and refuses
    every in-turn action but `attack` and `endTurn`, and `attackAgainBarred` reads a window
    no body holds and refuses the attack too — the turn owner is stranded with `endTurn`
    alone (`festivalLeadD570.test.ts` §8 (ii); D326's class, silent rather than a throw). The
    record is retired by `readMatchRecord`'s version gate on D124's rule.

    🛑 **WHY THE WINDOW IS NOT DERIVED FROM `usedAttack.turn` — REFUSED, ON THE SAME TEST.**
    D394's persisted `InPlayPokemon.usedAttack` already says "this body attacked this turn",
    so "the window is open iff the Active's `usedAttack.turn === state.turn` and the licence
    holds" would persist NOTHING new and hold the version at 36. It fails the identical
    rollback test: a 0.453 reader does not know that a `usedAttack` stamp narrows the turn,
    so the same mid-window save resumes into a full main phase — the derivation hides the
    window from the version gate without making the rollback safe. It is ALSO insufficient
    on this deploy's own boards: the SECOND attack writes the same `usedAttack.turn` stamp
    the first did, so "the window was closed by the second attack" (no third attack, R-FL4)
    needs a second persisted fact anyway — which is the key this block adds, written once,
    by the one site that knows.

    🛑 **WHAT WOULD REVERSE THIS (D422).** The fifth position's reversal (a rollback-safety
    rule that accepts a granted main phase as inert, or a pipeline that forbids rollback
    across a record-shape change) — neither holds today. The eighth position's second escape
    (saves only between turns) would cover this key too; it does not hold either.

    ⚠️ Also moved, and none is a second reason: the catalog-only `PassiveEffects.attackTwiceIf`
    (and its `passivesOf` list — derived, never persisted), the event `ATTACK_AGAIN_OFFERED`
    (not persisted, D141), and the client: redact.ts withholds retreat and the Ability,
    Trainer, Rare Candy and Stadium affordances inside the window (empty lists and a null
    retreat — the shapes the opponent's view already carries, so NO schema byte moves), and
    GameHud.tsx mirrors it. No `PendingStage` member is added: the window rides the shipped
    `resumeTurn` stage. The HUD draws no "attack again" banner and the playmat's drag
    affordances are not pre-folded against the window (a carried display debt, decisions.md
    D570).

    🆕🆕🆕 **37 → 38 AT D575 — THE ELEVENTH POSITION: ONE WIDENED PERSISTED VALUE, TWO REQUIRED
    KEYS, AND A RIDING ENUM WIDENING — EACH A PLAYED ATTACK EFFECT.** The addresses, named first
    (D456's rule):
      · **`InPlayPokemon.attackBlock.fromClass` — `AttackerClass.stage` WIDENED from `"basic"` to
        `"basic" | "ancient" | "ex"`** (Iron Moth `sv06.5-009` "Anachronism Repulsor": *"…by
        attacks from Ancient Pokémon"*; Miraidon `sv08-069` "C.O.D.E.: Protect": *"…by attacks
        from Pokémon ex"*). The key stays REQUIRED on the record (never optional — D569 (e)).
      · **`PlayerSide.sideAttackBlock: SideAttackBlock | null`** — Miraidon's SIDE-WIDE block over
        the controller's Future Pokémon, `{ turn, sourceUid, banner, fromClass }`, written by
        `installSideAttackBlock`, read by continuous.ts `attackBlockOf`'s side arm, cleared by
        interpreter.ts `switchInto` when the source leaves the Active (R-MI1). One non-test
        literal (setup.ts `emptySide`).
      · **`InPlayPokemon.handAttachMark: HandAttachMark | null`** — the Defending Pokémon's
        next-turn hand-attach mark, `{ turn, barred, endsTurn, tripped }` (Glimmora `sv08-115`
        "Corrosive Shards": no Energy from hand to it; Hypno `sv06.5-017` "Daydream": a hand
        attach to it ends the turn), written by `markHandAttach`, read by turn.ts `attachEnergy`,
        interpreter.ts `attachEnergyTargets` / `attachEnergyFrom` and flow.ts `settleProgram`;
        five literals write `null` (`makeInPlay` forced, four spread literals held by mutants).
      · **`GameOverReason` gains `"cardEffect"`** (N's Sigilyph `sv09-064` "Victory Symbol":
        *"…you win this game."*, the `winGame` op through flow.ts `finishGame`). A WIDENING alone
        would not bump (this block's own WIDENING paragraph above, the `conceded` precedent); it
        RIDES this bump. ⚠️ **DEPLOY THE CLIENT FIRST**: `packages/schema` `redactedGameOverReasonSchema`
        is a `z.enum`, so an OLD client parsing a snapshot whose outcome reason is `"cardEffect"`
        REJECTS it (`mrvAttackSliceD575.test.ts` §8 (iv)).

    🛑 **THE FIFTH POSITION'S TEST, RUN ON EACH — AND EACH FAILS (driven, `mrvAttackSliceD575.test.ts`
    §8 (i), (ii), (ii-b), (iii)).** (i) An optional
    `sideAttackBlock?` passes D441 (absent reads "no block", what a v37 writer meant) and fails
    D456's *"inert on the board"*: a 0.458 ROLLBACK resuming a v38 record saved inside the window
    ignores the key and the Pokémon ex's attack lands on the Future bodies the printed card
    protects. (ii) An optional `handAttachMark?` fails the same way: 0.458 grants the attach
    Glimmora bars (§8 (ii)) and keeps the turn Hypno ends (§8 (ii-b)). (iii) The `fromClass` widening is not even a
    question of optionality — a v38 record holding `{ stage: "ancient" }` falls out of 0.458's
    exhaustive `attackerMatchesStage` switch (`undefined`, falsy) and the block refuses NOTHING:
    D569 (e)'s finding, the reason Iron Moth waited for a bump. 0.458's code cannot run here, so
    §8 (iii) drives the FALL-OUT through THIS build's real `attackBlockOf` instead — a stage word
    the switch has no arm for (the position a v38 member occupies under 0.458) reads as NO block —
    and `D575-stage-switch-unknown-member-protects` is the mutant that turns it red. A save inside the opponent's
    turn is an ordinary save (every window here is that turn), so no between-turns pipeline
    escapes it. The keys are REQUIRED and the version is owed.

    🛑 **AND A v37 RECORD IS NOT READ BENIGNLY.** A v37 side has no `sideAttackBlock` key and a
    v37 body no `handAttachMark`: `attackBlockOf`'s side arm reads `undefined !== null` and
    dereferences `.turn` of `undefined` on the next attack (a `TypeError`, D326's class), and
    `liveHandAttachMark` does the same on the next attach. Retired by `readMatchRecord`'s version
    gate on D124's rule.

    ⚠️ Also moved, and none is a second reason: four `EffectOp` members (`installSideAttackBlock`,
    `markHandAttach`, `lookAtPrize`, `winGame` — only `lookAtPrize` parks, on the SHIPPED
    `choosePrize` and `orderCards` prompts, so no prompt kind and no wire byte moves), four events
    (`SIDE_ATTACK_BLOCK_APPLIED` / `_ENDED`, `HAND_ATTACH_MARKED`, `PRIZE_LOOKED_AT` — not
    persisted, D141), the `ErrorCode` `ENERGY_ATTACH_BARRED`, and `AttachTargetRiders.source`
    (catalog-side). No `PendingStage` member is added: Hypno's turn end seeds the shipped turn
    tail. The HUD draws neither the side block nor the hand mark, and a barred attach comes back as
    an error toast (carried display debts, decisions.md D575).

    🆕🆕🆕 **38 → 39 AT D576 — THE TWELFTH POSITION: A TRAINER UID IN A STACK.** The address, named
    first (D456's rule): **`InPlayPokemon.stack` may now hold an Antique Fossil's uid** (Antique
    Cover Fossil `sv07-129` / `sv10.5b-080`, Antique Root Fossil `sv07-130`, Antique Plume Fossil
    `sv10.5w-079` — Items played *"as if it were a 60-HP Basic {C} Pokémon"*). No key is added and
    no type widens: the BYTES are a uid in a string array, which every deploy since M1 reads. What
    changes is what those bytes MEAN — and that is the fifth position's test, not the shape's.
    0.460's `cardOfUid` (engine cards.ts) is ZONE-AWARE: a fossil uid that is a card of an in-play
    stack reads as its hand-written Pokémon face (`fossils.ts` — the ingest drops the face, so no
    catalog row carries it) [🆕 D581 (D539): WITHDRAWN as spelled — the ingest keeps the face since D581 and
    `fossils.ts` reads the Ability off the catalog row], 60 HP, Basic, {C}, its Ability. **0.459's `cardOfUid` is the pool
    lookup**: the same bytes read as the catalog Item, `hp: null`, and `hpOf` reads a null HP as a
    DATA GAP — *"the KO check skips rather than insta-KOs"* — so under a 0.459 ROLLBACK a v39 fossil
    body can never be Knocked Out, carries no Ability and has no card rules (it takes Special
    Conditions and retreats). [🆕 D581 (D539): TRUE ONLY OF A CATALOG NOT RE-INGESTED SINCE D581 —
    after the remote re-ingest the catalog Item carries `hp: 60` and its Ability, and 0.459's `hpOf`
    and `hasPrintedAbility` ask no category, so under a 0.459 rollback the body IS Knocked Out at 60
    and reads as having an Ability (with no program behind it); still no card rules. `antiqueFossilsD576.test.ts`
    §7 drives the PRE-D581 row (`hp: null`), which is what a not-yet-re-ingested remote holds.] Not inert on the board: driven in `antiqueFossilsD576.test.ts` §7
    through THIS build's real KO check on the 0.459 reading of the bytes (an Item uid on top of a
    stack: 900 damage, not lethal). The version is owed.

    ⚠️ **THE TWO OTHER POSITIONS THE PRICING ROUND NAMED ARE NOT PAID HERE.** Area Zero Underdepths
    ×3 (a Bench above 5 — 0.459's `isBenchIndex` is `< 5` — and a persisted `benchTrim` stage) is
    PARKED as D577 on the brief's off-ramp: its *"no Tera left"* trim needs a producer at EACH of
    the three Knock Out sweeps (mid-turn, attack, Checkup) PLUS the two Stadium-leave sites with
    the owner-first order carried through them — five, against the off-ramp's three (decisions.md
    D576). Neither shape moves at 0.460: `BENCH_MAX` stays 5 and `PendingStage` gains no member.
    (🆕🆕🆕 D577 (D539): *"Neither shape moves at 0.460"* stays TRUE of 0.460 and is WITHDRAWN as a
    standing claim, kept as written — at 0.461 (D577) `BENCH_MAX` still stays 5, but a Bench may
    hold up to `BENCH_CEILING` (8) and `PendingStage` GAINS `benchTrim`; both are paid by the
    THIRTEENTH POSITION below.)

    ⚠️ Also moved, and none is a second reason: the NEW `GameAction` member `discardFromPlay` (an
    action, never persisted — added to `MATCH_ACTION_DISPOSITION` as "supported" in the SAME deploy
    as its wire offer and its OnlineHud row, D210's order), the `ErrorCode` `NOT_DISCARDABLE`, the
    catalog-side `CardProgram.playAsPokemon` and `PassiveEffects.preventDamageWhileBenched` /
    `opponentActiveAttackCostSurchargeBasicOnly`, and the REQUIRED wire key
    `turn:action.discardable` — 🛑 **DEPLOY THE SERVER FIRST**: an old client's `z.object` STRIPS
    the unknown key, while a new client's REQUIRED key refuses an old server's frame.

    🆕🆕🆕 **STAYS 42 AT D614 — A WIDENED UNION AND A NEW EVENT, NO REQUIRED FIELD.** (Placed ABOVE the
    D613 block.) `EffectContext.invokedBy` gains `"ability"`, which a parked Ability program writes into
    `phase.cont.ctx`: an OPTIONAL key's new member, a widening (D125 / D259). A continuation parked on
    0.496 lacks it and resumes UNSHIELDED (an Adrena-Brain destination prompt keeps its persisted
    candidates, Clefable included). The new `ABILITY_EFFECT_PREVENTED` event is new text in new records
    (D141). No card row is read differently: Luminous Wing is a registry key read by id, so an in-flight
    `cardPool`'s Mega Clefable ex gains the shield on deploy. Rollback to 0.496 is clean: every reader of
    `invokedBy` compares against `"attack"` / `"item"` / `"supporter"`, so `"ability"` reads as absent,
    and the new row is rendered to text at apply time (`logFromEvents` into `record.log`), so a stored
    log holds no event for 0.496 to read.

    🆕🆕🆕 **STAYS 42 AT D613 — TWO RULE FIXES, NO PERSISTED SHAPE.** (Placed ABOVE the D612 block.)
    (1) turn.ts `attachEnergy` runs the mid-turn Knock Out sweep after a Jet Energy switch: control
    flow only. A v42 record saved on 0.495 with a lethal body left in play by that route keeps it until
    the next sweep (any mid-turn sweep or the Checkup collects every lethal body). (2) Bench placement
    is Basic only unless the printed noun names its card (cards.ts `benchMatches`). The permission is
    read off the `CardFilter`, which a persisted program already carries (a parked Cast-Off Shell
    confirm holds its `searchDeck` op), so no op gained a field. A bench `chooseCards` prompt parked on
    0.495 keeps its persisted candidates and is validated against them, so that one answer may still
    bench an Evolution card; a bench op that has not run yet reads the new rule. Rollback to 0.495 is
    clean: the shapes are the same and the any-stage reading returns.

    🆕🆕🆕 **STAYS 42 AT D612 — WP06 CHANGES HOW A CARD ROW'S TEXT IS READ, NOT ANY PERSISTED SHAPE.**
    (Placed ABOVE the D611 block.) The D581 / D583 lesson applies: a v42 `cardPool` persists whole
    Card faces, so a match created before the remote re-ingest holds tcgdex's RAW text (`<em>`,
    energy-symbol `<span>`, "[R]", "Basic Fire Energy"). cards.ts `cardOfUid` reads every face through
    the engine's `normalizeCardText` (cardText.ts), so that raw face plays exactly like a re-ingested
    row — no migration, no version step. The two retired by-id keys (Inferno X `mep-023` / `-029`,
    Stealthy Slash `30th-021` / `-148`) are covered the same way: their raw faces normalise to the
    reader-built sentence. Rollback to 0.494 is clean: a raw face plays as it did on 0.494 (the four
    keys are back, the 21 newly built printings unbuilt again), and a re-ingested clean row is text
    0.494's unchanged readers already build.

    🆕🆕🆕 **STAYS 42 AT D611 — WP21 ADDS ONE `EffectOp` (`countersOnRecordedBody`), ONE `BoardCondition`
    MEMBER (`notYourFirstTurn`), OPTIONAL KEYS (`payFromHand.swapWithTop`, `evolveFromDeck.fromHand` /
    `recordAs`, `HAND_COST_PAID.took`) AND ONE REGISTRY VALUE (`requiresEnergyType: "any"`), NO PROMPT
    KIND OR STAGE.** (Placed ABOVE the D610 block.) A parked
    Evidence Gathering (`payFromHand` + `swapWithTop`) or Spiteful Evolution (`evolveFromDeck` +
    `fromHand`, with `countersOnRecordedBody` in `cont.rest`) rides `phase.cont`: every key is optional and
    absent on every v42 writer (D125). No card row is read differently, so the 17 faces in a v42
    `cardPool` gain their Abilities mid-match. Rollback to 0.493 is NOT clean: a parked swap resumes as
    a plain top-of-deck payment (nothing comes back to the hand), but a parked Sinister Surge
    (`attachFromDeck`) or Spiteful Evolution carries `countersOnRecordedBody` in `cont.rest`, and 0.493's
    `stepOp` has no `default:` arm — the unknown op returns `undefined` and `runProgram`'s
    `"park" in stepped` THROWS a TypeError on resume (it does not whiff). Only a match parked inside
    one of those two Abilities at the moment of a rollback is exposed.

    🆕🆕🆕 **STAYS 42 AT D610 — WP37a ADDS ONE OPTIONAL `hpBonus` KEY AND WIDENS ONE `hpBonus` VALUE, NO OP,
    PROMPT, STAGE OR EVENT.** (Placed ABOVE the D609 block.) `requiresEnergyCount` and the "special"
    `requiresEnergyType` live on registry passives, read at use time and never persisted. The seven new
    objects are keyed by id on shipped ops; the only park they open is `moveEnergy`'s, whose `pendingOp`
    keys (`filter`, `max`, `route`, `anySource`) a v42 record already carries. No card row is read
    differently, so the 16 faces in a v42 `cardPool` gain their Abilities mid-match. Rollback to 0.492:
    the Abilities and the HP grants go away (a damaged Scale Up / Tyrantrum body is not swept until the
    next mid-turn KO check, D325's recorded seam).

    🆕🆕🆕 **STAYS 42 AT D609 — WP36 ADDS ONE `BoardCondition` MEMBER, ONE `knockOutChosen.target` VALUE AND
    TWO OPTIONAL KEYS, NO OP, PROMPT, STAGE OR EVENT.** (Placed ABOVE the D608 block.) Bring Down's
    `{ target: "anyExceptSelf", leastHpRemaining: true }` can ride `phase.cont.pendingOp` (a least-HP
    tie), a WIDENING: no v42 record holds either, and the resumed half (`doomBodyAt` on the answered ref)
    reads neither. `opponentActiveDamageCountersExactly` (Terminal Period) and
    `counterEachAll.perDamageCounterOnTarget` (Snow Coating) sit in programs that never park. No card
    row is read differently: the 8 `me` faces in a v42 `cardPool` are unchanged. Rollback to 0.491: the
    texts fall back to the unbuilt path; a parked Bring Down pick resumes on the prompt it parked with.

    🆕🆕🆕 **STAYS 42 AT D608 — WP30 ADDS ONE OPTIONAL KEY ON A PARKING OP (`damageChosen.specialEnergyOnly`),
    NO OP, PROMPT, STAGE OR EVENT.** (Placed ABOVE the D607 block.) The key can ride
    `phase.cont.pendingOp` (Bone Sniper over two or more candidates), but it is a WIDENING: no v42
    record holds it, absence means what it always meant, and it is read only in `snipeTargets`, which
    `applyChoice` never re-derives (the resumed pick reads the parked prompt). The `defenderStatus`
    optional-cost payoff is a reader output, never persisted; the five `30th` registry keys are looked
    up by id. No card row is read differently: the 18 `me` faces in a v42 `cardPool` are unchanged.
    Rollback to 0.490: the texts fall back to the unbuilt path; a parked Bone Sniper pick resumes on
    the prompt it parked with.

    🆕🆕🆕 **STAYS 42 AT D607 — WP28a ADDS THREE `DamageCountSource` MEMBERS, NO OP, PROMPT, KEY, STAGE OR
    EVENT.** (Placed ABOVE the D606 block.) The three members are produced only by the damage-fold
    readers and evaluated at declaration; no op field carries them (`damageActive.per` / `drawCards.per`
    never take one), so nothing persisted names them. No card row is read differently: the 14 `me`
    faces in a v42 `cardPool` are unchanged, and only their attack TEXT reads now. Rollback to 0.489:
    the eight texts fall back to the unbuilt path there; no in-flight state depends on them.

    🆕🆕🆕 **STAYS 42 AT D606 — WP25a ADDS TWO CATALOG FIELDS (`StadiumAbility.endsTurn`,
    `StadiumEffects.attackCostSurcharge`), NO OP, PROMPT, KEY, STAGE OR EVENT.** (Placed ABOVE the D605
    block.) Both fields are registry data, looked up by the Stadium's card id and never persisted; the
    nine `me` Stadiums are TRAINER faces in a v42 `cardPool` (D583's refresh), and no card row is read
    differently. A parked Lumiose City search carries the shipped `phase.endsTurn` (Koraidon's key since
    M5); Prism Tower and Surfing Beach park shipped `payFromHand` / `switchActive` ops; Celebratory
    Fanfare's `healEach` never parks. Rollback to 0.488: a parked Lumiose City still ends the turn (the
    flag is on the phase); 0.488 has no program for the nine ids, so their uses are unavailable there.

    🆕🆕🆕 **STAYS 42 AT D605 — WP34 ADDS TWO OPTIONAL `damageChosen` RIDERS, NO OP, PROMPT, KEY, STAGE OR EVENT.**
    (Placed ABOVE the D604 block.) `damageChosen.perHeadsInPlay?: CardFilter` (Tauros "Target
    Together") rides `phase.cont.pendingOp` while the pick is open — an optional key on a parking op,
    the D530 / D538 widening; no v42 record written before 0.488 holds it. `damageChosen.flipEach` is
    only ever written with `count: "all"`, which never parks, so it never reaches a record. Miraculous
    Paint parks shipped `optional` confirms (D557 `labels`); Gnaw Together and Kaleidowaltz expand
    shipped ops at the attack's flip site. Rollback to 0.487: a parked Target Together resolves as a
    flat 50 to the pick with no coins (0.487 reads no rider); nothing else is reachable.

    🆕🆕🆕 **STAYS 42 AT D604 —WP18 ADDS TWO CATALOG FIELDS AND ONE `EnergyOnAttach` MEMBER, NO OP, KEY, STAGE OR EVENT.**
    (Placed ABOVE the D603 block.) `EnergyProgram.holderType`, `EnergyOnAttach.benchSearch` and
    `returnAfterAttackDiscard: "hand"` are registry data, looked up by card id and never persisted. The
    eight `me` Special Energies are ENERGY faces in a v42 `cardPool` (D583 refreshed Trainer faces
    only): their programs are keyed by id and `isSpecialEnergy` reads the persisted printed text, so a
    v42 face is read as before — an in-flight match simply sees each provide its type (was {C}) and its
    rule switch on. The Telepathic Psychic search parks Nest Ball's `searchDeck` on `phase.cont`, a
    shipped op. A Nitro Fire uid can now ride `attackEpilogue.boomerang` (a v40 field); no 0.486 byte
    string holds one. Rollback to 0.486: the eight go back to unauthored {C}, and a Nitro uid on a
    parked epilogue would be RE-ATTACHED to its attacker (0.486 reads every recorded uid as a Boomerang).

    🆕🆕🆕 **STAYS 42 AT D603 — WP11 ADDS A `CardFilter` AND A `BoardCondition` MEMBER, NO OP, KEY, STAGE OR EVENT.**
    (Placed ABOVE the D602 block.) `BoardCondition.yourMegaExInPlay` is read off the board at use /
    attack time and never persisted. `CardFilter.megaEvolutionEx` IS at a persisted address — Mega
    Signal's `searchDeck` parks a `chooseCards` whose op rides `phase.cont` — but it is a WIDENING
    (D333): no v42 byte string a 0.485 deploy wrote can hold it. Eleven `me` ids are keyed on six new
    objects; programs are looked up by id and `isMegaEvolutionPokemonEx` reads the persisted NAME, so a
    v42 `cardPool` face is read exactly as before. Rollback to 0.485: the Abilities and Trainers go
    back to unusable, and a Mega Signal parked mid-search carries a filter kind the 0.485
    `matchesFilter` has no arm for, so any 0.485 re-read of that filter answers false.

    🆕🆕🆕 **STAYS 42 AT D602 — WP20b ADDS NO OP, KEY, GameState, PendingStage, PROMPT, EVENT OR WIRE KEY.**
    (Placed ABOVE the D600 block.) Nine `me` Pokémon ids are keyed on six new `abilities` objects built
    from shipped ops and fields only (`searchDeck`, `shuffleDeck`, `coinFlipGate`, `healChosen`,
    `healEach`, `attachFromDeck`, `playableIf`, `requiresEnergyType`, `benchOnly`); their parks are
    the shapes those ops already persist. Programs are looked up by id, and no card row is read
    differently, so a v42 match holding these faces in its `cardPool` gains the Abilities mid-match
    (a 0.484 rollback puts them back to unusable).

    🆕🆕🆕 **STAYS 42 AT D600 — WP14 + WP33b ADD NO OP, GameState, PendingStage, PROMPT, EVENT OR WIRE KEY.**
    (Placed ABOVE the D599 block.) Five `BoardCondition` members and a `DamageCountSource` member
    (`cardsInYourHand`) are read off the board at attack time and never persisted. `damageActive`
    gains an OPTIONAL `per` (D125): the op never parks and Alakazam's program is that lone op, so
    the key reaches no `phase.cont` here. No card row is read differently — the printed attack
    TEXT is, at attack time — so a v42 match holding these faces in its `cardPool` gains the
    readings mid-match (a 0.483 rollback puts them back on the skipped-effect path).

    🆕🆕🆕 **STAYS 42 AT D599 — WP24a ADDS NO OP, GameState, PendingStage, PROMPT, EVENT OR WIRE KEY.**
    (Placed ABOVE the D598 block.) 4 `me` Supporter ids are keyed: Anthea & Concordia on Briar's
    card-level `supporterKoPrizeBonus` (read off `allowances.supporterPlayedUid`, nothing new
    persisted) and Emma on `drawCards.per`'s NEW member `cardsInOpponentHand` — a union widening of
    an op that never parks in its one program, so it never reaches `phase.cont`. The card ROW is
    read as before, so a v42 match whose persisted `cardPool` holds these faces gains the programs
    mid-match; a 0.482 rollback finds no key and refuses the play (`TRAINER_NOT_SIMULATED`), and an Anthea
    & Concordia already played that turn pays no +3 there (no key to read); an Emma program cannot
    be mid-flight (it never parks), and a parked Look-Alike Show pick naming Emma resumes there as
    an empty splice (`supporterEffectOf` finds no program — the D580 inert whiff).

    🆕🆕🆕 **STAYS 42 AT D598 — WP32 ADDS NO OP, GameState, PendingStage, PROMPT, EVENT OR WIRE KEY.**
    (Placed ABOVE the D597 block.) 13 `me` Ability ids are keyed on registry-only fields
    (`PassiveEffects.seatKoPrizeReduction` / `survivesKoOnCoinFlip` / `koSelfToHand`,
    `TriggeredAbility.byOpponentAttack`, the `onKoPrizeGuard` member `"pokemonExAttackPrevent"`); a
    registry program is never persisted. Every event used exists (`ABILITY_COIN_FLIP`, `PRIZE_REDUCED`,
    `PRIZE_PREVENTED`, D572's `KNOCKED_OUT.toHand`, `DAMAGE_DEALT.survived`); the Final Chain park is
    the existing `koTrigger` stage and `chooseCards` prompt. The card ROW is read as before, so a v42
    match whose persisted `cardPool` holds these faces gains the Abilities mid-match; a 0.481 rollback
    finds no key and the Abilities fall silent (a parked Final Chain still resumes: its continuation
    is persisted).

    🆕🆕🆕 **STAYS 42 AT D597 — WP29 ADDS NO OP, OP KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D596 block.) The readers claim 7 more `me` attack TEXTS (16 printings) as
    shipped ops (`discardEnergy` / `payFromHand` + `damageDefender`, D488's mill + `countFilter`), and
    two `mep` ids are keyed on the attack-only `INFERNO_X` [🆕🆕🆕 D612: RETIRED — the text is normalised
    and reader-built]. The new `handDiscard` member of
    `AttackDiscardScaledBoost` is a reader result, never persisted. The card row is not read
    differently; its printed TEXT is, at attack time, so a v42 match in flight holding these faces in
    its persisted `cardPool` gains the programs mid-match. Every park is an EXISTING prompt
    (`discardEnergy`, `chooseCards`) whose continuation is persisted, so the 0.480 ROLLBACK reading of a
    parked D597 attack is "resumes AS BUILT"; off the park, 0.480 has none of the reader rows or keys,
    so the sentences are skipped loudly.

    🆕🆕🆕 **STAYS 42 AT D596 — WP09 ADDS ONE OPTIONAL OP KEY (`attachFromDeck.each`) AND NO
    GameState, PendingStage, PROMPT OR WIRE KEY.** (Placed ABOVE the D595 block.) The readers claim 3
    more `me` attack TEXTS (14 printings): Mega Symphonia / Geo Storm (`energyOnSelf` at the board zone
    on the `×` fold — a derived damage count, never persisted) and Overflowing Wishes (`attachFromDeck
    { each }` + `shuffleDeck`). The card row is not read differently; its printed TEXT is, at attack time,
    so a v42 match in flight holding these faces in its persisted `cardPool` gains the programs
    mid-match. `each` can ride `pendingOp` (D125 widening; a 0.479 record never holds it). The park is
    the EXISTING `attachCards` prompt with `max` and `maxPerTarget` already spelled, so the 0.479
    ROLLBACK reading of a parked Overflowing Wishes is "resumes AS BUILT" (its apply is
    `attachFromZoneApply` against the persisted prompt and never reads `each`); off the park, 0.479
    has neither reader row, so the three sentences are skipped loudly.

    🆕🆕🆕 **STAYS 42 AT D595 — WP13 ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D594 block.) The readers claim 8 more `me` attack TEXTS (11 printings): five
    `coinFlipGate`s over shipped ops and three `programPerHeads` over shipped ops. The card row is not
    read differently; its printed attack TEXT is, at attack time — so a v42 match in flight holding
    those faces in its persisted `cardPool` gains the programs mid-match (a 0.478 rollback puts them
    back on the skipped-effect path). The ops that park (`healChosen`, `knockOutChosen`, `searchDeck`,
    `gust`, `attachEnergyFrom`) park on prompt kinds a v42 record already holds, and a gate's `coins`
    key (D355) is one every v42 reader already reads.

    🆕🆕🆕 **STAYS 42 AT D594 — WP33a ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D593 block.) Four clause rows read 4 `me` attack TEXTS (8 printings) on shipped
    members, and two `me` ids gain Ability keys: Chesnaught's `damageAttacker` (shipped fields) and
    Luxio's `evolveEarlyExempt.ifCondition` — a REGISTRY field on a catalog program, never persisted
    (the licence is re-derived from the live board). The card row is not read differently; its printed
    attack TEXT is, at attack time, and the two Ability rows are catalog lookups by id — so a v42 match
    in flight holding those faces in its persisted `cardPool` gains the programs mid-match (a 0.477
    rollback puts them back on the skipped-effect path). Nothing parks on a new prompt kind.

    🆕🆕🆕 **STAYS 42 AT D593 — WP07 ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D592 block.) One `BoardCondition` member (`yourActiveBurnedOrPoisoned`) is
    new, but a condition is read off the board at attack time and never persisted: no op, stage or
    record carries one. Seven clause rows and an eighth `ATTACK_GATE_CLAUSES` row read 8 `me` attack
    TEXTS (10 printings) differently, and five `me` ids gain attack-only registry keys ("Fade Out"
    as `returnSelf` to hand, an op v42 already carries). No card row is read differently, so a v42
    match in flight holding those faces in its persisted `cardPool` gains the programs mid-match (a
    0.476 rollback puts them back on the skipped-effect path).

    🆕🆕🆕 **STAYS 42 AT D592 — WP02 ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D591 block.) `deriveAttackEffect` now reads 11 more `me` attack sentences (18
    printings): ten `me` phrasings through effects.ts `normaliseMeWording` and Corrosive Liquid. The
    card row is not read differently; its printed attack TEXT is, at attack time — so a v42 match in
    flight holding those faces in its persisted `cardPool` gains the programs mid-match (a 0.475
    rollback puts them back on the skipped-effect path). Every op is a shipped one; the ones that park
    (`bottomFromOpponentHand`, `damageChosen`) park on prompt kinds a v42 record already holds, and
    `installRecoil` writes the side state Shellnado Spin's `sv` twin already writes.

    🆕🆕🆕 **STAYS 42 AT D591 — WP20a ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D590 block.) 19 `me` printings gain an activated Ability on seven new registry
    objects, keyed by card id; no card row is read differently, so a v42 match in flight holding those
    faces in its persisted `cardPool` gains the Abilities mid-match (a 0.474 rollback loses them; a
    `"*:Run Errand"` / `"*:Lunar Cycle"` entry left in `allowances.abilitiesUsed` is an inert string,
    Flip the Script's key shape). Every op is a shipped one (`drawCards`, `attachEnergyFrom`,
    `payFromHand`, `drawUntilHandSize`); `attachEnergyFrom` `toSelf` never parks, and `payFromHand`
    parks only on a hand of Basic Energy that can be told apart, on keys a v42 record already holds.

    🆕🆕🆕 **STAYS 42 AT D590 — WP05 ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D589 block.) 13 `me` printings gain an `onEvolve` program on nine new objects, and
    *"Shuffle this Pokémon and all attached cards into your deck."* now derives (`returnSelf` to the
    deck: Lokix, Primarina ×2). The derived attack is read off the card TEXT in the persisted
    `GameState.cardPool`, so a v42 match in flight holding those faces gains it mid-match (a 0.473
    rollback loses it) — D589's stated cost; no re-ingest. Every op these programs run is a shipped one
    (`optional`, `drawCards`, `applyStatus`, `attachFromTop`, `shuffleDeck`, `gust`, `searchDeck`,
    `healChosen`, `coinFlipGate`, `discardEnergy`, `returnSelf`), and each one that parks (`optional`,
    `attachFromTop`, `gust`, `searchDeck`, `healChosen`, and `discardEnergy` when the Defending Pokémon
    holds Energy that can be told apart) uses only keys a v42 record already holds.

    🆕🆕🆕 **STAYS 42 AT D589 — WP08 ADDS NO OP, KEY, GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D588 block.) Four `me` attack sentences now derive through
    `deriveAttackOptionalCostBoost` (a third skeleton and four cost rows), and Mega Greninja ex ×5 gain
    `MORTAL_SHURIKEN`. The derived programs are read off the card TEXT in the persisted
    `GameState.cardPool`, so a v42 match in flight holding these faces gains the attacks mid-match (a
    0.472 rollback loses them) — the stated cost, as at D586; no re-ingest. Every op they park on
    (`optional`, `discardEnergy` with `providesEnergy` / `to`, `payFromHand`, `damageChosen`) uses only
    keys a v42 record already holds, so a confirm or a target pick parked at either version resumes.

    🆕🆕🆕 **STAYS 42 AT D588 —WP22 ADDS ONE OPTIONAL OP KEY AND NO GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D587 block.) 17 `me` Trainer ids gain a program on eight new objects; the one new
    field, `attachEnergyFrom.stage2Only` (Rosa's Encouragement), is an optional `EffectOp` key no v42
    deploy could write (D125's widening). It is read only when the target list is built, so a Rosa
    parked at a 0.471 rollback resumes on its persisted candidates and attaches as answered. Every
    prompt these programs park on (`choosePokemon` with `upTo`, `chooseCards`, `attachCards` with
    `oneTarget`, `discardEnergy`, the labelled `optional`) is a shape a v42 record already holds, and
    `trainerEndsTurn` rides the existing `phase.endsTurn`. As at D582 / D584–D587, a v42 match in
    flight gains the 17 Trainers mid-match (a 0.471 rollback loses them) — the stated cost; no re-ingest.

    🆕🆕🆕 **STAYS 42 AT D587 — WP04'S TRAINER PROGRAMS ADD NO GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D586 block.) 19 `me` Trainer ids gain a program on nine new objects built of shipped
    ops, fields and filters; every prompt they park on (`choosePokemon` with or without `upTo`,
    `chooseCards`, the opponent-answered switch) is a shape a v42 record already holds. A persisted
    `cardPool` keeps whole Card faces and programs are looked up by id at play time, so nothing persisted
    is read differently except that those 19 Trainers now play instead of being unbuilt: a v42 match in
    flight gains them mid-match (and a 0.470 rollback loses them; a Trainer parked at rollback resumes off
    its persisted continuation), as at D582 / D584–D586 — the stated cost; no re-ingest. The cardplay.ts
    empty-Bench gate and Energy Swatter's caption are play-time reads, not persisted.

    🆕🆕🆕 **STAYS 42 AT D586 — WP03'S CLAUSE ROWS ADD NO GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D585 block.) Eight `me` attack sentences now derive through shipped readers (one
    anchor, seven clause-table rows, all on shipped `BoardCondition` members and ops) and Carbink ×2 gains
    a `typesInPlay` passive. A persisted `cardPool` keeps whole Card faces and attack programs derive from
    the printed text at resolution, so nothing persisted is re-read differently except that those eight
    texts now resolve instead of being skipped: a v42 match in flight gains them mid-match (and a 0.469
    rollback drops them), as at D582 / D584 / D585 — the stated cost; no re-ingest.

    🆕🆕🆕 **STAYS 42 AT D585 — WP19'S PARAMETER COPIES ADD NO GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D584 block.) 19 `me` ids gain a program — eight new objects built of shipped ops,
    fields, filters and one shipped `BoardCondition` (`handSizesEqual`); every prompt they park on
    (`moveEnergy`, `choosePokemon`, `chooseCards`) already ships. No card row is READ differently, so a
    persisted `cardPool` needs nothing. As at D582 / D584, a v42 match in flight gains them mid-match (and a
    0.468 rollback drops them) — the stated cost; no re-ingest.

    🆕🆕🆕 **STAYS 42 AT D584 — THE `me` ALIAS TIER 2 ADDS NO GameState, PendingStage, PROMPT OR WIRE KEY.**
    (Placed ABOVE the D583 block, D563's placement.) What moved is the id-keyed registry only: 18 `me` ids
    gain a program (eight new objects built of shipped ops and fields) and Heatran `sv06-123`'s trigger is
    renamed "Incandescent Body". No card row is READ differently, so a persisted `cardPool` needs nothing; a
    parked `damagedTrigger` stage names a uid and re-reads its Ability. As at D582, a v42 match in flight
    gains those programs mid-match (and a 0.467 rollback drops them) — the stated cost; no re-ingest.

    🆕🆕🆕 **41 → 42 AT D583 — THE FIFTEENTH POSITION, AND THE FIRST MIGRATION: A v41 RECORD'S PERSISTED
    TRAINER FACES ARE REFRESHED, NOT RETIRED.** (Placed ABOVE the D582 block, out of date order — D563's
    placement.) The address (D456's rule): **`state.cardPool`** — the whole catalog `Card` of every deck id,
    persisted at match creation (D582 ①). A v41 record created before the D581 re-ingest holds a Trainer
    row with no printed face, and THIS deploy reads that face off the pool (TM Fluorite `sv08-188`'s attack,
    the four Antique Fossils' Ability and 60 HP): read as-is, TM Fluorite grants nothing and a fossil has no
    Ability for the rest of the match — D124's "reads back fine and plays subtly wrong", so the version is
    owed. But the fix is a DATA refresh with a known source, so the record is MIGRATED instead of retired:
    `migrateMatchRecord` (below, PURE) takes a v41 record and the pool ids re-read from D1
    (`loadMatchRecord` below, which lobbyDO.ts `peekMatch` calls and which persists the result before
    anything acts on it) and replaces every
    **Trainer** face whose fresh row is a Trainer; Pokémon and Energy faces, the state and the log are kept
    byte for byte (D581 moved only the Trainer branch of the ingest). Driven in `poolMigrationD583.test.ts`
    (a v41 record with `attacks: null` on `sv08-188` offers the TM attack after the migration). 🛑 **IT
    REFRESHES FROM WHATEVER D1 HOLDS**: the deploy order stays "re-ingest the REMOTE D1 first" (D581), or a
    v41 record migrates onto the old rows and is stamped v42 with them. A rollback to any build at
    `MATCH_RECORD_VERSION` 41 (the live 0.464, or 0.465 / 0.466) retires every v42 record (D124 — the
    version gate), which is the stated cost. A failed D1 read writes nothing (`loadMatchRecord`). No other byte moves; any other version is
    retired as before. The D582 block's *"only the end of those matches does"* is WITHDRAWN (D539) by this.

    🆕🆕🆕 **STAYS 41 AT D582 — THE MEGA EVOLUTION ex RULE AND THE `me` REPRINT-ALIAS TIER ADD NO GameState,
    PendingStage, PROMPT OR WIRE KEY.** (Placed ABOVE the D581 block, out of date order — D563's placement.)
    What moved is a RULE read at Knock Out time and two id-keyed tables, none persisted: cards.ts
    `prizeValueOf` answers 3 for a "Mega … ex" (`isMegaEvolutionPokemonEx`, read off the card NAME in the
    match's `cardPool`), the registry keys 99 `me` ids on EXISTING program objects, and banners.ts marks five
    `me` Tera reprints. Every op a 0.466 match can park on those ids is an op 0.465 already ships, so a 0.465
    rollback reads every v41 byte. 🛑 **THE RULE IS NOT VERSIONED, AND THAT IS THE STATED COST:** a v41
    match in flight across the deploy pays 3 Prizes for a Mega ex KO from its next Knock Out on (the printed
    rule — 0.465 paid 2), and a rollback pays 2 again; a `me` alias id gains (or, rolled back, loses) its
    program mid-match. Same class as every D5xx rule slice that stayed 41 (D580). No re-ingest is owed.
    [🆕🆕🆕 D582 (D539) — TWO D581 PREMISES BELOW ARE WITHDRAWN. ① *"A v41 state carries card IDS, never card
    faces"* is FALSE: `GameState.cardPool` holds the whole catalog `Card` of every deck id, loaded from D1 at
    match creation (lobbyDO.ts `loadCardPool`) and persisted with the state. So the D581 deploy has a FOURTH
    window the three-window list missed: a match created before the remote re-ingest keeps its pre-D581 rows
    for its WHOLE LIFE (TM Fluorite grants nothing, a fossil face has no Ability), and one created under 0.465
    keeps the re-ingested rows under a 0.464 rollback (no category guards). Re-ingesting first does not close
    it; only the end of those matches does [🆕🆕🆕 D583 (D539): WITHDRAWN — a v41 record's Trainer faces are
    refreshed from D1 on its first load, "41 → 42 AT D583" above]. ② *"the match pool is fetched through GET `/cards/:id`"* is true
    of the LOCAL match only (src/features/game/cardPool.ts); this file's online pool reads D1 directly and
    never touches the KV cache.]

    🆕🆕🆕 **STAYS 41 AT D581 — THE DATA SLICE ADDS NO GameState, PendingStage, PROMPT OR WIRE KEY.** (Placed
    ABOVE the D580 block, out of date order — D563's placement — so every anchored line below stays byte-
    identical.) What moved is CATALOG data and two catalog READS, none of them persisted: the ingest keeps a
    Trainer's printed face (`hp` / `abilities` / `attacks`), the fossil face reads its Ability off the row, the
    attack menu's Tool section reads the Tool card's own `attacks` (`toolAttacks` became a flag), and
    `attacksOf` / `hasPrintedAbility` ask the category. A v41 state carries card IDS, never card faces, so a
    0.464 rollback reads every v41 byte as before. [🆕🆕🆕 D582 (D539): WITHDRAWN — see ① in the D582 block above.] 🛑 **DEPLOY ORDER IS A DATA ORDER, NOT A CLIENT/SERVER ONE:
    re-ingest the REMOTE D1 first** (the nine sets whose Trainers print a face, and the `me` serie) — this
    server reads the fossil Ability and the TM attack OFF THE CATALOG, so against an un-re-ingested D1 the four
    fossils play with no Ability and Technical Machine: Fluorite grants nothing. The KV catalog cache steps to
    `v7` with this deploy (catalog/cache.ts): the match pool is fetched through GET `/cards/:id`, so a v6 body
    cached before the re-ingest would otherwise serve that old row for up to the 1-hour TTL after it. [🆕🆕🆕 D582 (D539): the LOCAL
    match's pool only — see ② in the D582 block above.]

    🆕🆕🆕 **STAYS 41 AT D580 — MR. MIME "LOOK-ALIKE SHOW" AND IRON TREADS "DUAL CORE" ADD NO GameState,
    PendingStage OR REQUIRED KEY; THE ONE NEW PERSISTED SHAPE IS A PARKED OP, AND A 0.463 ROLLBACK READS
    IT AS AN INERT WHIFF.** (Placed ABOVE the D579 block, out of date order — D563's placement — so the
    declaration's anchor lines, every `*-record-version-not-bumped` row's `find` and the D577 doc tail
    stay byte-identical.) The addresses, named first (D456's rule):
    ⑴ **A PARKED `useOpponentSupporterEffect`** (field-free) in `phase.cont.pendingOp`, its prompt a
    `chooseCards` with the NEW `dest` member `"use"`. Under a 0.463 rollback the op has no `stepOp`,
    `continuationOps` or `applyChoice` arm, so the answer whiffs through the default arms — D572's
    reading, and D579 ⑶'s own classification of exactly this shape ("inert in the player's disfavour, no
    illegal state … it rides the bump; it is not a second reason for it"): nothing is used, the reveal
    was already public, and no card moves. Driven: `lookAlikeShowD580.test.ts` §7 resumes a parked v41
    state with the op renamed to one this deploy does not know and gets the DECLINE's board exactly.
    ⑵ **NO `GameState` KEY.** The Supporter's program is spliced into the SAME attack `cont` as ordinary
    ops (every one already persisted shape), and R-LA1 writes no allowance (`supporterPlayed` /
    `supporterPlayedUid` untouched). The NEW event `SUPPORTER_EFFECT_USED` is not persisted (D141).
    ⑶ **`PassiveEffects.typesInPlayWhileToolNamed`** (Dual Core) is CATALOG-only — read off the live
    board by `inPlayCardOf`, never persisted; a 0.463 rollback reads Iron Treads as its printed {M}, the
    answer every Standard-legal board gives anyway (its condition card `sv05-149` is not legal).
    🛑 **DEPLOY THE CLIENT FIRST** (or both together): the wire `chooseCards.dest` `z.enum` gains `"use"`,
    and a 0.463 client's enum REFUSES a frame carrying it (zod strips an unknown KEY, never an unknown
    VALUE). Both HUDs' total `CHOOSE_CARDS_VERB` records gain the `use` cell ("Use"). The off-ramp, had
    the reading failed, was 41 → 42 (19 files pin `MATCH_RECORD_VERSION = 41`); it did not fire, and
    `MATCH_RECORD_VERSION` stays 41.

    🆕🆕🆕 **40 → 41 AT D579 — THE FOURTEENTH POSITION: A NEW REQUIRED `GameState` KEY, AND A SECOND
    `takeVerb` VALUE.** (Placed ABOVE the D578 and D577 blocks, out of date order — D563's placement —
    so the D577 doc tail every `*-record-version-not-bumped` row anchors on stays byte-identical.) The
    addresses, named first (D456's rule):
    ⑴ **`GameState.recentAttackers: Record<Seat, readonly { turn, uid }[]>`** — REQUIRED (D326/D271:
    a new required `GameState` key always bumps). Koraidon `sv08-116` "Unrelenting Onslaught" reads
    it for "+150 if 1 of your other Ancient Pokémon used an attack during your last turn" (R-1,
    reading B, RULED BY THE USER 2026-10-05: the record outlives the body). A v40 record lacks the key
    and this deploy INDEXES it (`state.recentAttackers[seat]`) at every attack's end and at every
    Koraidon declaration — D326's throw, so the record is retired rather than read.
    ⑵ **THE 0.462 ROLLBACK READING, NAMED**: a 0.462 deploy resuming a v41 record IGNORES the key (it
    has no reader), so Koraidon's +150 LAPSES for the one turn whose record it was written in — a
    played effect silently gone, not inert, which is why the version moves rather than holds on
    D572's whiff argument.
    ⑶ **A PARKED Walking Wake `sv06-063` "Undulating Slice"** — the NEW `EffectOp`
    `putCountersOnSelfChosen { upTo }` in `phase.cont.pendingOp`, with `damageDefender { count:
    "placed" }` in `cont.rest`, the NEW `EffectSlot` member `"placed"` in `cont.record` and the
    prompt's `takeVerb: "put"`. Under a 0.462 rollback the op has no `stepOp` arm and no
    `applyChoice` arm, so the park WHIFFS through the default arms (D572's reading): nothing is
    placed, the `placed` slot stays unfiled, and the hit counts 0 — inert in the player's disfavour,
    no illegal state. This rides the bump; it is not a second reason for it.
    🛑 **DEPLOY THE CLIENT FIRST** (or both together): the wire schema's `takeVerb` widens from
    `z.literal("move")` to `z.enum(["move", "put"])`, and a 0.462 client's strict literal REFUSES a
    frame carrying `"put"` (zod strips an unknown KEY, never an unknown VALUE). The web HUDs already
    interpolate `prompt.takeVerb ?? "attach"`, so no client code moves beyond the schema.
    ⚠️ Also moved, none a further reason: the `BoardCondition` member
    `yourOtherBannerPokemonAttackedLastTurn` (read at declaration, never persisted) and one
    `CONDITIONAL_DAMAGE_CLAUSES` row. ⚠️ **ANGELITE IS NOT RE-POINTED (R-1b, ⚠️ UNRULED)**: Sylveon ex's
    bar still reads the per-body `InPlayPokemon.usedAttack`, so no v40 byte under it changes meaning.

    🆕🆕🆕 **STAYS 40 AT D578 — SCOVILLAIN ex "DOUBLE TYPE", RELICANTH "MEMORY DIVE", TECHNICAL MACHINE:
    FLUORITE AND TEAM ROCKET'S ENERGY CHANGE NO GameState, PendingStage OR `cont` SHAPE; EVERY 0.461
    ROLLBACK READING IS INERT.** (Placed ABOVE the D577 block, out of date order, so the declaration's
    anchor lines — and every `*-record-version-not-bumped` row's `find` and the D577 doc tail — stay
    byte-identical: D563's placement.) The addresses, named first (D456's rule): ⑴ NOTHING NEW IS
    PERSISTED. The four programs are catalog-side registry rows (`PassiveEffects.typesInPlay` /
    `memoryDive`, `CardProgram.toolAttacks` / `toolDiscardAtEndOfYourTurn`, `EnergyProgram.attachOnlyToOwner`,
    the constrained provided unit) read off the live board; `GameState`, `InPlayPokemon`, `PendingStage`
    and the `cont` / `pendingOp` shapes gain no key and no member. ⑵ The ATTACK MENU's flat index rides
    only `AttackAction.index` (an action, never persisted) and the wire's `RedactedAttack.index`; every
    persisted index — a `lockedAttacks` entry, a `boostedAttack` record — stays a PRINTED index, because
    the menu lists the printed attacks FIRST and a borrowed or Technical Machine row writes none (R-MD4)
    [🆕🆕🆕 D578 landing (R-MD4, RULED: fixed): ~~writes none~~ writes a NAME-keyed entry — ⑸ below].
    ⑶ The `healEach` `banner` rider is an `EffectOp` key, but the one program carrying it (TM Fluorite's)
    never parks before it, so no `cont` can hold it. ⑷ The `ENERGY_DISCARDED` / `TOOLS_DISCARDED` rows the
    two new sweeps emit are existing EVENT shapes, not persisted (D141). THE 0.461 ROLLBACK READINGS, each
    inert (no illegal action is granted, no byte is reinterpreted against its writer): **the TM** —
    0.461 has no program for `sv08-188`, so an attached TM grants NOTHING (no menu row) and is NEVER
    discarded at its owner's turn end (it sits as a dead Tool, occupying the slot); **borrowed rows** —
    0.461 offers the printed attacks only, so a Memory Dive or TM index is `BAD_ATTACK_INDEX` and no
    record names one; **Team Rocket's Energy** — 0.461 has no program for `sv10-182`, so it DEGRADES to
    one {C} (`energyProvidesOf`'s unauthored-Special fallback) on whatever body holds it; **Scovillain
    ex** — 0.461 reads its printed {R} only. And the other direction: a LIVE v40 record written under
    0.461 may hold Team Rocket's Energy on a non-Team Rocket's body (legal at 0.461, where the card was a
    plain {C}); 0.462's state check (flow.ts `discardMisplacedEnergy`, the top of `advance`) discards it
    on that record's first drain after deploy — benign, the card's own printed rule applied late, and
    the same answer the hand attach now refuses up front. No printing is dropped and
    `MATCH_RECORD_VERSION` stays 40. No schema shape moves (two doc annotations only); the web HUD
    lists the engine menu.
    🆕🆕🆕 ⑸ **AT THE LANDING (R-MD4 and R-TRE1 FIXED, not shipped unruled) — TWO OPTIONAL KEYS, BOTH
    WIDENINGS, AND THE CONSTANT STILL STAYS 40** (~~⑴'s *"gain no key"*~~ is withdrawn for these two,
    D539): `LockedAttack.attackName?` (a borrowed row's own self-lock, written with `attackIndex: -1`)
    and `EffectContext.borrowedAttack?` (rides `phase.cont.ctx`). D421's `until` and D427's `dealt`
    are the precedent: every record written before them lacks the key and reads as before. THE 0.461
    ROLLBACK READINGS, each inert: a `{ turn, attackIndex: -1, attackName }` entry answers `-1` from
    0.461's `lockedAttackIndexes`, which no `action.index` (an integer ≥ 0 over the printed list) and
    no projection row equals — the bar lapses, the player's favour, 0.461's own reading of a game it
    could not have produced; a `cont.ctx.borrowedAttack` is never read by 0.461 (`preventAttackUse`
    there resolves the name on the printed attacks, D154). R-TRE1's fix moves no byte: the state
    check now also runs after each program step, on a parked answer and on every accepted action.

    🆕🆕🆕 **39 → 40 AT D577 — THE THIRTEENTH POSITION: AN 8-BENCH, A TRIM, A BOOMERANG AND A
    GUESS.** The addresses, named first (D456's rule), each one a v40 byte a 0.460 reader would
    read wrongly — not inert, so the version is owed:
    (i) **A Bench index above 4** — Area Zero Underdepths `sv07-131` / `sv07-174` / `sv08.5-094`
    lets a seat with a Tera Pokémon in play hold up to `BENCH_CEILING` (8) Benched Pokémon
    (engine continuous.ts `benchLimitOf`). A v40 `PlayerSide.bench` may hold 6 … 8 bodies; 0.460's
    turn.ts `isBenchIndex` is `< BENCH_MAX` (5), so every action addressing slot 5 … 7 (a
    promotion, an attach, a retreat target) is refused as malformed on a board it cannot address.
    (ii) **The persisted `PendingStage` member `{ kind: "benchTrim", seat }`** — the trim back to 5
    when a seat loses its last Tera Pokémon or the Stadium leaves (R-AZ2 / R-AZ3). 0.460's
    exhaustive `advance` switch has no arm for it: the stage falls through, `advance` returns
    `undefined`, and the reducer hands the caller a non-result — a wedged queue, D326's class.
    (iii) **`attackEpilogue.boomerang?: string[]`** — Boomerang Energy `sv06-166`'s record, written
    on the queued epilogue by the attack's own discard and re-attached when it drains. OPTIONAL,
    and that is the FIFTH POSITION's failure: a 0.460 reader drops it silently, so a parked
    attack resumed under a rollback discards the Boomerang it printed back.
    (iv) **Tyme's op, prompt and choice in `phase.cont` / `effect:choose`** — the `EffectOp`
    `opponentGuessesHp { draw, uid? }` parked in `cont.pendingOp`, the THIRTEENTH prompt kind
    `guessHp { name, note }` on the phase (TWELVE until now — the count at the D548 note below is
    withdrawn), and the `hpGuess` answer. 0.460 has no `stepOp` arm for the op (its exhaustive
    switch falls through to `undefined`) and its `validateChoice` / `redactPrompt` switches no arm
    for the prompt — a parked Tyme under a rollback cannot be answered.
    🛑 **AND A v39 RECORD IS READ BENIGNLY BY 0.461, BUT IS RETIRED ANYWAY** — every v39 byte means
    the same at 0.461 (a Bench of ≤ 5, no trim, no Boomerang, no Tyme), so the retirement is D124's
    rule, not a hazard.
    ⚠️ Also moved, and none is a second reason: the chooseCards `dest` member `"name"` and the wire
    arm `guessHp` (both additive schema widenings — 🛑 **DEPLOY THE CLIENT FIRST**, or both
    together: an old client's `z.discriminatedUnion` / `z.enum` refuses the new arm and member),
    the `trimBench` `EffectOp` (parked in `cont`, a D125 widening carried by (ii)), the events
    `BENCH_TRIMMED`, `POKEMON_NAMED`, `HP_GUESSED` (not persisted, D141), and the catalog-side
    `StadiumEffects.benchLimitWithTera` / `EnergyProgram.returnAfterAttackDiscard`. */
export const MATCH_RECORD_VERSION = 42;

/** 🆕🆕🆕 D583 — the one version this deploy MIGRATES rather than retires ("41 → 42 AT D583" above). */
export const MIGRATABLE_MATCH_RECORD_VERSION = 41;

/** 🆕🆕🆕 D583 — the catalog ids a v41 record's pool holds (what `loadMatchRecord` re-reads from D1), or
    `null` for anything that is not a well-formed v41 record. PURE. */
export function migratablePoolIdsOf(raw: unknown): string[] | null {
  const record = readMigratableRecord(raw);
  return record === null ? null : Object.keys(record.state.cardPool);
}

/** 🆕🆕🆕 D583 — migrate a v41 record to this deploy's version: every persisted TRAINER face whose
    `fresh` row is also a Trainer is replaced by that row; every other byte is kept. `null` for
    anything that is not a well-formed v41 record. PURE — `loadMatchRecord` (below) loads `fresh`
    from D1 and persists the result. */
export function migrateMatchRecord(raw: unknown, fresh: Record<string, Card>): MatchRecord | null {
  const record = readMigratableRecord(raw);
  if (record === null) return null;
  const cardPool: Record<string, Card> = { ...record.state.cardPool };
  for (const [id, card] of Object.entries(cardPool)) {
    const row = fresh[id];
    if (card.category === "Trainer" && row?.category === "Trainer") cardPool[id] = row;
  }
  return { ...record, version: MATCH_RECORD_VERSION, state: { ...record.state, cardPool } };
}

/** 🆕🆕🆕 D583 — the one persisted match slot `loadMatchRecord` reads and writes (the DO's
    `MATCH_KEY` in its storage, narrowed so the step is testable without a Durable Object). */
export interface MatchSlot {
  get(): Promise<unknown>;
  put(record: MatchRecord): Promise<void>;
}

/** 🆕🆕🆕 D583 — read the persisted match: absent, usable, or stale; a v41 record is MIGRATED and
    the v42 record written back before it is returned (lobbyDO.ts `peekMatch` is this call).
    `loadPool` is external I/O (D1), so the slot is RE-READ after it: another event may have
    migrated, advanced or ended the match meanwhile, and only a record still at v41 is migrated.
    A failed `loadPool` rejects and writes nothing, so the v41 record waits for the next read:
    from a socket frame that event fails; from the DO's `alarm()` the platform retries the alarm;
    from `handoffToMatch` the handoff fails. Playing the record unmigrated is never an option:
    this build cannot trust a v41 pool. */
export async function loadMatchRecord(
  slot: MatchSlot,
  loadPool: (ids: readonly string[]) => Promise<Record<string, Card>>,
): Promise<MatchLoad> {
  const raw = await slot.get();
  if (raw === undefined) return { kind: "none" };
  const record = readMatchRecord(raw);
  if (record !== null) return { kind: "ok", record };
  const ids = migratablePoolIdsOf(raw);
  if (ids === null) return { kind: "stale" };
  const fresh = await loadPool(ids);
  const again = await slot.get();
  if (again === undefined) return { kind: "none" };
  const current = readMatchRecord(again);
  if (current !== null) return { kind: "ok", record: current };
  const migrated = migrateMatchRecord(again, fresh);
  if (migrated === null) return { kind: "stale" };
  await slot.put(migrated);
  return { kind: "ok", record: migrated };
}

/** A v41 record passed through `readMatchRecord`'s own shape checks, or `null`. */
function readMigratableRecord(raw: unknown): MatchRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  if ((raw as { version?: unknown }).version !== MIGRATABLE_MATCH_RECORD_VERSION) return null;
  const record = readMatchRecord({ ...raw, version: MATCH_RECORD_VERSION });
  if (record === null) return null;
  const pool = (record.state as { cardPool?: unknown }).cardPool;
  return typeof pool === "object" && pool !== null ? record : null;
}

/** How a persisted match read back: absent, usable, or written by an
    incompatible deploy (`stale` — the caller decides whether to retire it). */
export type MatchLoad = { kind: "none" } | { kind: "ok"; record: MatchRecord } | { kind: "stale" };

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

/** Every action type the engine's `GameAction` union carries, and whether this
    deploy's online client may send it. **THE TABLE IS THE ALLOWLIST** —
    `SUPPORTED_MATCH_ACTIONS` below is DERIVED from it, so the two cannot drift —
    and `satisfies Record<GameAction["type"], …>` is the part that earns its
    keep: an action added to (or renamed in) the engine is a MISSING KEY here and
    **fails the build**, so a new affordance can neither reach the DO unnoticed
    nor be silently forgotten. That is the half of this module's old prose
    invariant the api can actually hold; the other half — "a park the client
    reaches has a dialog" — is checked on the web, see `SUPPORTED_MATCH_ACTIONS`.

    `"withheld"` means the ENGINE accepts it but no surface sends it. **THERE IS
    NONE LEFT.** The table's one withheld entry — `useStadiumAbility` (engine
    0.53.0, D102 — the §7.3 "once during each player's turn" Stadium) — was
    silent from D102, classified by D203, investigated by D209 and **closed by
    D210**, which built the surface D209 refused to flip the entry without. The
    map is now `Record<GameAction["type"], "supported">` in fact if not in type,
    and the `"withheld"` arm is kept because the NEXT engine action to arrive
    without a client is the case this vocabulary exists for.

    🛑 **WHAT D209 FOUND, KEPT BECAUSE THE ROT IS THE LESSON.** D102's row and
    D203's rewrite of this block both justified the deferral by naming the
    drivable Stadiums as *Artazon sv02-171/-229, Mesagoza sv01-178, Town Store
    sv03-196* — re-queried against the live D1 (2026-08-04), **every one is
    regulation G with `legal_standard=0`**: they ROTATED. (`sv02-229` is not even
    an Artazon — it is Dudunsparce; the reprint the registry maps is
    **`sv03-229`**.) Meanwhile the registry had gained two MORE Stadium abilities,
    both **Standard-legal, regulation I**: **Levincia `sv09-150`/`sv10-244`**
    (`LEVINCIA` — `discardPileRetrieval` of up to 2 Basic {L} from the discard)
    and **Spikemuth Gym `sv10-169`** (`SPIKEMUTH_GYM` — `searchDeck` a Marnie's
    Pokémon). Deck load applies **no format/legality gate** (`deckLoad.ts` /
    `cardPool.ts` filter on neither `legal_standard` nor `regulation_mark`), so a
    real account deck holds one and the Stadium DRAG (`playTrainer`) puts it in
    play — the card reached online matches with its printed effect unreachable. A FIDELITY gap, never a soft-lock: both programs park on
    `chooseCards`, which has had an online dialog since 2b-iii-c.

    **D210 landed the surface IN D209's ORDER, and the order was the point.**
    (i) `redactGame`'s `turn:action` arm now folds the offer server-side
    (`redactedStadiumAbilityOf` — `programFor(stadium).stadium?.ability`,
    `allowances.stadiumAbilityUsed`, `programPlayable`), actor-only like every
    sibling on that arm; (ii) `redactedStadiumAbilitySchema` carries it on the
    wire; (iii) `OnlineHud`'s turn panel renders the §7.3 Stadium row that
    dispatches `{type:"useStadiumAbility", seat}`; and ONLY THEN (iv) this entry
    flipped. Reversing that order is D157's mistake — an action on the allowlist
    ahead of its surface, which soft-locked online matches for 44 decisions — and
    it is not left to discipline: the two links below are BICONDITIONAL, so any
    one of the four steps alone is RED.

    **THE REFUSAL WAS CHECKED IN TWO LINKS, AND SO IS THE SUPPORT** (D203's rule:
    a guard lives where it can fail). `match.test.ts` holds the link the api can
    see — *on this allowlist ⟺ the wire's `turn:action` carries a Stadium offer*,
    read off `redactedPhaseSchema` rather than restated. `src/features/online/
    components/OnlineHud.stadiumAbility.test.ts` holds the other — *that wire
    offer ⟺ a control in the online client*. They did not change direction when
    the answer changed; they changed VALUE, which is what a biconditional is for.

    ⚠️ The remaining honest caveat is NOT about this entry. `applyMatchAction`
    admits the action; the engine gate (`cardplay.ts`) re-validates every term
    (turnGate → a Stadium in play → that Stadium has an activated ability → the
    once-per-turn flag → `programPlayable`), so a crafted frame changes nothing.
    What is still true is that the greying depends on a fold that must keep
    agreeing with that gate, which is pinned in
    `packages/engine/src/redactStadiumAbility.test.ts` against `applyAction`
    itself rather than against a restatement of it. */
export const MATCH_ACTION_DISPOSITION = {
  chooseFirstPlayer: "supported",
  setupDrawExtra: "supported",
  setupPlaceActive: "supported",
  setupPlaceBench: "supported",
  setupReady: "supported",
  attachEnergy: "supported",
  playBasicToBench: "supported",
  evolve: "supported",
  attachTool: "supported",
  playTrainer: "supported",
  useAbility: "supported",
  // D210 — the last withheld entry, flipped only AFTER its wire offer
  // (`redactedStadiumAbilityOf`) and its OnlineHud row existed. §7.3.
  useStadiumAbility: "supported",
  rareCandy: "supported",
  concede: "supported",
  attack: "supported",
  takePrizes: "supported",
  promote: "supported",
  retreat: "supported",
  resolveEffect: "supported",
  endTurn: "supported",
  // 🆕🆕🆕 D576 — an Antique Fossil's "discard this card from play" (R-FO3), supported in the
  // SAME deploy as its wire offer (`turn:action.discardable`) and its OnlineHud row — D210's
  // order, held by the biconditional in match.test.ts.
  discardFromPlay: "supported",
} as const satisfies Record<GameAction["type"], "supported" | "withheld">;

/** The engine action types the online client can DRIVE and RECOVER from: setup,
    the `moveToAction` turn drags (attach energy, bench a Basic, evolve, attach a
    Tool, play a Stadium), pass, the attack + KO loop (increment 2b-i — `attack`,
    then the KOing player's `takePrizes` and the KO'd player's `promote`
    — 🆕🆕 D431: `takePrizes` is NO LONGER ONLY the KOing player's. An attack whose
    printed effect says *"…and take a Prize card."* queues the same decision with no
    Knock Out anywhere on the board, so this clause names the ORIGIN that was
    exhaustive until 0.333.0 and is now one origin of two. Nothing in this file
    changes — the action is the same action and its support flag is unconditional —
    but the sentence would otherwise read as a claim about when the client can expect
    the prompt, which is exactly the closed-world reading D431 exists to remove),
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
    dialog): each is accepted and let park wherever the engine takes it — with an
    EFFECT attack / ability / trainer that is effect:choose. `retreat` never
    carried the caveat (it only discards energy + promotes a Bench Pokémon, never
    parking at a decision, so it is soft-lock-safe with ANY deck). `resolveEffect`
    is safe from the other side: `applyAction` rejects it off an effect:choose
    park, and ON one it validates the choice against the parked prompt
    (`validateChoice`) before applying — a crafted frame rejects, never crashes
    or wedges.

    🛑 **THE DIALOG HALF OF THAT SENTENCE IS NOT CHECKED HERE, AND THIS COMMENT NO
    LONGER PRETENDS IT IS.** It used to assert the invariant outright —
    *"`resolveEffect` on this set ⟺ EVERY effect prompt kind has an online
    dialog"*, with 2b-iii having *"dialoged all seven kinds"*, D157's `chooseAttack`
    (Medicham sv01-111, Oranguru sv02-094) landing *"its dialog in the same slice"*,
    and the compiler catching a gap because *"`EffectChooseDialog`'s chain ends in
    an `else`"*. Every one of those was wrong at the time it was read. D157 shipped
    the LOCAL dialog (`GameHud`) only; `OnlineHud`'s router had **no declared return
    type at all**, so an unmatched kind fell off the end as `undefined` and the
    compiler said nothing; and for **FORTY-FOUR DECISIONS** an online `chooseAttack`
    park rendered no dialog, offered no decline and swallowed Escape — **a live
    soft-lock**, while this paragraph said it could not happen. ⚠️ **THE PROSE WAS
    THE CAMOUFLAGE**: an invariant asserted in a comment is checked by nothing, and
    reads exactly like one that is. The count was wrong too — the wire prompt union
    is ~~**NINE** kinds, not seven or eight~~: mayDraw, `confirm` (D186), choosePokemon,
    choosePokemonMulti, moveEnergy, discardEnergy, chooseCards, attachCards,
    chooseAttack.

    🛑 **D543 — AND THAT NINE WAS ITSELF ALREADY STALE BEFORE THIS SLICE TOUCHED
    ANYTHING, WHICH IS SAID OUT LOUD RATHER THAN LAUNDERED INTO D543's DIFF.**
    Measured at D543's base head (`4ab68194`) by reading
    `redactedEffectPromptSchema.options.length` — not by counting the list above —
    it was **TEN**: the nine enumerated plus `orderCards` (D341), which joined the
    union and never reached this paragraph. **D543 steps it to ELEVEN** with
    `discardTools`. The list, re-read off `.options` in schema order: mayDraw,
    confirm, orderCards, choosePokemon, choosePokemonMulti, moveEnergy,
    discardEnergy, 🆕 discardTools, chooseCards, attachCards, chooseAttack.
    🆕🆕🆕 **D548 steps it to TWELVE** with `choosePrize` — MEASURED, not counted:
    `redactedEffectPromptSchema.options.length` read at D548's head is **12**, and the
    list off `.options` ends `…, chooseAttack, choosePrize`.
    🆕🆕🆕 **D577 steps it to THIRTEEN** with Tyme's `guessHp` (D539: the TWELVE above is
    withdrawn as the live count, kept as D548's measurement) — MEASURED:
    `redactedEffectPromptSchema.options.length` reads **13** at D577, the list off `.options`
    now `mayDraw, guessHp, confirm, …, chooseAttack, choosePrize`.
    ⚠️ **A PROSE COUNT OF A UNION IS A PIN NO RUNNER REPORTS** — which is the
    paragraph's own lesson ("an invariant asserted in a comment is checked by
    nothing, and reads exactly like one that is") arriving a second time at the
    very sentence that states it. The executable half already exists and is where
    the real count lives: `OnlineHud.chooseAttack.dom.test.tsx` reads
    `redactedEffectPromptSchema.options` LIVE and drives both directions.

    ✅ **THE GUARD LIVES WHERE THE DIALOGS ARE: `src/features/online/components/
    OnlineHud.tsx` (D201).** `EffectChooseDialog` is an exhaustive `switch` with a
    declared `ReactElement` return type and a `const unhandled: never = prompt`
    floor, so a TENTH kind that stops before it **fails the build**; two runtime
    pins back that up — a `Record` keyed by the prompt-kind union, and a table test
    that renders every kind read off `redactedEffectPromptSchema.options` and
    asserts the fixture map and the wire union hold the same kinds in BOTH
    directions. D186 gave the local router the same treatment.

    ⚠️ **AND IT IS DELEGATED RATHER THAN DUPLICATED, ON PURPOSE.** This module could
    import `redactedEffectPromptSchema` and count its `options` — but it knows
    nothing about dialogs. There is no React here, no `OnlineHud`, and no way to
    observe whether a kind renders, so any assertion written on this side would be
    over the schema alone and **could not go red for the reason that matters**. A
    guard that cannot fail is worse than no guard: it is a second confident sentence
    telling the next reader the property is held. (That is the same defect as the
    paragraph above, and the same one D200/D204/D205 hit three slices running in the
    engine.) What this module CAN enforce, it does, one declaration up:
    `MATCH_ACTION_DISPOSITION` ties this set to the engine's own `GameAction` union
    at compile time, and this set is derived from it rather than restated. */
export const SUPPORTED_MATCH_ACTIONS: ReadonlySet<string> = new Set(
  Object.entries(MATCH_ACTION_DISPOSITION)
    .filter(([, disposition]) => disposition === "supported")
    .map(([type]) => type),
);

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
export type MatchActionOutcome = { ok: true; record: MatchRecord } | { ok: false; reason: string };

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
