import { formatElapsed, logFromEvents, otherSeat, redactGame, type Seat } from "@colorless/engine";
import { type Card, type LobbySnapshot, redactedPhaseSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { ALL_BASIC_DECK, driveSetup } from "@colorless/engine/testing";
import {
  applyMatchAction,
  beginMatch,
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  MATCH_ACTION_DISPOSITION,
  type MatchRecord,
  type MatchSlot,
  matchFrameFor,
  matchSeatOf,
  migrateMatchRecord,
  playerIdOfSeat,
  readMatchRecord,
  rematchChooser,
  SEAT_OF_SLOT,
  settleFirstPlayer,
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

describe("settleFirstPlayer — who sets the play order", () => {
  function created(seed: number) {
    const result = startMatch({ seed, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    if (!result.ok || result.state.phase.kind !== "setup:chooseFirst") throw new Error("no game");
    return { result, coinWinner: result.state.phase.coinWinner };
  }

  it("a first game has no choice: the coin winner goes first and setup moves on", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { result, coinWinner } = created(seed);
      const opening = settleFirstPlayer(result.state, result.events, null);
      expect(opening.state.firstPlayer).toBe(coinWinner);
      expect(opening.state.phase.kind).not.toBe("setup:chooseFirst");
      const types = opening.events.map((e) => e.type);
      expect(types).toContain("COIN_FLIP");
      expect(types).toContain("FIRST_PLAYER_CHOSEN");
    }
  });

  it("a rematch hands the choice to the previous loser and drops the coin row", () => {
    for (const chooser of ["p1", "p2"] as const) {
      const { result } = created(5);
      const opening = settleFirstPlayer(result.state, result.events, chooser);
      expect(opening.state.phase).toEqual({ kind: "setup:chooseFirst", coinWinner: chooser });
      expect(opening.state.firstPlayer).toBeNull();
      expect(opening.events.some((e) => e.type === "COIN_FLIP")).toBe(false);
    }
  });

  it("rematchChooser names the loser, and nobody after a tie", () => {
    const { result } = created(1);
    const over = (outcome: object) =>
      ({ ...result.state, phase: { kind: "gameOver", outcome } }) as typeof result.state;
    expect(rematchChooser(over({ result: "win", winner: "p1", reason: "prizes" }))).toBe("p2");
    expect(rematchChooser(over({ result: "win", winner: "p2", reason: "prizes" }))).toBe("p1");
    expect(
      rematchChooser(over({ result: "tie", reasons: { p1: "prizes", p2: "prizes" } })),
    ).toBeNull();
    expect(rematchChooser(result.state)).toBeNull();
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

  it("inverts through playerIdOfSeat, null for an empty guest seat", () => {
    expect(playerIdOfSeat(snapshot, "p1")).toBe("h");
    expect(playerIdOfSeat(snapshot, "p2")).toBe("g");
    expect(playerIdOfSeat({ ...snapshot, guest: null }, "p2")).toBeNull();
  });
});

const NAMES: Record<Seat, string> = { p1: "Ana", p2: "Bo" };
const OLDEST_MIGRATABLE = 41;
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

function turnActionWireShape(): Record<string, unknown> {
  const arm = redactedPhaseSchema.options.find(
    (option) => option.shape.kind.value === "turn:action",
  );
  if (arm === undefined) throw new Error("the wire phase union has no turn:action arm");
  return arm.shape;
}

describe("applyMatchAction — the seat-bound apply loop", () => {
  it("persists bench reordering and refuses a forged opponent move", () => {
    const { record: fresh } = freshRecord(3);
    const state = driveSetup(
      3,
      { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
      {
        first: "p1",
        bench: { p1: Array(5).fill("fix-basic-1") },
      },
    );
    const record = { ...fresh, state };
    const uid = state.players.p1.bench[0]?.stack.at(-1);
    if (uid === undefined) throw new Error("Expected a benched Pokémon");
    const action = { type: "reorderBench", seat: "p1", uid, index: 4 };
    const result = applyMatchAction(record, "p1", action, STARTED_AT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.record.state.players.p1.bench).toEqual([
      ...state.players.p1.bench.slice(1),
      state.players.p1.bench[0],
    ]);
    expect(result.record.log).toEqual(record.log);
    expect(readMatchRecord(result.record)?.state.players.p1.bench).toEqual(
      result.record.state.players.p1.bench,
    );
    expect(applyMatchAction(record, "p2", action, STARTED_AT).ok).toBe(false);
    expect(applyMatchAction(record, "p1", { type: "reorderBench" }, STARTED_AT).ok).toBe(false);
  });
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
    expect(
      applyMatchAction(record, winner, { type: "rareCandy", seat: winner }, STARTED_AT).ok,
    ).toBe(false);
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

  it("is DERIVED from the disposition table — supported in, withheld out", () => {
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
    expect(withheld).toEqual([]);
    expect(supported).toContain("useStadiumAbility");
  });

  it("supports `useStadiumAbility` EXACTLY while the wire offers a Stadium activation", () => {
    const shape = turnActionWireShape();
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["attacks", "abilities", "trainers", "rareCandy"]),
    );
    // …and a key that genuinely is not there reads false, so `in` discriminates
    // rather than agreeing with everything.
    expect("noSuchOffer" in shape).toBe(false);
    expect(SUPPORTED_MATCH_ACTIONS.has("useStadiumAbility")).toBe("stadiumAbility" in shape);
  });

  it("supports `discardFromPlay` EXACTLY while the wire offers the fossils' discard rows", () => {
    const shape = turnActionWireShape();
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["attacks", "abilities", "trainers"]),
    );
    expect(SUPPORTED_MATCH_ACTIONS.has("discardFromPlay")).toBe("discardable" in shape);
    expect(SUPPORTED_MATCH_ACTIONS.has("discardFromPlay")).toBe(true);
  });

  it("REFUSES an off-allowlist action at the door, before the engine sees it", () => {
    const { record, winner } = freshRecord();
    for (const [type, disposition] of Object.entries(MATCH_ACTION_DISPOSITION)) {
      expect(SUPPORTED_MATCH_ACTIONS.has(type)).toBe(disposition === "supported");
    }
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

describe("readMatchRecord — the persisted-shape gate", () => {
  it("accepts a record this build just wrote", () => {
    const { record } = freshRecord();
    // Round-tripped through JSON the way DO storage stores it.
    expect(readMatchRecord(JSON.parse(JSON.stringify(record)))).not.toBeNull();
  });

  it("REFUSES the pre-2b-iii-d-ii shape — the exact record that used to crash", () => {
    const { record } = freshRecord();
    expect(readMatchRecord({ seed: record.seed, state: record.state })).toBeNull();
  });

  it("refuses a version this build doesn't write (older AND newer)", () => {
    const { record } = freshRecord();
    expect(MATCH_RECORD_VERSION).toBe(50);
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

  it("checks the embedded engine state only at its top level", () => {
    const { record } = freshRecord();
    expect(readMatchRecord({ ...record, state: { nonsense: true } })).toBeNull();
    expect(readMatchRecord({ ...record, state: { ...record.state, phase: null } })).toBeNull();
    expect(readMatchRecord({ ...record, state: { ...record.state, players: "p1" } })).toBeNull();
    const shallow = { phase: { kind: "nonsense" }, players: {} };
    expect(readMatchRecord({ ...record, state: shallow })?.state).toBe(shallow);
  });

  it("refuses a log row that is not an object, and NaN timing", () => {
    const { record } = freshRecord();
    expect(readMatchRecord({ ...record, log: [...record.log, "row"] })).toBeNull();
    expect(readMatchRecord({ ...record, seed: Number.NaN })).toBeNull();
  });

  it("hands back the stored state and log rows as they were written", () => {
    const { record } = freshRecord();
    const read = readMatchRecord(record);
    expect(read).toEqual(record);
    expect(read?.state).toBe(record.state);
    expect(read?.log.every((row, i) => row === record.log[i])).toBe(true);
  });

  it("reads an unreadable current-version record as stale, and writes nothing", async () => {
    const { record } = freshRecord();
    const puts: MatchRecord[] = [];
    const slot: MatchSlot = {
      get: async () => ({ ...record, state: null }),
      put: async (written) => {
        puts.push(written);
      },
    };
    const load = await loadMatchRecord(slot, async () => {
      throw new Error("D1 asked");
    });
    expect(load).toEqual({ kind: "stale" });
    expect(puts).toEqual([]);
  });

  it("accepts what every writer produces: a migration from each migratable version", () => {
    const { record } = freshRecord();
    for (let version = OLDEST_MIGRATABLE; version < MATCH_RECORD_VERSION; version++) {
      const stored = JSON.parse(JSON.stringify({ ...record, version }));
      expect(readMatchRecord(stored)).toBeNull();
      const migrated = migrateMatchRecord(stored, {});
      expect(migrated?.version).toBe(MATCH_RECORD_VERSION);
      expect(readMatchRecord(JSON.parse(JSON.stringify(migrated)))).not.toBeNull();
    }
    expect(migrateMatchRecord({ ...record, version: OLDEST_MIGRATABLE - 1 }, {})).toBeNull();
    expect(
      migrateMatchRecord(
        {
          ...record,
          version: OLDEST_MIGRATABLE,
          state: { ...record.state, cardPool: null },
        },
        {},
      ),
    ).toBeNull();
  });
});

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

describe("beginMatch — the record a countdown's end persists", () => {
  const begin = (overrides: Partial<Parameters<typeof beginMatch>[0]> = {}) =>
    beginMatch({
      seed: 3,
      hostDeck: DECK,
      guestDeck: DECK,
      cardPool: POOL,
      names: { host: "Ana", guest: "Bo" },
      chooser: null,
      now: 5_000,
      ...overrides,
    });

  function created(seed: number) {
    const result = startMatch({ seed, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    if (!result.ok) throw new Error(result.error.message);
    return result;
  }

  it("assembles a current-version record with host names on p1 and guest names on p2", () => {
    const begun = begin();
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.record.version).toBe(MATCH_RECORD_VERSION);
    expect(begun.record.seed).toBe(3);
    expect(begun.record.startedAt).toBe(5_000);
    expect(begun.record.names).toEqual({ p1: "Ana", p2: "Bo" });
    expect(readMatchRecord(structuredClone(begun.record))).toEqual(begun.record);
  });

  it("without a chooser, the coin winner goes first and the log keeps the coin row", () => {
    const result = created(3);
    const opening = settleFirstPlayer(result.state, result.events, null);
    const begun = begin();
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.record.state).toEqual(opening.state);
    expect(begun.record.state.phase.kind).not.toBe("setup:chooseFirst");
    expect(begun.record.log).toEqual(
      logFromEvents(opening.events, {
        names: { p1: "Ana", p2: "Bo" },
        state: opening.state,
        elapsed: formatElapsed(0),
      }),
    );
  });

  it("with a chooser, the game waits on that seat and the log has no coin row", () => {
    for (const chooser of ["p1", "p2"] as const) {
      const result = created(3);
      const begun = begin({ chooser });
      if (!begun.ok) throw new Error(begun.reason);
      expect(begun.record.state.phase).toEqual({ kind: "setup:chooseFirst", coinWinner: chooser });
      const logOf = (events: typeof result.events) =>
        logFromEvents(events, {
          names: { p1: "Ana", p2: "Bo" },
          state: begun.record.state,
          elapsed: formatElapsed(0),
        });
      const withoutCoin = result.events.filter((e) => e.type !== "COIN_FLIP");
      expect(withoutCoin.length).toBeLessThan(result.events.length);
      expect(begun.record.log).toEqual(logOf(withoutCoin));
      expect(begun.record.log).not.toEqual(logOf(result.events));
    }
  });

  it("turns each engine deck rejection into a player-facing reason", () => {
    const stage1: Card = { ...basicCard("evo"), stage: "Stage1", evolveFrom: "basic" };
    expect(begin({ hostDeck: ["basic"] })).toEqual({
      ok: false,
      reason: "A deck must have exactly 60 cards.",
    });
    expect(
      begin({
        guestDeck: Array.from({ length: 60 }, () => "evo"),
        cardPool: { ...POOL, evo: stage1 },
      }),
    ).toEqual({ ok: false, reason: "A deck must include at least one Basic Pokémon." });
    expect(begin({ cardPool: {} })).toEqual({
      ok: false,
      reason: "A deck references a card that's no longer in the catalog.",
    });
  });
});

describe("matchFrameFor — the per-viewer match frame", () => {
  /** A match past the first-player choice, so both hands are dealt. */
  function dealtRecord(): MatchRecord {
    const begun = beginMatch({
      seed: 1,
      hostDeck: DECK,
      guestDeck: DECK,
      cardPool: POOL,
      names: { host: "Ana", guest: "Bo" },
      chooser: null,
      now: STARTED_AT,
    });
    if (!begun.ok) throw new Error(begun.reason);
    return begun.record;
  }

  it("gives each seat its own redaction and every viewer the same log", () => {
    const record = dealtRecord();
    for (const seat of ["p1", "p2"] as const) {
      expect(matchFrameFor(record, seat)).toEqual({
        kind: "match",
        game: redactGame(record.state, seat),
        log: record.log,
      });
    }
    expect(matchFrameFor(record, "p1").game).not.toEqual(matchFrameFor(record, "p2").game);
  });

  it("gives a spectator the seatless redaction from the host's side, with no hand face-up", () => {
    const record = dealtRecord();
    const frame = matchFrameFor(record, "spectator");
    expect(frame).toEqual({
      kind: "match",
      game: redactGame(record.state, SEAT_OF_SLOT.host, true),
      log: record.log,
    });
    expect(frame.game.seat).toBe("p1");
    expect(frame.game).not.toEqual(matchFrameFor(record, "p1").game);
  });
});
