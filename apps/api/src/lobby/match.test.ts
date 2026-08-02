import { formatElapsed, logFromEvents, otherSeat, type Seat } from "@luminous/engine";
import type { Card, LobbySnapshot } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  MATCH_RECORD_VERSION,
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
    expect(MATCH_RECORD_VERSION).toBe(3);
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
