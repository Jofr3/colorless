import { otherSeat } from "@luminous/engine";
import type { Card, LobbySnapshot } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  FIXED_MATCH_CARD_IDS,
  FIXED_MATCH_DECKS,
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
  function freshRecord(seed = 1): { record: MatchRecord; winner: "p1" | "p2" } {
    const created = startMatch({ seed, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    if (!created.ok) throw new Error(created.error.message);
    if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    return { record: { seed, state: created.state }, winner: created.state.phase.coinWinner };
  }

  it("applies a legal action and carries the seed over", () => {
    const { record, winner } = freshRecord();
    const next = applyMatchAction(record, winner, {
      type: "chooseFirstPlayer",
      seat: winner,
      first: winner,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error("expected accept");
    expect(next.record.seed).toBe(1);
    // The coin winner's choice advanced setup off chooseFirst.
    expect(next.record.state.phase.kind).not.toBe("setup:chooseFirst");
  });

  it("BINDS to the actor's seat — a forged action.seat cannot act as the opponent", () => {
    const { record, winner } = freshRecord();
    const loser = otherSeat(winner);
    // The loser's socket claims the WINNER's seat in the payload. The bind
    // overrides it with the socket's own seat, so the engine sees the loser
    // trying to choose first (only the coin winner may) and rejects.
    const forged = applyMatchAction(record, loser, {
      type: "chooseFirstPlayer",
      seat: winner,
      first: winner,
    });
    expect(forged.ok).toBe(false);
  });

  it("rejects with a reason on an illegal action (nothing changes)", () => {
    const { record, winner } = freshRecord();
    // endTurn is illegal during setup — the engine refuses it, and the reason
    // (its own message) rides back for the pill.
    const illegal = applyMatchAction(record, winner, { type: "endTurn", seat: winner });
    expect(illegal.ok).toBe(false);
    if (illegal.ok) throw new Error("expected reject");
    expect(illegal.reason.length).toBeGreaterThan(0);
    // A bogus action type is refused too (the total applyAction contract).
    expect(applyMatchAction(record, winner, { type: "not-an-action" }).ok).toBe(false);
  });

  it("rejects action types outside the driveable scope, and effect answers off a park (no soft-lock)", () => {
    const { record, winner } = freshRecord();
    // useAbility is still OFF the set (abilities land with real decks) — refused
    // BEFORE the engine even sees it, so the match can't reach an un-drivable phase.
    expect(SUPPORTED_MATCH_ACTIONS.has("useAbility")).toBe(false);
    expect(applyMatchAction(record, winner, { type: "useAbility", seat: winner }).ok).toBe(false);
    // resolveEffect is now ON the set (2b-iii-c dialoged every prompt kind), but a
    // crafted frame off an effect:choose park is rejected by the ENGINE's own
    // validation (BAD_PHASE during setup here) — so it changes nothing and cannot
    // soft-lock, exactly the soft-lock-safety the allowlist flip relied on.
    expect(SUPPORTED_MATCH_ACTIONS.has("resolveEffect")).toBe(true);
    expect(applyMatchAction(record, winner, { type: "resolveEffect", seat: winner }).ok).toBe(false);
    // The setup + drag + pass + attack/KO + retreat + effect-answer actions the
    // client actually sends ARE supported (2b-i grew the set with attack /
    // takePrizes / promote; 2b-ii added retreat; 2b-iii-c added resolveEffect).
    for (const type of [
      "chooseFirstPlayer",
      "setupPlaceActive",
      "attachEnergy",
      "attack",
      "takePrizes",
      "promote",
      "retreat",
      "resolveEffect",
      "endTurn",
    ]) {
      expect(SUPPORTED_MATCH_ACTIONS.has(type)).toBe(true);
    }
  });
});

describe("FIXED_MATCH_DECKS — the placeholder decks the DO hands off until real selection", () => {
  it("both seats are 60 cards drawn only from FIXED_MATCH_CARD_IDS, which are distinct", () => {
    const known = new Set(FIXED_MATCH_CARD_IDS);
    expect(known.size).toBe(FIXED_MATCH_CARD_IDS.length); // no dup in the pool list
    for (const deck of [FIXED_MATCH_DECKS.host, FIXED_MATCH_DECKS.guest]) {
      expect(deck).toHaveLength(60);
      for (const id of deck) expect(known.has(id)).toBe(true);
    }
    // Every pool id is actually referenced (no dead ids to resolve from D1).
    const used = new Set([...FIXED_MATCH_DECKS.host, ...FIXED_MATCH_DECKS.guest]);
    for (const id of FIXED_MATCH_CARD_IDS) expect(used.has(id)).toBe(true);
  });

  it("the seats differ, so redaction asymmetry (1c) is exercised on a real board", () => {
    expect(FIXED_MATCH_DECKS.host).not.toEqual(FIXED_MATCH_DECKS.guest);
  });

  it("boot a real game once their ids resolve to a pool (engine-valid: 60 + a Basic)", () => {
    // The DO builds this pool from D1; here every id maps to a Basic so the
    // engine's "60 cards, all resolvable, ≥1 Basic" check passes — proving the
    // deck sizes + pool coverage, not the runtime card types.
    const pool = Object.fromEntries(FIXED_MATCH_CARD_IDS.map((id) => [id, basicCard(id)]));
    const result = startMatch({
      seed: 3,
      hostDeck: FIXED_MATCH_DECKS.host,
      guestDeck: FIXED_MATCH_DECKS.guest,
      cardPool: pool,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.phase.kind).toBe("setup:chooseFirst");
  });
});
