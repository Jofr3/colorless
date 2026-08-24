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
    quietly gone. **A KEY THE WRITER NEVER WROTE IS NOT A KEY WITH A DEFAULT.** */
export const MATCH_RECORD_VERSION = 26;

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
} as const satisfies Record<GameAction["type"], "supported" | "withheld">;

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
    is **NINE** kinds, not seven or eight: mayDraw, `confirm` (D186), choosePokemon,
    choosePokemonMulti, moveEnergy, discardEnergy, chooseCards, attachCards,
    chooseAttack.

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
