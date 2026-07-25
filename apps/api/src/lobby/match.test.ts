import { formatElapsed, logFromEvents, otherSeat, type Seat } from "@luminous/engine";
import type { Card, LobbySnapshot } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  matchSeatOf,
  type MatchRecord,
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

describe("applyMatchAction — the seat-bound apply loop", () => {
  const NAMES: Record<Seat, string> = { p1: "Ana", p2: "Bo" };
  const STARTED_AT = 1_000;

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
      record: { seed, startedAt: STARTED_AT, names: NAMES, state: created.state, log },
      winner: created.state.phase.coinWinner,
    };
  }

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

  it("rejects action types outside the driveable scope, and effect/ability/trainer plays off their phase (no soft-lock)", () => {
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
    // Rare Candy stays OFF (its own dialog + action are deferred, 3b GAP) — refused
    // BEFORE the engine sees it, so a crafted rareCandy frame can't reach an
    // un-drivable phase.
    expect(SUPPORTED_MATCH_ACTIONS.has("rareCandy")).toBe(false);
    expect(applyMatchAction(record, winner, { type: "rareCandy", seat: winner }, STARTED_AT).ok).toBe(
      false,
    );
    // The setup + drag + pass + attack/KO + retreat + effect-answer + ability/
    // trainer actions the client actually sends ARE supported (3b added useAbility;
    // playTrainer was already on for the Stadium drag and now the Item/Supporter
    // buttons too).
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
      "endTurn",
    ]) {
      expect(SUPPORTED_MATCH_ACTIONS.has(type)).toBe(true);
    }
  });
});
