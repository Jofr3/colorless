import { describe, expect, it } from "vitest";
import type { RedactedGame, SeatLogEntry } from "../match";
import type { LobbySnapshot } from "./types";
import {
  lobbyClientMessageSchema,
  lobbyClientMessageSchemaMatchesType,
  lobbyClientMessagesAreLobbyMessages,
  lobbyIntentSchema,
  lobbyIntentSchemaMatchesType,
  lobbyMessageSchema,
  lobbyMessageSchemaMatchesType,
  lobbyServerMessageSchema,
  lobbyServerMessageSchemaMatchesType,
  lobbySnapshotSchema,
} from "./wire";

// The real assertions here are the compile-time `…MatchesType` proofs in
// wire.ts — if a schema drifts from its types.ts shape this file stops
// compiling. The runtime cases below pin the validation behavior the Durable
// Object depends on: what parses, what's refused, and that unknown keys are
// stripped rather than forwarded.

const SNAPSHOT: LobbySnapshot = {
  code: "ABCD",
  phase: "selecting",
  host: {
    id: "h1",
    name: "Ana",
    deckId: "d1",
    deckName: "Sparks",
    ready: false,
    connected: true,
    avatarSeed: null,
    forfeitAt: null,
  },
  guest: {
    id: "g1",
    name: "Bo",
    deckId: null,
    deckName: null,
    ready: false,
    connected: true,
    avatarSeed: null,
    forfeitAt: null,
  },
  countdownStartedAt: null,
};

/** A minimal but well-formed redacted match view — one own card in hand, the
    opponent's hand as a single anonymous back, empty boards. */
const MATCH_GAME: RedactedGame = {
  seat: "p1",
  turn: 1,
  phase: {
    kind: "turn:action",
    attacks: [],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
    stadiumAbility: null,
  },
  board: {
    stadium: null,
    you: {
      hand: [
        {
          id: "u1",
          cardId: "sv01-066",
          name: "Mareep",
          category: "Pokemon",
          trainerType: null,
          hasImage: true,
        },
      ],
      active: null,
      bench: [],
      prizesRemaining: 6,
      deckCount: 53,
      discard: [],
    },
    opponent: {
      hand: [
        {
          id: "opponent-hand-0",
          cardId: "hidden",
          name: "Face-down card",
          category: "Trainer",
          trainerType: null,
          hasImage: false,
        },
      ],
      active: null,
      bench: [],
      prizesRemaining: 6,
      deckCount: 53,
      discard: [],
    },
  },
  activePlayer: "you",
  waitingOn: "you",
  outcome: null,
};

/** A seat-keyed game log — one action row and a turn divider. */
const MATCH_LOG: SeatLogEntry[] = [
  { kind: "action", who: "p1", elapsed: "+00:00", segments: [{ text: "drew 7 cards" }] },
  { kind: "turn", turn: 1 },
  {
    kind: "action",
    who: "system",
    elapsed: "+00:05",
    segments: [{ text: "Coin flip: " }, { text: "heads", tone: "strong" }],
  },
];

describe("compile-time schema/type equality proofs", () => {
  it("hold (and double as documentation that they exist)", () => {
    expect(lobbyIntentSchemaMatchesType).toBe(true);
    expect(lobbyMessageSchemaMatchesType).toBe(true);
    expect(lobbyClientMessageSchemaMatchesType).toBe(true);
    expect(lobbyClientMessagesAreLobbyMessages).toBe(true);
    expect(lobbyServerMessageSchemaMatchesType).toBe(true);
  });
});

describe("lobbyIntentSchema", () => {
  it("accepts each intent variant", () => {
    expect(
      lobbyIntentSchema.parse({ type: "select-deck", deckId: "d1", deckName: "Sparks" }),
    ).toEqual({ type: "select-deck", deckId: "d1", deckName: "Sparks" });
    expect(lobbyIntentSchema.parse({ type: "set-ready", ready: true })).toEqual({
      type: "set-ready",
      ready: true,
    });
    expect(lobbyIntentSchema.parse({ type: "set-name", name: "Ana" })).toEqual({
      type: "set-name",
      name: "Ana",
    });
  });

  it("refuses unknown variants, missing fields and wrong types", () => {
    expect(lobbyIntentSchema.safeParse({ type: "start-match" }).success).toBe(false);
    expect(lobbyIntentSchema.safeParse({ type: "select-deck", deckId: "d1" }).success).toBe(false);
    expect(lobbyIntentSchema.safeParse({ type: "set-ready", ready: "yes" }).success).toBe(false);
  });
});

describe("lobbyClientMessageSchema (what the DO accepts)", () => {
  it("accepts hello / intent / kick / bye", () => {
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "hello", from: "g1", name: "Bo" }).success,
    ).toBe(true);
    expect(
      lobbyClientMessageSchema.safeParse({
        kind: "intent",
        from: "g1",
        intent: { type: "set-ready", ready: true },
      }).success,
    ).toBe(true);
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "reject", to: "g1", reason: "kicked" }).success,
    ).toBe(true);
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "bye", from: "g1", slot: "guest" }).success,
    ).toBe(true);
    // A rematch is a client → server LIFECYCLE frame (3c-vi): the server decides
    // whether the match it holds has actually finished.
    expect(lobbyClientMessageSchema.safeParse({ kind: "rematch", from: "g1" }).success).toBe(true);
    expect(
      lobbyClientMessageSchema.safeParse({
        kind: "action",
        action: { type: "endTurn", seat: "p1" },
      }).success,
    ).toBe(true);
  });

  it("preserves an action's fields (looseObject) so the engine can read uid/target", () => {
    // The DO hands frame.action to the engine's total applyAction; stripping
    // unknown keys would drop the action's payload, so wireActionSchema keeps them.
    const parsed = lobbyClientMessageSchema.parse({
      kind: "action",
      action: { type: "attachEnergy", seat: "p1", uid: "e7", target: { spot: "active" } },
    });
    expect(parsed).toEqual({
      kind: "action",
      action: { type: "attachEnergy", seat: "p1", uid: "e7", target: { spot: "active" } },
    });
  });

  it("refuses an action frame with no string type", () => {
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "action", action: { seat: "p1" } }).success,
    ).toBe(false);
  });

  it("refuses server-only and fabricated frames", () => {
    // state is the server's to send, never the client's.
    expect(lobbyClientMessageSchema.safeParse({ kind: "state", snapshot: SNAPSHOT }).success).toBe(
      false,
    );
    // a client can kick (the host's frame) but can never mint a "full".
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "reject", to: "g1", reason: "full" }).success,
    ).toBe(false);
    // reject-action is the server's to send (the pill), never the client's.
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "reject-action", reason: "nope" }).success,
    ).toBe(false);
    // match-error is the server's to send (the failed-start notice), not the client's.
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "match-error", reason: "nope" }).success,
    ).toBe(false);
    // heartbeats are not client frames — keepalive is the raw ping string.
    expect(
      lobbyClientMessageSchema.safeParse({ kind: "heartbeat", from: "g1", slot: "guest" }).success,
    ).toBe(false);
    expect(lobbyClientMessageSchema.safeParse({ kind: "boom" }).success).toBe(false);
    expect(lobbyClientMessageSchema.safeParse("hello").success).toBe(false);
  });

  it("strips unknown keys instead of forwarding them", () => {
    const parsed = lobbyClientMessageSchema.parse({
      kind: "hello",
      from: "g1",
      name: "Bo",
      extra: "junk",
    });
    expect(parsed).toEqual({ kind: "hello", from: "g1", name: "Bo" });
  });
});

describe("lobbyServerMessageSchema (what clients receive)", () => {
  it("accepts state broadcasts, redacted match views and rejections", () => {
    expect(lobbyServerMessageSchema.safeParse({ kind: "state", snapshot: SNAPSHOT }).success).toBe(
      true,
    );
    expect(
      lobbyServerMessageSchema.safeParse({ kind: "match", game: MATCH_GAME, log: MATCH_LOG })
        .success,
    ).toBe(true);
    expect(
      lobbyServerMessageSchema.safeParse({ kind: "reject", to: "g1", reason: "full" }).success,
    ).toBe(true);
    // The transient action-rejection pill (P4) is a server frame.
    expect(
      lobbyServerMessageSchema.safeParse({ kind: "reject-action", reason: "Illegal move." })
        .success,
    ).toBe(true);
    // The match-start failure (P4 increment 3) is a server frame.
    expect(
      lobbyServerMessageSchema.safeParse({ kind: "match-error", reason: "Ana: deck not found." })
        .success,
    ).toBe(true);
  });

  it("round-trips a redacted match view + its game log unchanged", () => {
    expect(
      lobbyServerMessageSchema.parse({ kind: "match", game: MATCH_GAME, log: MATCH_LOG }),
    ).toEqual({ kind: "match", game: MATCH_GAME, log: MATCH_LOG });
  });

  it("refuses a match frame with no log (the field is required)", () => {
    expect(lobbyServerMessageSchema.safeParse({ kind: "match", game: MATCH_GAME }).success).toBe(
      false,
    );
  });

  it("refuses client-only frames", () => {
    expect(
      lobbyServerMessageSchema.safeParse({ kind: "hello", from: "g1", name: "Bo" }).success,
    ).toBe(false);
  });
});

describe("lobbySnapshotSchema", () => {
  it("round-trips a full snapshot", () => {
    expect(lobbySnapshotSchema.parse(SNAPSHOT)).toEqual(SNAPSHOT);
  });

  it("refuses an unknown phase", () => {
    expect(lobbySnapshotSchema.safeParse({ ...SNAPSHOT, phase: "paused" }).success).toBe(false);
  });
});

describe("lobbyMessageSchema (full channel vocabulary)", () => {
  it("accepts every message kind", () => {
    const messages = [
      { kind: "hello", from: "g1", name: "Bo" },
      { kind: "state", snapshot: SNAPSHOT },
      { kind: "match", game: MATCH_GAME, log: MATCH_LOG },
      { kind: "intent", from: "g1", intent: { type: "set-name", name: "Bo" } },
      { kind: "action", action: { type: "endTurn", seat: "p1" } },
      { kind: "reject", to: "g1", reason: "full" },
      { kind: "reject-action", reason: "Illegal move." },
      { kind: "match-error", reason: "Ana: deck not found." },
      { kind: "heartbeat", from: "h1", slot: "host" },
      { kind: "bye", from: "g1", slot: "guest" },
      { kind: "rematch", from: "g1" },
    ];
    for (const message of messages) {
      expect(lobbyMessageSchema.safeParse(message).success).toBe(true);
    }
  });
});
