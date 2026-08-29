import { formatElapsed, logFromEvents, otherSeat, type Seat } from "@luminous/engine";
import { type Card, type LobbySnapshot, redactedPhaseSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  MATCH_RECORD_VERSION,
  MATCH_ACTION_DISPOSITION,
  matchSeatOf,
  type MatchRecord,
  readMatchRecord,
  SEAT_OF_SLOT,
  startMatch,
  SUPPORTED_MATCH_ACTIONS,
} from "./match";

// P4 — the lobby → engine handoff. `startMatch` is a pure wrapper over the P3
// engine's `createGame`, so this also proves the engine imports and runs inside the
// API/Worker package (the first cross-package integration).

/** A minimal valid Basic Pokémon — the one card the synthetic decks below are made
    of, so `createGame`'s "60 cards + at least one Basic" check passes. */
function basicCard(id: string): Card {
  return {
    id,
    setId: "test",
    localId: "1",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: 60,
    stage: "Basic",
    evolveFrom: null,
    types: ["Colorless"],
    retreat: 1,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

const DECK = Array.from({ length: 60 }, () => "basic");
const POOL = { basic: basicCard("basic") };

describe("startMatch — the lobby → engine handoff", () => {
  it("maps host→p1 / guest→p2 into a game paused at the first-player choice", () => {
    const result = startMatch({ seed: 1, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    // Both decks became 60-card p1#/p2# stacks; the engine paused at setup.
    expect(result.state.phase.kind).toBe("setup:chooseFirst");
    expect(result.state.players.p1.deck).toHaveLength(60 - result.state.players.p1.hand.length);
    // The seat mapping this module owns.
    expect(SEAT_OF_SLOT).toEqual({ host: "p1", guest: "p2" });
  });

  it("is deterministic — the same seed reproduces the same coin winner", () => {
    const a = startMatch({ seed: 7, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    const b = startMatch({ seed: 7, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("expected both to create");
    if (a.state.phase.kind !== "setup:chooseFirst" || b.state.phase.kind !== "setup:chooseFirst") {
      throw new Error("expected setup:chooseFirst");
    }
    expect(a.state.phase.coinWinner).toBe(b.state.phase.coinWinner);
  });

  it("surfaces the engine's rejection of an illegal deck (not 60 cards)", () => {
    const result = startMatch({ seed: 1, hostDeck: ["basic"], guestDeck: DECK, cardPool: POOL });
    expect(result.ok).toBe(false);
  });
});

describe("matchSeatOf — which redacted view a socket receives", () => {
  const player = (id: string): LobbySnapshot["host"] => ({
    id,
    name: id,
    deckId: null,
    deckName: null,
    ready: true,
    connected: true,
    avatarSeed: null,
    forfeitAt: null,
  });
  const snapshot: LobbySnapshot = {
    code: "ABCD",
    phase: "in-game",
    host: player("h"),
    guest: player("g"),
    countdownStartedAt: null,
  };

  it("maps the host's socket to p1 and the guest's to p2", () => {
    expect(matchSeatOf(snapshot, "h")).toBe("p1");
    expect(matchSeatOf(snapshot, "g")).toBe("p2");
  });

  it("returns null for a player not seated in the lobby", () => {
    expect(matchSeatOf(snapshot, "stranger")).toBeNull();
    expect(matchSeatOf({ ...snapshot, guest: null }, "g")).toBeNull();
  });
});

const NAMES: Record<Seat, string> = { p1: "Ana", p2: "Bo" };
const STARTED_AT = 1_000;

/** A freshly created match persisted the way `handoffToMatch` writes it — the
    CURRENT `MATCH_RECORD_VERSION` included, so the storage-shape suite below
    reads exactly what this build would have written. */
function freshRecord(seed = 1): { record: MatchRecord; winner: "p1" | "p2" } {
  const created = startMatch({ seed, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
  if (!created.ok) throw new Error(created.error.message);
  if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
  const log = logFromEvents(created.events, {
    names: NAMES,
    state: created.state,
    elapsed: formatElapsed(0),
  });
  return {
    record: {
      version: MATCH_RECORD_VERSION,
      seed,
      startedAt: STARTED_AT,
      names: NAMES,
      state: created.state,
      log,
    },
    winner: created.state.phase.coinWinner,
  };
}

/** The `turn:action` arm of the wire phase union, read off the SCHEMA rather than
    restated (D209) — a restated shape is the thing that drifts. Its keys are what
    the server offers the acting client to press: `attacks`, `abilities`,
    `trainers`, `rareCandy` and — since D210 — `stadiumAbility`, the shared
    Stadium's §7.3 activation. */
function turnActionWireShape(): Record<string, unknown> {
  const arm = redactedPhaseSchema.options.find((option) => option.shape.kind.value === "turn:action");
  if (arm === undefined) throw new Error("the wire phase union has no turn:action arm");
  return arm.shape;
}

describe("applyMatchAction — the seat-bound apply loop", () => {
  it("applies a legal action and carries the seed over", () => {
    const { record, winner } = freshRecord();
    const next = applyMatchAction(
      record,
      winner,
      { type: "chooseFirstPlayer", seat: winner, first: winner },
      STARTED_AT + 7_000,
    );
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error("expected accept");
    expect(next.record.seed).toBe(1);
    // The coin winner's choice advanced setup off chooseFirst.
    expect(next.record.state.phase.kind).not.toBe("setup:chooseFirst");
  });

  it("appends the accepted events to the log, stamped from `now` (2b-iii-d-ii)", () => {
    const { record, winner } = freshRecord();
    const before = record.log.length;
    const next = applyMatchAction(
      record,
      winner,
      { type: "chooseFirstPlayer", seat: winner, first: winner },
      STARTED_AT + 65_000,
    );
    if (!next.ok) throw new Error("expected accept");
    // The seed log rode along, and the FIRST_PLAYER_CHOSEN event added at least
    // one more row — the previous rows are untouched (append-only).
    expect(next.record.log.length).toBeGreaterThan(before);
    expect(next.record.log.slice(0, before)).toEqual(record.log);
    // Elapsed is `now - startedAt` = 65s → "+01:05", on the new rows.
    const added = next.record.log.slice(before);
    for (const row of added) {
      if (row.kind === "action") expect(row.elapsed).toBe("+01:05");
    }
    // startedAt/names carry over unchanged.
    expect(next.record.startedAt).toBe(STARTED_AT);
    expect(next.record.names).toEqual(NAMES);
    // And the VERSION carries over: the applied record is written straight back
    // to storage, so if apply ever dropped it, the very next read would judge the
    // record stale and RETIRE A LIVE MATCH after its first action.
    expect(next.record.version).toBe(MATCH_RECORD_VERSION);
    expect(readMatchRecord(next.record)).not.toBeNull();
  });

  it("leaves the log untouched on a rejected action", () => {
    const { record, winner } = freshRecord();
    const rejected = applyMatchAction(
      record,
      winner,
      { type: "endTurn", seat: winner },
      STARTED_AT + 3_000,
    );
    expect(rejected.ok).toBe(false);
    // A reject returns no record — the DO keeps the old one, log and all.
  });

  it("BINDS to the actor's seat — a forged action.seat cannot act as the opponent", () => {
    const { record, winner } = freshRecord();
    const loser = otherSeat(winner);
    // The loser's socket claims the WINNER's seat in the payload. The bind
    // overrides it with the socket's own seat, so the engine sees the loser
    // trying to choose first (only the coin winner may) and rejects.
    const forged = applyMatchAction(
      record,
      loser,
      { type: "chooseFirstPlayer", seat: winner, first: winner },
      STARTED_AT,
    );
    expect(forged.ok).toBe(false);
  });

  it("rejects with a reason on an illegal action (nothing changes)", () => {
    const { record, winner } = freshRecord();
    // endTurn is illegal during setup — the engine refuses it, and the reason
    // (its own message) rides back for the pill.
    const illegal = applyMatchAction(record, winner, { type: "endTurn", seat: winner }, STARTED_AT);
    expect(illegal.ok).toBe(false);
    if (illegal.ok) throw new Error("expected reject");
    expect(illegal.reason.length).toBeGreaterThan(0);
    // A bogus action type is refused too (the total applyAction contract).
    expect(applyMatchAction(record, winner, { type: "not-an-action" }, STARTED_AT).ok).toBe(false);
  });

  it("rejects action types outside the driveable scope, and effect/ability/trainer/candy plays off their phase (no soft-lock)", () => {
    const { record, winner } = freshRecord();
    // useAbility is ON the set (3b landed its HUD), but — like attack/resolveEffect
    // — a crafted frame off its phase is rejected by the ENGINE's own validation
    // (turnGate fails during setup here), so it changes nothing and cannot
    // soft-lock. That engine gate is what makes admitting a parking play safe.
    expect(SUPPORTED_MATCH_ACTIONS.has("useAbility")).toBe(true);
    expect(
      applyMatchAction(
        record,
        winner,
        { type: "useAbility", seat: winner, target: { spot: "active" }, abilityName: "X" },
        STARTED_AT,
      ).ok,
    ).toBe(false);
    // resolveEffect is ON the set (2b-iii-c), same soft-lock-safety: a crafted frame
    // off an effect:choose park is rejected by the engine's own validation.
    expect(SUPPORTED_MATCH_ACTIONS.has("resolveEffect")).toBe(true);
    expect(
      applyMatchAction(record, winner, { type: "resolveEffect", seat: winner }, STARTED_AT).ok,
    ).toBe(false);
    // rareCandy is ON the set from 3b-ii (its two-step dialog landed) — and is
    // soft-lock-safe the same way: a crafted frame off a turn:action is rejected by
    // the engine's own turnGate (setup here), changing nothing. Its remaining wire
    // values (the target, both hand uids, the Basic + chain link) are re-validated
    // by the handler, so a bogus one rejects rather than crashing.
    expect(SUPPORTED_MATCH_ACTIONS.has("rareCandy")).toBe(true);
    expect(
      applyMatchAction(
        record,
        winner,
        {
          type: "rareCandy",
          seat: winner,
          uid: "no-such-uid",
          target: { spot: "active" },
          evolutionUid: "no-such-uid-either",
        },
        STARTED_AT,
      ).ok,
    ).toBe(false);
    // A structurally BOGUS rareCandy (no uid/target at all) is refused too, not
    // thrown on — the D14 totality the allowlist relies on.
    expect(
      applyMatchAction(record, winner, { type: "rareCandy", seat: winner }, STARTED_AT).ok,
    ).toBe(false);
    // The setup + drag + pass + attack/KO + retreat + effect-answer + ability/
    // trainer actions the client actually sends ARE supported (3b added useAbility;
    // playTrainer was already on for the Stadium drag and now the Item/Supporter
    // buttons too; 3b-ii added rareCandy).
    for (const type of [
      "chooseFirstPlayer",
      "setupPlaceActive",
      "attachEnergy",
      "attack",
      "takePrizes",
      "promote",
      "retreat",
      "resolveEffect",
      "useAbility",
      "playTrainer",
      "rareCandy",
      "endTurn",
    ]) {
      expect(SUPPORTED_MATCH_ACTIONS.has(type)).toBe(true);
    }
  });

  // D203 — the allowlist USED to be a hand-written literal beside a comment
  // asserting an invariant nothing checked (see the doc block). It is now
  // DERIVED from `MATCH_ACTION_DISPOSITION`, whose `satisfies
  // Record<GameAction["type"], …>` is the real guard: a new engine action is a
  // missing key and fails `tsc`, which no test here can reproduce. These pin
  // what the type cannot — that the derivation is faithful and that the one
  // withheld entry is genuinely refused at the door.
  it("is DERIVED from the disposition table — supported in, withheld out", () => {
    // Widened to the DECLARED value union rather than the literal one D210's flip
    // narrowed it to: with every entry "supported", `d === "withheld"` is a
    // no-overlap type error, and silently deleting the withheld half of this test
    // to appease tsc is exactly how a partition check stops checking a partition.
    const entries = Object.entries(MATCH_ACTION_DISPOSITION) as [
      string,
      "supported" | "withheld",
    ][];
    const supported = entries
      .filter(([, disposition]) => disposition === "supported")
      .map(([type]) => type);
    const withheld = entries
      .filter(([, disposition]) => disposition === "withheld")
      .map(([type]) => type);
    expect([...SUPPORTED_MATCH_ACTIONS].sort()).toEqual([...supported].sort());
    // The table covers the WHOLE engine union, so the two halves partition it.
    expect(supported.length + withheld.length).toBe(Object.keys(MATCH_ACTION_DISPOSITION).length);
    // D210 — the ONE withheld entry (the D102 Stadium ability, deferred for want
    // of a surface) is gone: the surface landed, so the table is all-supported.
    // Goes RED the moment anything is withheld again WITHOUT this line being
    // rewritten to name it and say why — which is the point, because the last
    // time an entry sat here, its stated reason rotted unnoticed from D102 to D209.
    expect(withheld).toEqual([]);
    expect(supported).toContain("useStadiumAbility");
  });

  // D209 wrote this as *withheld ⟺ no offer on the wire*; D210 landed the offer,
  // the button and the flip together, so it now reads *supported ⟺ an offer on
  // the wire* — THE SAME BICONDITIONAL, a different value. It is deliberately
  // NOT rewritten as two separate `toBe(true)` assertions: the coupling is the
  // guard. A target-less Stadium activation needs a server-computed offer
  // (`allowances.stadiumAbilityUsed` + `programPlayable` are state the client
  // never sees), exactly as `abilities`/`trainers` do, so the allowlist entry and
  // the wire field are one fact stated twice. Drop the wire field and leave the
  // table supported (D157's mistake — an action no client can drive) and this is
  // RED; withdraw the table entry with the field still there and it is RED the
  // other way. The second link — wire ⟺ a control in the online client — is
  // asserted where that client can be seen (`src/features/online/components/
  // OnlineHud.stadiumAbility.test.ts`), the D203 rule that a guard lives where it
  // can fail.
  it("supports `useStadiumAbility` EXACTLY while the wire offers a Stadium activation", () => {
    const shape = turnActionWireShape();
    // Positive control FIRST — a shape reader that silently returns {} agrees
    // with everything (the vacuous guard D200/D204/D205 shipped three times).
    // Rename or drop any offer and this goes red instead.
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["attacks", "abilities", "trainers", "rareCandy"]),
    );
    // …and a key that genuinely is not there reads false, so `in` discriminates
    // rather than agreeing with everything.
    expect("noSuchOffer" in shape).toBe(false);
    expect(SUPPORTED_MATCH_ACTIONS.has("useStadiumAbility")).toBe("stadiumAbility" in shape);
  });

  it("REFUSES an off-allowlist action at the door, before the engine sees it", () => {
    const { record, winner } = freshRecord();
    for (const [type, disposition] of Object.entries(MATCH_ACTION_DISPOSITION)) {
      expect(SUPPORTED_MATCH_ACTIONS.has(type)).toBe(disposition === "supported");
    }
    // D210 emptied the withheld column, so the door gate is exercised with a type
    // the engine union does not carry at all — which is the case that actually
    // matters (a crafted frame), and the one that kept this test meaningful when
    // its old subject became supported. The gate's own GENERIC reason is what
    // distinguishes "off the allowlist" from "the engine said no": swap the
    // `SUPPORTED_MATCH_ACTIONS.has` guard for a bare `applyAction` call and the
    // reason below becomes an engine message, turning this red.
    const refused = applyMatchAction(
      record,
      winner,
      { type: "noSuchActionType", seat: winner },
      STARTED_AT,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected reject");
    expect(refused.reason).toBe("That move isn't available here.");
    // And the CONTRAST that makes the line above discriminate: a type that IS on
    // the allowlist but illegal right now (setup:chooseFirst is not a turn:action)
    // is refused by the ENGINE, with the engine's own message — not this one.
    const engineRefused = applyMatchAction(
      record,
      winner,
      { type: "useStadiumAbility", seat: winner },
      STARTED_AT,
    );
    expect(engineRefused.ok).toBe(false);
    if (engineRefused.ok) throw new Error("expected reject");
    expect(engineRefused.reason).not.toBe("That move isn't available here.");
  });
});

// The DO has no storage migrations (online.md), so `readMatchRecord` IS the
// migration story: a record the running build can't trust is refused here, and
// the DO retires it (drops it, resets the lobby out of in-game, tells both
// players) instead of reading fields that aren't there.
describe("readMatchRecord — the persisted-shape gate", () => {
  it("accepts a record this build just wrote", () => {
    const { record } = freshRecord();
    // Round-tripped through JSON the way DO storage stores it.
    expect(readMatchRecord(JSON.parse(JSON.stringify(record)))).not.toBeNull();
  });

  it("REFUSES the pre-2b-iii-d-ii shape — the exact record that used to crash", () => {
    // `{seed, state}` is what increments 1b–2b-iii-d-i persisted. Read by THIS
    // build it would stamp NaN elapsed, throw on `names[seat]` for a system log
    // row, and broadcast `log: undefined` into a client render throw (the LOW
    // D68 recorded). It is refused before any of that can happen.
    const { record } = freshRecord();
    expect(readMatchRecord({ seed: record.seed, state: record.state })).toBeNull();
  });

  it("refuses a version this build doesn't write (older AND newer)", () => {
    const { record } = freshRecord();
    // ⚠️ THE ABSOLUTE VALUE IS PINNED HERE, not just the relative refusals. A bump
    // is a deliberate act with a live cost (every open match is retired and the
    // players re-ready), so it must never happen as a side effect of an edit.
    // 1 → 2 was D124's required `promotedTurn`; 2 → 3 is D140's required
    // `damageChosen.source`, which is persisted because that op PARKS — the
    // contrast with D139, which added the same field to an op that does not.
    // 3 → 4 is D142's required `InPlayPokemon.attackBlock`, and it is D124's case
    // rather than D140's: no op moved at all, but every Pokémon in play in an old
    // record lacks the field — a MISSING REQUIRED FIELD that would read back
    // benignly (`undefined.turn` is never `state.turn`), which is precisely the
    // soft landing this constant exists to refuse. 4 → 5 is D143's required
    // `InPlayPokemon.attackLockedTurn` — THE SAME CASE AGAIN, on a second stamped
    // field, and the repetition is what makes it worth pinning: two consecutive
    // slices have each added one required turn stamp to the same interface, each
    // would have read back plausibly, and each bumped. 5 → 6 is D147's required
    // `InPlayPokemon.damageReduction` — THE SAME CASE A THIRD TIME, and the slice
    // that finally answered the question the repetition raised. It weighed folding
    // the three stamps into ONE installed-effects value and DECLINED: the saving is
    // ~3 lines at the §10 clear sites plus a bump this slice pays either way, and
    // the cost is permanent (a union turns a field the compiler checks into a
    // search it cannot). The read path the third reading was predicted to SHARE
    // turned out not to be shared — the four damage sites ask two independent
    // questions at two different steps of §8.5. See D147. 6 → 7 is D149's required
    // `InPlayPokemon.attackDamageDebuff` — THE SAME CASE A FOURTH TIME, and worth
    // recording because the slice in between (D148) did NOT bump: it reused
    // `attackLockedTurn` and moved no persisted state key at all. So the trigger is
    // not "a durated slice landed" but literally "a required key appeared on
    // `InPlayPokemon`", and D148 is the control that shows the difference. D149 is
    // also the FOURTH stamped field, which per D147's own written trigger is NOT
    // grounds to re-open the generalisation (the fifth is). See D149.
    //
    // 7 → 8 is D152's required `InPlayPokemon.installedRecoil` — THE SAME CASE A
    // FIFTH TIME, with D151 as a SECOND control in between (its always-on aura put
    // its flag on the CATALOG and moved no state key, so it did not bump). D152 is
    // the FIFTH stamped field, so D147's own count trigger FIRES — and the
    // generalisation was re-derived rather than cited and DECLINED again, on a
    // ground that retires counting: three of the five fields are SOURCES feeding an
    // aggregate whose other source is the catalog, so their read sites ADD a term
    // rather than look an effect up, and a union would group by where the datum is
    // STORED — the one axis no read site asks about. What earns it is a member the
    // read site must DISPATCH on. See D152.
    //
    // 8 → 9 is D154's required `InPlayPokemon.lockedAttack` — THE SAME CASE A
    // SIXTH TIME, and the SHAPE trigger D152 forecast: the record is
    // `{ turn, attackIndex }`, so the read is a COMPARISON rather than a sum. It
    // was re-derived and DECLINED again, on a ground that refines the trigger
    // rather than retiring it — no read site DISPATCHES, because every reader in
    // this family knows which rider it wants before it looks, so a union would
    // swap a checked field access for a `find` over members the caller discards.
    // What earns it is an ENUMERATING caller. Note D153 in between did NOT bump
    // (an event field, and `GameEvent` is not persisted at all), which is a THIRD
    // control beside D148 and D151 for "a required key appeared on
    // `InPlayPokemon`" being the literal trigger. See D154.
    //
    // 9 → 10 is D155's required `InPlayPokemon.boostedAttack` — THE SAME CASE A
    // SEVENTH TIME, and the first time the trigger fires on two CONSECUTIVE
    // slices. Its record is `{ turn, attackIndex, amount }`, i.e. D154's with one
    // key added, so D131's widen-don't-add test passes on the SHAPE for the first
    // time in this family and the two are STILL separate fields — refused on what
    // the readers do, not on what the record looks like: `lockedAttackIndexes`'s
    // consumer REFUSES the index it returns and this one PAYS it. See D155.
    //
    // 10 → 11 is D165's `InPlayPokemon.lockedAttack: LockedAttack | null` becoming
    // `lockedAttacks: LockedAttack[]` — THE SAME CASE AN EIGHTH TIME, and the FIRST
    // that is a CHANGED TYPE rather than a NEW KEY, which is where the rule's own
    // wording earns its keep: the test has never been "did a key appear" but **"can
    // the PREVIOUS deploy's RECORD hold the new TYPE"**, and a version-10 record
    // carries `lockedAttack` on every body and no `lockedAttacks` at all. A REVIEW
    // FIX rather than a slice: the field had ONE reader and TWO writers
    // (`preventAttackUse` at `+ 2`, `lockDefenderAttack` at `+ 1`), the stamps
    // collide from adjacent turns, and the single slot deleted a live bar. It is
    // also the ENUMERATING caller D154 named as the union's earning condition,
    // arriving as a MULTIPLICITY rather than as a union — and the `attackBlock`
    // union is still declined. Note D156–D164 in between did NOT bump (nine
    // consecutive controls). See D165.
    //
    // 11 → 12 is D189's required `uid` on the `attackEpilogue` `PendingStage` —
    // and it is the FIRST of the twelve that is NOT an `InPlayPokemon` field.
    // Eight of the nine before it fired on that one trigger; this one lands on
    // `GameState.pending`, and the rule ("can the PREVIOUS deploy's RECORD hold
    // the new TYPE") reads it without being stretched: a version-11 record saved
    // mid-attack — the effect program parked, which is when that stage exists —
    // carries `{ kind, seat }` and no `uid`, which the new type requires. The
    // soft landing was REFUSED for the tenth time and for a reason specific to
    // this field: an optional `uid` reads back as "fall back to the Active",
    // which is exactly the defect the field exists to fix. Note D166–D188 in
    // between did NOT bump (twenty-three consecutive controls, including D181,
    // which derived four new ops onto the attack seam and correctly stayed at 11
    // because a REACHABILITY widening is not a shape change). See D189.
    //
    // 12 → 13 is D239's `AttackBlock.fromClass` going from the string literal
    // `"Basic"` to an `AttackerClass` RECORD, and it is the CHANGED-TYPE case a
    // SECOND time — but its real interest is that the SAME FIELD produced a
    // no-bump at D146 and a bump here. D146 ADDED the optional key, so
    // `{ turn, effects }` stayed a valid inhabitant; D239 retypes it, and a
    // persisted `"Basic"` is not an inhabitant at all. It would not even read back
    // benignly: the predicate now asks `cls.stage`, `undefined` on the old string,
    // so an older block would silently stop matching EVERY attacker and protect
    // nothing — the widening direction that family's rules forbid. Reachable
    // rather than moot, unlike D146's own half: three legal printings of the
    // string-valued sentence have been derivable since 0.95.0, so a live record
    // can carry the old shape. Note D190–D238 in between did NOT bump (forty-nine
    // consecutive controls, including D238, which widened a `CardFilter` union and
    // correctly stayed at 12 because ADDING an inhabitant leaves every older
    // record still describable). See D239.
    //
    // 13 → 14 is D271's `GameState.lastKoTurn` — the FIRST new REQUIRED field on
    // `GameState` itself, and the fourth reading of D124's shape (`promotedTurn`),
    // D142's (`attackBlock`) and D143's (`attackLockedTurn`). It is the first of
    // the four that does NOT read back benignly: those three defaulted to a
    // plausible "nothing happened" and were refused anyway, while this one is
    // INDEXED (`state.lastKoTurn[seat]`) before it is compared, so a version-13
    // state resumed under this deploy throws the moment a player reaches for
    // Unfair Stamp `sv06-165` or Hassel `sv06-151`/`-205`. A retired match beats a
    // crashed DO. The bump was DRIVEN and not argued —
    // `packages/engine/src/lastTurnKo.test.ts` rebuilds the version-13 shape by
    // deleting the key off a real post-Knock-Out state and replays the play. Note
    // D240–D270 in between did NOT bump (thirty-one consecutive controls,
    // including D270, which widened a `HandRefreshDraw` union and correctly stayed
    // at 13 for D238's reason).
    //
    // 🆕 14 → 15 is D283's `GameState.handPlayLockedTurn` — the SECOND new
    // REQUIRED field on `GameState` itself, and the SECOND of five that does NOT
    // read back benignly. `handPlayBarred` INDEXES TWICE
    // (`state.handPlayLockedTurn[seat][klass]`), so a version-14 state resumed
    // under this deploy throws on the FIRST Item or Supporter either player
    // reaches for — which is the first two turns of a real game, not D271's rare
    // line. DRIVEN in `packages/engine/src/screamTail.test.ts` §6, which deletes
    // the key off a real post-attack state and replays the play both ways. Note
    // D272–D282 in between did NOT bump (eleven consecutive controls, the longest
    // no-bump run this constant has had, including D282, which added a union
    // member AND a text-splitting reader and correctly stayed at 14).
    //
    // 🆕 🛑 16 → 17 is `GameState.oncePerGameSpent`, THE PER-GAME LATCH BEHIND
    // Legacy Energy `sv06-167` / Lillie's Pearl `sv09-151` — **and the field
    // landed at D298 while this constant did not.** D299 paid it. It is D283's
    // shape, not D285's: `onKoPrize` (flow.ts) reads
    // `next.oncePerGameSpent[ref.seat]` and INDEXES TWICE, unconditionally, so a
    // version-16 record resumed under a D298+ deploy throws
    // `TypeError: Cannot read properties of undefined` on the first Knock Out
    // that reaches a prize-reduction entry at all. DRIVEN in
    // `packages/engine/src/returnBenched.test.ts` §5, which deletes the key off a
    // real board, shows the throw BY NAME, and round-trips the same board with the
    // key present. ⚠️ **AND THE MISS IS THE LESSON**: D298 DROVE the replay,
    // recorded the bump as done, and never edited this line — `precheck` cannot
    // see it (it ties `engineVersion` to `package.json`, and nothing ties this
    // constant to the `GameState` shape it gates), so the only guard is this test,
    // which asserts a LITERAL and therefore only goes red when someone changes the
    // constant — never when someone should have.
    //
    // 🆕 🛑 17 → 18 is D309's RENAME, and it is the FIRST bump on this list that
    // is not a new `GameState` field at all. `EffectOp`'s
    // `evolveFromDeck.ontoBench?: number` (D308) became `onto?: PokemonTarget`,
    // because the body-choice sentence Duosion `sv10.5b-038`/`-119` prints can be
    // answered with the ACTIVE and a bench index cannot say so. ⚠️ **THE OP RIDES
    // `phase.cont.pendingOp` AND `cont.rest` INTO THE RECORD**, so a v17 record
    // written by the D308 deploy (engine `0.214.0`) carries the OLD spelling and
    // this deploy reads it as `undefined` — falling back to `sourceRef` and
    // offering to evolve **the attacker instead of the benched body**. 🛑 THE
    // FAILURE IS SILENT, NOT A THROW, which is why every previous entry's *"no
    // older deploy can author the new value"* argument does not reach it: a rename
    // is the one change where the older deploy authors something this one
    // MISREADS. DRIVEN in `packages/engine/src/evolveBodyChoice.test.ts` §5, which
    // resumes a hand-built v17 continuation and shows the wrong body offered.
    // Note D300–D308 in between did NOT bump (nine consecutive controls, every one
    // of them a widening).
    // 🆕 D326 — 18 → **19**, and it is the SAME kind as D309's and D271's rather
    // than a new one: a REQUIRED key on `GameState` (`lastKoMarks`), which no v18
    // record carries and which is INDEXED before it is compared. D310–D325 in
    // between did not bump — sixteen consecutive controls, every one a widening.
    // 🆕 D335 — 19 → 20, the RENAME case (D309's one exception): `lookAtTopN`'s
    // persisted leftovers key `discardRest` became the three-valued `restTo`, and a
    // v19 record parking that op would resume with the clause silently gone.
    // 🆕🆕 D352 — 20 → 21, the RENAME case a SECOND time on the SAME AXIS one op
    // over: `attachFromTop`'s `discardRest` became `restTo: "discard" |
    // "shuffledBottom"` when Metang "Metal Maker" bought the leftovers
    // destination, and that op PARKS too — so a v20 record parking it would resume
    // with Tri Howl's printed discard silently gone. Two bumps, two ops, one field
    // name, and the second was NOT predicted by the pre-price that bought the
    // field: **a price that names a field has not thereby named what persists it.**
    // 🆕🆕 D359 — 21 → 22, the RENAME case a THIRD time, and the first on a PROMPT
    // rather than an op: `EffectPrompt.choosePokemon.declinable?: true` became
    // `upTo?: number` when the printed *"attach up to N"* gained its quantity. A
    // v21 record parking that prompt carries `declinable: true`, which this build
    // parses away and reads as `upTo === undefined` — MANDATORY — so a resumed
    // match would refuse a decline the player had already been offered.
    // 🛑 **AND THE DISCRIMINATOR IS THE ONE D358 DEMONSTRATED FROM THE OTHER
    // SIDE**: D358 ADDED that same field to that same prompt and correctly left
    // this constant alone, because a v20 record's MISSING key meant mandatory
    // before and after. One slice later the key is renamed and the constant must
    // move. A widening is free; a rename is not; they are one edit apart.
    expect(MATCH_RECORD_VERSION).toBe(29); // 🆕🆕 D435 — 28 -> 29, and for TWO independent reasons rather than one: `ScheduledCounters` became the discriminated union `ScheduledEffect`, which is (a) a new REQUIRED key `kind` on a persisted structure (D386's case, seventh time) and (b) a RENAME of the type, the `InPlayPokemon` field (`scheduledCounters` -> `scheduledEffect`) and the reader (`scheduledCountersDue` -> `scheduledEffectDue`), which is D359's case and this block's own discriminator: a widening is free, a rename is not. ⚠️ THE OPTIONAL ROAD WAS AVAILABLE HERE FOR THE FIRST TIME IN THE RUN — the record's rest (`{turn, amount}`) is genuinely OLD, so D434's sharpening does not refuse it — and it is refused anyway on D421's own criterion, because the loss degrades into `damage + undefined` = NaN and a body that can never be Knocked Out again, which is silent corruption rather than a soft landing. Driven in `delayedCounters.test.ts` §8. 🆕🆕 D434 — 27 -> 28: `InPlayPokemon.scheduledEffect`, a missing required field (the attack-scheduled §13 DELAYED counter placement). D432 took 26 -> 27 on the identical trigger and wrote that the optional road is unavailable "when the stored fact is a single number with nothing beside it"; THIS record has a turn AND an amount and the road is STILL unavailable, because D421's "rest of the record" means the rest a PREVIOUS DEPLOY ALREADY WROTE — both keys here arrive together and cannot witness each other's loss. The argument is written out at the constant itself.
    expect(readMatchRecord({ ...record, version: MATCH_RECORD_VERSION - 1 })).toBeNull();
    // Newer matters too: a rollback must not read a record from the deploy ahead
    // of it, which is exactly when the embedded GameState is likeliest to differ.
    expect(readMatchRecord({ ...record, version: MATCH_RECORD_VERSION + 1 })).toBeNull();
  });

  it("refuses a truncated or hand-edited record field by field", () => {
    const { record } = freshRecord();
    // Each of these is a field the DO reads directly and could throw on.
    expect(readMatchRecord({ ...record, log: undefined })).toBeNull();
    expect(readMatchRecord({ ...record, log: "not-an-array" })).toBeNull();
    expect(readMatchRecord({ ...record, state: null })).toBeNull();
    expect(readMatchRecord({ ...record, startedAt: "soon" })).toBeNull();
    expect(readMatchRecord({ ...record, names: { p1: "Ana" } })).toBeNull();
    expect(readMatchRecord({ ...record, names: null })).toBeNull();
  });

  it("refuses a non-object (absent, garbled, or a bare string)", () => {
    expect(readMatchRecord(undefined)).toBeNull();
    expect(readMatchRecord(null)).toBeNull();
    expect(readMatchRecord("match")).toBeNull();
    expect(readMatchRecord(42)).toBeNull();
  });

  it("does NOT re-validate the embedded engine state (same version = this build wrote it)", () => {
    // The version gate is what decides compatibility; the field checks only keep
    // the DO's own reads safe. A same-version record with a nonsense state still
    // reads back — deliberately, so this gate can't drift into a second, weaker
    // copy of the engine's own invariants.
    const { record } = freshRecord();
    expect(readMatchRecord({ ...record, state: { nonsense: true } })).not.toBeNull();
  });
});

// The seam the DO's abandonment forfeit rides (P4 3c-ii): the server applies the
// engine's own `concede` for a player who never came back, so a forfeited match
// ends exactly like any other — a real outcome, a log row, one broadcast.
describe("applyMatchAction — concede (the forfeit seam)", () => {
  it("ends the match for the vanished seat, handing the win to the opponent", () => {
    const { record, winner } = freshRecord();
    const absent = otherSeat(winner);
    const outcome = applyMatchAction(record, absent, { type: "concede" }, STARTED_AT + 90_000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected accept");
    expect(outcome.record.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner, reason: "conceded" },
    });
    // The log grew a row and the record stays readable — it goes back to storage.
    expect(outcome.record.log.length).toBeGreaterThan(record.log.length);
    expect(readMatchRecord(outcome.record)).not.toBeNull();
  });

  it("binds to the DO's seat, ignoring any seat in the payload", () => {
    // `forfeitAbandoned` passes `{type:"concede"}` with no seat at all, and a
    // crafted client frame could name the opponent's. Either way the bind wins,
    // so a player can only ever concede their OWN game.
    const { record, winner } = freshRecord();
    const forged = applyMatchAction(
      record,
      winner,
      { type: "concede", seat: otherSeat(winner) },
      STARTED_AT,
    );
    if (!forged.ok) throw new Error("expected accept");
    if (forged.record.state.phase.kind !== "gameOver") throw new Error("expected gameOver");
    // The winner conceded, so the OPPONENT won — not the seat the payload named.
    expect(forged.record.state.phase.outcome).toEqual({
      result: "win",
      winner: otherSeat(winner),
      reason: "conceded",
    });
  });

  it("is refused on an already-finished match, so a forfeit can't steal a win", () => {
    // The race `forfeitAbandoned` guards: a player abandons, but the opponent
    // wins outright before the timer fires. The engine refuses the late concede,
    // the DO writes nothing, and the real result stands.
    const { record, winner } = freshRecord();
    const over = applyMatchAction(record, winner, { type: "concede" }, STARTED_AT);
    if (!over.ok) throw new Error("expected accept");
    const late = applyMatchAction(over.record, otherSeat(winner), { type: "concede" }, STARTED_AT);
    expect(late.ok).toBe(false);
  });
});
