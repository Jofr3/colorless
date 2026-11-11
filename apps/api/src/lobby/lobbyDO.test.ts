import { isRngState } from "@colorless/engine";
import { drbgSeed, storedAt } from "@colorless/engine/testing";
import {
  COUNTDOWN_MS,
  LOBBY_WS_CLOSED,
  LOBBY_WS_NOT_FOUND,
  LOBBY_WS_NUDGE,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyClientMessage,
  type LobbyIntent,
  type LobbyServerMessage,
  type LobbySnapshot,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Env } from "../env";
import { resetLogThrottle } from "../http/log";
import {
  basicCard,
  createLobbyHarness,
  type FakeSocket,
  LEGAL_DECK,
  type LobbyHarness,
  seatIdOf,
  seatSecret,
  sessionIdOf,
} from "./lobbyHarness";
import {
  ABANDON_GRACE_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  FIRST_KEEPALIVE_MARGIN_MS,
  LIVENESS_SWEEP_MS,
  readSnapshot,
  SEATED_LIVENESS_SWEEP_MS,
  SOCKET_SILENCE_MS,
} from "./logic";
import { ALARM_RETRY_MS, lobbyDepsFromEnv } from "./lobbyDO";
import {
  freshMatchRng,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  matchFrameFor,
  readMatchRecord,
} from "./match";
import { MatchStore } from "./matchStore";

const DECK = [...LEGAL_DECK];
const STALE_REASON =
  "This match ended because the server was updated. Pick your decks and ready up to play again.";

let h: LobbyHarness;
let warn: MockInstance<typeof console.warn>;
let info: MockInstance<typeof console.info>;
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  h = createLobbyHarness({
    seed: drbgSeed(42),
    displayNames: new Map([
      ["ana", "Ana"],
      ["bo", "Bo"],
    ]),
    decks: new Map([
      ["deck-ana", { owner: "ana", ids: DECK }],
      ["deck-bo", { owner: "bo", ids: DECK }],
    ]),
  });
});

afterEach(() => {
  h.dispose();
  vi.restoreAllMocks();
  resetLogThrottle();
});

/** The fields of every `lobby` log line of `kind` written so far at `level` (warn by default). */
function logged(
  kind: string,
  level: "warn" | "info" | "error" = "warn",
): Record<string, unknown>[] {
  return { warn, info, error: errors }[level].mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((line) => line.evt === "lobby" && line.kind === kind);
}

/** A hello presenting `from`'s seat secret. */
const hello = (from: string, name = `anon-${from}`): LobbyClientMessage => ({
  kind: "hello",
  from: seatSecret(from),
  name,
});

/** An intent from `from`'s seat, addressed by its public id. */
const intent = (from: string, change: LobbyIntent): LobbyClientMessage => ({
  kind: "intent",
  from: seatIdOf(from),
  intent: change,
});

function snapshotOf(ws: FakeSocket): LobbySnapshot {
  const frame = ws.last("state");
  if (frame === undefined) throw new Error("no state frame");
  return frame.snapshot;
}

/** The match as storage holds it, read by a store with nothing mirrored. */
async function storedMatch(): Promise<MatchRecord> {
  const record = readMatchRecord(await new MatchStore(h.storage).get());
  if (record === null) throw new Error("no readable match record");
  return record;
}

/** Every storage key the match occupies. */
function matchKeys(): string[] {
  return [...h.storage.data.keys()].filter((key) => key.startsWith("match"));
}

/** Create the lobby and seat the host as Ana and the guest as `guestUser` (anonymous if null). */
async function seatBoth(guestUser: string | null = "bo") {
  await h.create();
  const host = await h.connect("ana");
  await h.send(host, hello("h"));
  const guest = await h.connect(guestUser ?? undefined);
  await h.send(guest, hello("g"));
  return { host, guest };
}

async function readyUp(ws: FakeSocket, from: string, deckId: string) {
  await h.send(ws, intent(from, { type: "select-deck", deckId, deckName: deckId }));
  await h.send(ws, intent(from, { type: "set-ready", ready: true }));
}

/** Seat both players, ready them, and run the countdown's alarm into a live match. */
async function startedMatch() {
  const seated = await seatBoth();
  await readyUp(seated.host, "h", "deck-ana");
  await readyUp(seated.guest, "g", "deck-bo");
  await h.fireAlarm();
  return seated;
}

/** Hold the next session read open until `release`, as a slow D1 round trip does: frames
    delivered meanwhile run. */
function holdSessionRead() {
  const read = h.deps.liveSessions;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = true;
  h.deps.liveSessions = async (owners) => {
    if (held) {
      held = false;
      await gate;
    }
    return read(owners);
  };
  return () => release();
}

/** Fire alarms until `done` holds, failing if the lobby stops scheduling them first. */
async function fireAlarmsUntil(done: () => boolean | Promise<boolean>, limit = 50): Promise<void> {
  for (let i = 0; i < limit && !(await done()); i++) await h.fireAlarm();
  if (!(await done())) throw new Error("condition never held");
}

describe("LobbyDO — create and seat", () => {
  it("answers a socket for a code that was never created with a definite not-found close", async () => {
    expect(await h.upgrade("ana")).toEqual({
      kind: "closed",
      code: LOBBY_WS_NOT_FOUND,
      reason: "no such lobby",
    });
    // Nothing is held or stored, and no alarm is armed for the guess.
    expect(h.state.getWebSockets()).toEqual([]);
    expect(h.storage.data.size).toBe(0);
    expect(h.storage.alarm).toBeNull();
  });

  it("claims a code once and arms the empty-lobby expiry", async () => {
    const created = await h.create("WXYZ");
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ code: "WXYZ" });
    expect((await h.create("WXYZ")).status).toBe(409);
    expect(h.storage.alarm).toBe(h.world.now + EMPTY_LOBBY_TTL_MS);
  });

  it("restores the Workers globals on dispose", () => {
    expect("WebSocketPair" in globalThis).toBe(true);
    h.dispose();
    expect("WebSocketPair" in globalThis).toBe(false);
    expect("WebSocketRequestResponsePair" in globalThis).toBe(false);
    expect(() => new Response(null, { status: 101 })).toThrow(RangeError);
  });

  it("answers keepalives without waking the instance", () => {
    expect(h.state.autoResponse).toEqual({ request: LOBBY_WS_PING, response: LOBBY_WS_PONG });
  });

  it("seats host then guest under their account names and polls liveness while connected", async () => {
    await h.create();
    const host = await h.connect("ana");
    expect(h.storage.data.has("cleanupAt")).toBe(false);
    expect(h.storage.alarm).toBe(h.world.now + LIVENESS_SWEEP_MS);
    await h.send(host, hello("h"));
    expect(snapshotOf(host).phase).toBe("waiting");
    expect(snapshotOf(host).host.name).toBe("Ana");
    expect(snapshotOf(host).host.avatarSeed).not.toBeNull();

    const guest = await h.connect();
    await h.send(guest, hello("g", "Guest"));
    const snapshot = snapshotOf(host);
    expect(snapshot.phase).toBe("selecting");
    expect(snapshot.guest?.name).toBe("Guest");
    // A guest who could be told of the host's half-open link: the sweep runs every 5s.
    expect(h.storage.alarm).toBe(h.world.now + SEATED_LIVENESS_SWEEP_MS);
    expect(snapshot.guest?.avatarSeed).toBeNull();
    expect(snapshotOf(guest)).toEqual(snapshot);
  });

  it("answers a repeated hello to the asker alone and writes nothing", async () => {
    const { host, guest } = await startedMatch();
    const snapshot = snapshotOf(host);
    const guestFrames = guest.sent.length;
    const hostFrames = host.sent.length;
    const writes: string[] = [];
    const put = h.storage.put.bind(h.storage);
    h.storage.put = async (key, value) => {
      writes.push(typeof key === "string" ? key : Object.keys(key).join());
      await put(key, value);
    };
    for (let i = 0; i < 3; i++) await h.send(host, hello("h"));
    expect(writes).toEqual([]);
    expect(guest.sent.length).toBe(guestFrames);
    expect(host.sent.slice(hostFrames).map((frame) => frame.kind)).toEqual([
      "state",
      "match",
      "state",
      "match",
      "state",
      "match",
    ]);
    expect(snapshotOf(host)).toEqual(snapshot);
  });

  it("refuses another account presenting a bound seat's secret", async () => {
    await seatBoth();
    const thief = await h.connect("eve");
    await h.send(thief, hello("h"));
    expect(thief.last("reject")).toEqual({ kind: "reject", to: seatIdOf("h"), reason: "full" });
  });
});

describe("LobbyDO — countdown and handoff", () => {
  it("counts down once both are ready, then mints the match and sends each seat its view", async () => {
    const { host, guest } = await seatBoth();
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    const countdown = snapshotOf(host);
    expect(countdown.phase).toBe("countdown");
    expect(countdown.countdownStartedAt).toBe(h.world.now);
    const endsAt = h.world.now + COUNTDOWN_MS;
    expect(h.storage.alarm).toBe(endsAt);

    await h.fireAlarm();
    expect(snapshotOf(host).phase).toBe("in-game");
    const record = await storedMatch();
    expect(record.version).toBe(MATCH_RECORD_VERSION);
    expect(record.seed).toEqual(drbgSeed(42));
    expect(record.startedAt).toBe(endsAt);
    expect(record.names).toEqual({ p1: "Ana", p2: "Bo" });
    expect(host.last("match")).toEqual(matchFrameFor(record, "p1"));
    expect(guest.last("match")).toEqual(matchFrameFor(record, "p2"));
  });

  it("drops both back to selecting with the reason when a deck will not resolve", async () => {
    const { host, guest } = await seatBoth(null);
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    const snapshot = snapshotOf(host);
    expect(snapshot.phase).toBe("selecting");
    expect(snapshot.host.ready).toBe(false);
    expect(snapshot.guest?.ready).toBe(false);
    expect(matchKeys()).toEqual([]);
    const error = {
      kind: "match-error",
      reason: "anon-g: you must be signed in to play a saved deck.",
    };
    expect(host.last("match-error")).toEqual(error);
    expect(guest.last("match-error")).toEqual(error);
    expect(host.framesOf("match")).toEqual([]);
  });

  it("refuses a deck its own format forbids, and starts once a legal one is picked", async () => {
    const rotated = { ...basicCard("old"), legal: { standard: false, expanded: true } };
    h.world.pool.old = rotated;
    const archive = [...DECK.slice(4), "old", "old", "old", "old"];
    h.world.decks.set("deck-bo-copies", { owner: "bo", ids: Array(60).fill("basic") });
    h.world.decks.set("deck-bo-archive", { owner: "bo", ids: archive, format: "standard" });
    h.world.decks.set("deck-bo-expanded", { owner: "bo", ids: archive, format: "expanded" });
    const { host, guest } = await seatBoth();
    for (const [deckId, rule] of [
      ["deck-bo-copies", "60 copies of basic — max 4."],
      ["deck-bo-archive", "old is not legal in Standard."],
    ] as const) {
      await readyUp(host, "h", "deck-ana");
      await readyUp(guest, "g", deckId);
      await h.fireAlarm();
      const snapshot = snapshotOf(host);
      expect(snapshot.phase).toBe("selecting");
      expect(snapshot.host.ready).toBe(false);
      expect(snapshot.guest?.ready).toBe(false);
      expect(matchKeys()).toEqual([]);
      const error = {
        kind: "match-error",
        reason: `Bo's deck can't be played online, as it isn't Standard legal: ${rule}`,
      };
      expect(host.last("match-error")).toEqual(error);
      expect(guest.last("match-error")).toEqual(error);
    }
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo-expanded");
    await h.fireAlarm();
    expect(snapshotOf(host).phase).toBe("in-game");
    expect(guest.last("match")).toEqual(matchFrameFor(await storedMatch(), "p2"));
  });

  it("mints card uids over each deck as the pre-shuffle reorders it, in every game (MIX1)", async () => {
    const shuffled: string[][] = [];
    h.deps.shuffleDeck = (ids) => {
      const order = [...ids].reverse();
      shuffled.push(order);
      return order;
    };
    /** The card ids behind `seat`'s uids, in uid order. */
    const listOf = async (seat: "p1" | "p2") => {
      const { cardIdByUid } = (await storedMatch()).state;
      return DECK.map((_, i) => cardIdByUid[`${seat}#${String(i)}`]);
    };
    const { host, guest } = await startedMatch();
    expect(shuffled).toEqual([[...DECK].reverse(), [...DECK].reverse()]);
    expect(await listOf("p1")).toEqual([...DECK].reverse());
    expect(await listOf("p2")).toEqual([...DECK].reverse());

    await h.send(guest, { kind: "action", action: { type: "concede" } });
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    expect(shuffled).toHaveLength(4);
  });

  it("lets a rematch's loser choose the play order", async () => {
    const { host, guest } = await startedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect((await storedMatch()).state.phase.kind).toBe("gameOver");
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(matchKeys()).toEqual([]);
    expect(h.storage.data.get("nextChooser")).toBe(seatIdOf("g"));

    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    expect((await storedMatch()).state.phase).toEqual({
      kind: "setup:chooseFirst",
      coinWinner: "p2",
    });
    expect(h.storage.data.has("nextChooser")).toBe(false);
  });
});

describe("LobbyDO — the match RNG (MI1)", () => {
  it("production mints a fresh ChaCha20 key for every match, never a numeric seed", () => {
    const deps = lobbyDepsFromEnv({} as Env);
    const [a, b] = [deps.randomSeed(), deps.randomSeed()];
    for (const rng of [a, b]) {
      expect(isRngState(rng)).toBe(true);
      expect(rng).toMatchObject({ alg: "chacha20", counter: 0 });
      expect(rng.key).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(a.key).not.toBe(b.key);
  });

  it("starts the match on that state and keeps it on the DO: no frame or log line carries the key", async () => {
    h.world.seed = freshMatchRng();
    const { key } = h.world.seed;
    const { host, guest } = await startedMatch();
    const watcher = await h.connect("eve");
    await h.send(watcher, hello("w"));
    const start = await storedMatch();
    // The game draws from the minted key; a deal and a coin advanced its counter.
    expect(start.state.rngState).toMatchObject({ alg: "chacha20", key });
    expect((start.state.rngState as { counter: number }).counter).toBeGreaterThan(0);
    const [first, second] = start.state.players.p1.hand;
    await h.send(host, { kind: "action", action: { type: "setupPlaceActive", uid: first } });
    await h.send(host, { kind: "action", action: { type: "setupPlaceBench", uid: second } });
    h.hibernate();
    await h.send(host, hello("h"));
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    const sent = [host, guest, watcher].flatMap((ws) => ws.sent);
    expect(sent.filter((frame) => frame.kind === "match").length).toBeGreaterThan(6);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(key);
    expect(wire).not.toContain("rngState");
    expect(wire).not.toContain("chacha20");
    expect(JSON.stringify([warn.mock.calls, info.mock.calls, errors.mock.calls])).not.toContain(
      key,
    );
  });
});

describe("LobbyDO — match actions", () => {
  it("persists an accepted action and sends every seat its new view", async () => {
    const { host, guest } = await startedMatch();
    const before = await storedMatch();
    const uid = before.state.players.p1.hand[0];
    await h.send(host, { kind: "action", action: { type: "setupPlaceActive", uid } });
    const after = await storedMatch();
    expect(after.state.players.p1.active?.stack).toEqual([uid]);
    expect(host.last("match")).toEqual(matchFrameFor(after, "p1"));
    expect(guest.last("match")).toEqual(matchFrameFor(after, "p2"));
  });

  it("reads the match from storage only on the first action after a wake", async () => {
    const { host, guest } = await startedMatch();
    const [first, second] = (await storedMatch()).state.players.p1.hand;
    const reads: unknown[] = [];
    const get = h.storage.get.bind(h.storage) as (key: string) => Promise<unknown>;
    h.storage.get = (async (key: string) => {
      reads.push(key);
      return get(key);
    }) as typeof h.storage.get;
    const matchReads = () => reads.filter((key) => String(key).startsWith("match")).length;
    await h.send(host, { kind: "action", action: { type: "setupPlaceActive", uid: first } });
    expect(matchReads()).toBe(0);
    h.hibernate();
    await h.send(host, { kind: "action", action: { type: "setupPlaceBench", uid: second } });
    expect(matchReads()).toBeGreaterThan(0);
    const after = await storedMatch();
    expect(after.state.players.p1.bench).toHaveLength(1);
    expect(guest.last("match")).toEqual(matchFrameFor(after, "p2"));
  });

  it("binds an action to the socket's own seat, whatever seat it claims", async () => {
    const { guest } = await startedMatch();
    const uid = (await storedMatch()).state.players.p1.hand[0];
    await h.send(guest, {
      kind: "action",
      action: { type: "setupPlaceActive", seat: "p1", uid },
    });
    expect((await storedMatch()).state.players.p1.active).toBeNull();
    expect(guest.last("reject-action")).toBeDefined();
  });

  it("answers a refused action to the actor alone and changes nothing", async () => {
    const { host, guest } = await startedMatch();
    const before = await storedMatch();
    const hostFrames = host.sent.length;
    await h.send(guest, { kind: "action", action: { type: "bogus" } });
    expect(guest.last("reject-action")).toEqual({
      kind: "reject-action",
      reason: "That move isn't available here.",
    });
    expect(await storedMatch()).toEqual(before);
    expect(host.sent.length).toBe(hostFrames);
  });

  it("answers a refused socket full and sends it no board, through the match", async () => {
    const { guest } = await startedMatch();
    const watcher = await h.connect("eve");
    await h.send(watcher, hello("w"));
    const record = await storedMatch();
    expect(watcher.sent).toEqual([{ kind: "reject", to: seatIdOf("w"), reason: "full" }]);
    await h.send(watcher, { kind: "action", action: { type: "concede" } });
    expect(await storedMatch()).toEqual(record);
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(watcher.framesOf("match")).toEqual([]);
  });
});

describe("LobbyDO — log deltas", () => {
  const deltaHello = (from: string): LobbyClientMessage => ({
    kind: "hello",
    from: seatSecret(from),
    name: `anon-${from}`,
    logDeltas: true,
  });

  /** A started match whose host announced log deltas and whose guest is an older client. */
  async function mixedMatch() {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, deltaHello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    return { host, guest };
  }

  /** The log a client holds after applying `frames` in order, as the web client does. */
  function heldLog(frames: readonly LobbyServerMessage[]): MatchRecord["log"] {
    let log: MatchRecord["log"] = [];
    for (const frame of frames) {
      if (frame.kind !== "match") continue;
      if (frame.logFrom !== undefined && frame.logFrom !== log.length) throw new Error("gap");
      log = frame.logFrom === undefined ? frame.log : [...log, ...frame.log];
    }
    return log;
  }

  it("sends the full log at the handoff, then only new entries to a socket that asked", async () => {
    const { host, guest } = await mixedMatch();
    const start = await storedMatch();
    expect(host.last("match")).toEqual(matchFrameFor(start, "p1"));
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    const after = await storedMatch();
    expect(after.log.length).toBeGreaterThan(start.log.length);
    expect(host.last("match")).toEqual(matchFrameFor(after, "p1", start.log.length));
    expect(host.last("match")?.logFrom).toBe(start.log.length);
    expect(heldLog(host.sent)).toEqual(after.log);
  });

  it("keeps sending the whole log to a socket that did not ask", async () => {
    const { guest } = await mixedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    const frame = guest.last("match");
    expect(frame).toEqual(matchFrameFor(await storedMatch(), "p2"));
    expect(frame).not.toHaveProperty("logFrom");
  });

  it("sends a forfeit as a delta too", async () => {
    const { host, guest } = await mixedMatch();
    const start = await storedMatch();
    await h.send(guest, { kind: "bye", from: seatIdOf("g"), slot: "guest" });
    expect((await storedMatch()).state.phase.kind).toBe("gameOver");
    expect(host.last("match")?.logFrom).toBe(start.log.length);
    expect(heldLog(host.sent)).toEqual((await storedMatch()).log);
  });

  it("sends the full log to a socket that reconnects mid-match", async () => {
    const { host, guest } = await mixedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    await h.drop(host);
    const back = await h.connect("ana");
    await h.send(back, deltaHello("h"));
    expect(back.framesOf("match")).toEqual([matchFrameFor(await storedMatch(), "p1")]);
  });

  it("answers a repeated hello on the same socket with the full log", async () => {
    const { host } = await mixedMatch();
    await h.send(host, deltaHello("h"));
    expect(host.last("match")).toEqual(matchFrameFor(await storedMatch(), "p1"));
  });

  it("starts a rematch with the full log", async () => {
    const { host, guest } = await mixedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    expect(host.last("match")).toEqual(matchFrameFor(await storedMatch(), "p1"));
  });

  it("remembers which socket asked across hibernation", async () => {
    const { host, guest } = await mixedMatch();
    const start = await storedMatch();
    h.hibernate();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(host.last("match")?.logFrom).toBe(start.log.length);
    expect(guest.last("match")).toEqual(matchFrameFor(await storedMatch(), "p2"));
  });
});

describe("LobbyDO — disconnects", () => {
  it("absorbs a reconnect inside the grace", async () => {
    const { host, guest } = await startedMatch();
    await h.drop(guest);
    const back = await h.connect("bo");
    await h.send(back, hello("g"));
    expect(back.last("match")).toEqual(matchFrameFor(await storedMatch(), "p2"));
    h.world.now += DISCONNECT_GRACE_MS;
    await h.fireAlarm();
    expect(snapshotOf(host).guest?.connected).toBe(true);
    expect(snapshotOf(host).guest?.forfeitAt).toBeNull();
  });

  it("marks a seat gone after the grace, forfeits it after the abandon window, then wipes the empty lobby", async () => {
    const { host, guest } = await startedMatch();
    const droppedAt = h.world.now;
    await h.drop(guest);
    expect(h.storage.alarm).toBe(droppedAt + DISCONNECT_GRACE_MS);

    await h.fireAlarm();
    const gone = snapshotOf(host);
    expect(gone.guest?.connected).toBe(false);
    expect(gone.guest?.forfeitAt).toBe(droppedAt + DISCONNECT_GRACE_MS + ABANDON_GRACE_MS);

    await fireAlarmsUntil(async () => (await storedMatch()).state.phase.kind === "gameOver");
    expect(h.world.now).toBe(droppedAt + DISCONNECT_GRACE_MS + ABANDON_GRACE_MS);
    const over = await storedMatch();
    expect(over.state.phase).toMatchObject({
      outcome: { result: "win", winner: "p1", reason: "conceded" },
    });
    expect(host.last("match")).toEqual(matchFrameFor(over, "p1"));
    expect(snapshotOf(host).guest?.forfeitAt).toBeNull();
    expect(guest.framesOf("match")).toHaveLength(1);
    expect(logged("forfeit", "info")).toEqual([
      { evt: "lobby", kind: "forfeit", lobby: "ABCD", seat: "p2", cause: "abandoned" },
    ]);
    expect(logged("match_ended", "info")).toMatchObject([{ lobby: "ABCD", cause: "abandoned" }]);

    const emptiedAt = h.world.now;
    await h.drop(host);
    await fireAlarmsUntil(() => h.storage.data.size === 0);
    expect(h.storage.alarm).toBeNull();
    expect(h.world.now).toBe(emptiedAt + EMPTY_LOBBY_TTL_MS);
    expect(logged("lobby_wiped", "info")).toMatchObject([{ lobby: "ABCD", inGame: true }]);
    expect((await h.create()).status).toBe(201);
  });

  it("lands a forfeit at its deadline though a late alarm moved the liveness sweeps off it", async () => {
    const { host, guest } = await startedMatch();
    await h.drop(guest);
    await h.fireAlarm();
    const forfeitAt = snapshotOf(host).guest?.forfeitAt;
    expect(forfeitAt).toBeTypeOf("number");
    // The next sweep runs 7 s late, as a busy runtime's alarm may.
    h.world.now = (h.storage.alarm ?? 0) + 7000;
    await h.fireAlarm();
    await fireAlarmsUntil(async () => (await storedMatch()).state.phase.kind === "gameOver");
    expect(h.world.now).toBe(forfeitAt);
  });

  it("forfeits a seat whose player never came back after a deploy dropped every socket", async () => {
    const { guest } = await startedMatch();
    h.redeploy();
    expect(guest.closed).toEqual({ code: 1001, reason: "redeploy" });
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    expect(snapshotOf(host).guest?.connected).toBe(true);
    await fireAlarmsUntil(() => snapshotOf(host).guest?.connected === false);
    expect(snapshotOf(host).guest?.forfeitAt).toBe(h.world.now + ABANDON_GRACE_MS);
    expect(logged("seat_orphaned")).toMatchObject([{ seats: 1 }]);
    await fireAlarmsUntil(async () => (await storedMatch()).state.phase.kind === "gameOver");
    expect((await storedMatch()).state.phase).toMatchObject({
      outcome: { result: "win", winner: "p1", reason: "conceded" },
    });
  });

  it("keeps both seats after a deploy when both players come back, though one says hello late", async () => {
    await startedMatch();
    h.redeploy();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    // The guest's socket is open but has not said hello when the sweep runs.
    const guest = await h.connect("bo");
    await h.fireAlarm();
    await h.send(guest, hello("g"));
    for (let i = 0; i < 5; i++) await h.fireAlarm();
    expect(snapshotOf(host).guest).toMatchObject({ connected: true, forfeitAt: null });
    expect((await storedMatch()).state.phase.kind).not.toBe("gameOver");
  });

  it("wipes an empty lobby whose alarm fired late, past both the grace and the expiry", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    await h.drop(host);
    h.world.now += DISCONNECT_GRACE_MS + EMPTY_LOBBY_TTL_MS;
    await h.fireAlarm();
    expect(h.storage.data.size).toBe(0);
    expect(h.storage.alarm).toBeNull();
  });

  it("tells the opponent of a mid-match half-open socket within 20s of its last keepalive", async () => {
    const { host, guest } = await startedMatch();
    const silentFrom = h.world.now;
    guest.lastPong = new Date(silentFrom);
    await fireAlarmsUntil(() => snapshotOf(host).guest?.connected === false);
    expect(guest.closed).toEqual({ code: 1001, reason: "keepalive lost" });
    expect(h.world.now - silentFrom).toBeLessThanOrEqual(
      SEATED_LIVENESS_SWEEP_MS + SOCKET_SILENCE_MS + DISCONNECT_GRACE_MS,
    );
    expect(h.world.now - silentFrom).toBeLessThanOrEqual(20_000);
    // The forfeit clock runs from the moment the host is told.
    expect(snapshotOf(host).guest?.forfeitAt).toBe(h.world.now + ABANDON_GRACE_MS);
  });

  it("nudges a seated socket whose pings lapsed, and keeps it while it answers (APPX2)", async () => {
    const { host, guest } = await startedMatch();
    // A hidden tab: its timers stopped its pings, but its message handler answers a nudge at once.
    guest.lastPong = new Date(h.world.now);
    const send = guest.send.bind(guest);
    guest.send = (data: string) => {
      if (data === LOBBY_WS_NUDGE) guest.lastPong = new Date(h.world.now);
      send(data);
    };
    const until = h.world.now + 60_000;
    while (h.world.now < until) await h.fireAlarm();
    expect(guest.closed).toBeNull();
    expect(guest.nudges).toBeGreaterThanOrEqual(60_000 / (SEATED_LIVENESS_SWEEP_MS * 2));
    expect(host.nudges).toBe(0);
    expect(snapshotOf(host).guest?.connected).toBe(true);
  });

  it("keeps a lone host's lobby on the 30s sweep, before and after a guest leaves", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    await h.fireAlarm();
    expect(h.storage.alarm).toBe(h.world.now + LIVENESS_SWEEP_MS);
    const guest = await h.connect();
    await h.send(guest, hello("g", "Guest"));
    await h.send(guest, { kind: "bye", from: seatIdOf("g"), slot: "guest" });
    expect(snapshotOf(host).guest).toBeNull();
    await h.fireAlarm();
    expect(h.storage.alarm).toBe(h.world.now + LIVENESS_SWEEP_MS);
  });

  it("closes a socket that stopped answering keepalives and starts its grace", async () => {
    const { host, guest } = await startedMatch();
    guest.lastPong = new Date(h.world.now);
    host.lastPong = new Date(h.world.now + LIVENESS_SWEEP_MS);
    await fireAlarmsUntil(() => guest.closed !== null);
    expect(h.world.now - guest.lastPong.getTime()).toBeGreaterThan(SOCKET_SILENCE_MS);
    expect(guest.closed).toEqual({ code: 1001, reason: "keepalive lost" });
    expect(host.closed).toBeNull();
    expect(h.storage.data.get("pendingDisconnects")).toEqual([
      { playerId: seatIdOf("g"), deadline: h.world.now + DISCONNECT_GRACE_MS },
    ]);
  });
});

describe("LobbyDO — stale records", () => {
  async function staleMatch(version = MATCH_RECORD_VERSION + 1) {
    const seated = await startedMatch();
    await h.storage.put("match", { ...(await storedMatch()), version });
    h.hibernate();
    return seated;
  }

  it("retires a record at the retired version 41 the same way, without throwing", async () => {
    const { host, guest } = await staleMatch(41);
    await h.drop(host);
    const back = await h.connect("ana");
    await h.send(back, hello("h"));
    expect(matchKeys()).toEqual([]);
    expect(snapshotOf(back).phase).toBe("selecting");
    expect(guest.last("match-error")).toEqual({ kind: "match-error", reason: STALE_REASON });
    expect(logged("match_retired")).toHaveLength(1);
  });

  it("migrates a record at the oldest migratable version, 42, and play continues", async () => {
    const { host, guest } = await startedMatch();
    const current = await storedMatch();
    await h.storage.put("match", { ...current, ...storedAt(42, current.state) });
    h.hibernate();
    await h.drop(host);
    const back = await h.connect("ana");
    await h.send(back, hello("h"));
    expect(snapshotOf(back).phase).toBe("in-game");
    expect((await storedMatch()).version).toBe(MATCH_RECORD_VERSION);
    expect(logged("match_migrated")).toEqual([
      expect.objectContaining({ from: 42, to: MATCH_RECORD_VERSION }),
    ]);
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(logged("match_retired")).toEqual([]);
  });

  it("retires an unreadable record when a player reconnects", async () => {
    const { host, guest } = await staleMatch();
    await h.drop(host);
    const back = await h.connect("ana");
    await h.send(back, hello("h"));
    expect(matchKeys()).toEqual([]);
    const snapshot = snapshotOf(back);
    expect(snapshot.phase).toBe("selecting");
    expect(snapshot.host.ready).toBe(false);
    expect(snapshot.guest?.ready).toBe(false);
    expect(back.last("match-error")).toEqual({ kind: "match-error", reason: STALE_REASON });
    expect(guest.last("match-error")).toEqual({ kind: "match-error", reason: STALE_REASON });
    expect(logged("match_retired")).toEqual([
      { evt: "lobby", kind: "match_retired", lobby: "ABCD", cause: "unreadable_record" },
    ]);
  });

  it("retires an unreadable record when a player acts", async () => {
    const { guest } = await staleMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(matchKeys()).toEqual([]);
    expect(snapshotOf(guest).phase).toBe("selecting");
    expect(guest.last("match-error")).toEqual({ kind: "match-error", reason: STALE_REASON });
  });
});

/** Seat both players and ready them: the countdown's alarm is armed and due next. */
async function readiedLobby() {
  const seated = await seatBoth();
  await readyUp(seated.host, "h", "deck-ana");
  await readyUp(seated.guest, "g", "deck-bo");
  return seated;
}

/** Run the pending alarm without awaiting it, as the runtime does while other events arrive. */
function startAlarm(): Promise<void> {
  const at = h.storage.alarm;
  if (at === null) throw new Error("no alarm is set");
  h.storage.alarm = null;
  h.world.now = Math.max(h.world.now, at);
  return h.lobby.alarm();
}

/** Hold every deck read open until `release`, as a slow D1 round trip does. The DO's input gate
    is open while it waits, so frames delivered meanwhile run. */
function holdDeckReads() {
  const read = h.deps.loadDeck;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = { inside, release: () => release(), calls: 0 };
  h.deps.loadDeck = async (deckId, owner) => {
    held.calls++;
    entered();
    await gate;
    return read(deckId, owner);
  };
  return held;
}

/** Every storage write and alarm change from now on, by key. */
function recordWrites(): string[] {
  const writes: string[] = [];
  const storage = h.storage;
  const put = storage.put.bind(storage);
  const remove = storage.delete.bind(storage) as (keys: string | string[]) => Promise<unknown>;
  const setAlarm = storage.setAlarm.bind(storage);
  const deleteAlarm = storage.deleteAlarm.bind(storage);
  storage.put = async (key, value) => {
    writes.push(typeof key === "string" ? key : Object.keys(key).join());
    await put(key, value);
  };
  storage.delete = (async (keys: string | string[]) => {
    writes.push(`delete:${String(keys)}`);
    return remove(keys);
  }) as typeof storage.delete;
  storage.setAlarm = async (at) => {
    writes.push("setAlarm");
    await setAlarm(at);
  };
  storage.deleteAlarm = async () => {
    writes.push("deleteAlarm");
    await deleteAlarm();
  };
  return writes;
}

describe("LobbyDO — events while the handoff awaits D1", () => {
  it("a guest who leaves is not re-seated into a match", async () => {
    const { host, guest } = await readiedLobby();
    const held = holdDeckReads();
    const alarm = startAlarm();
    await held.inside;
    await h.send(guest, { kind: "bye", from: seatIdOf("g"), slot: "guest" });
    await h.drop(guest);
    held.release();
    await alarm;
    const snapshot = snapshotOf(host);
    expect(snapshot.phase).toBe("waiting");
    expect(snapshot.guest).toBeNull();
    expect(matchKeys()).toEqual([]);
    expect(host.framesOf("match")).toEqual([]);
  });

  it("an un-ready lands, and the countdown stops", async () => {
    const { host } = await readiedLobby();
    const held = holdDeckReads();
    const alarm = startAlarm();
    await held.inside;
    await h.send(host, intent("h", { type: "set-ready", ready: false }));
    held.release();
    await alarm;
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(snapshotOf(host).host.ready).toBe(false);
    expect(matchKeys()).toEqual([]);
  });

  it("a rename lands in the lobby and the match without reading the decks again", async () => {
    const { host } = await readiedLobby();
    const held = holdDeckReads();
    const alarm = startAlarm();
    await held.inside;
    // The account renamed itself, and a reload of the host's tab says hello under the new name.
    h.world.displayNames.set("ana", "Captain");
    const reloaded = await h.connect("ana");
    await h.send(reloaded, hello("h"));
    held.release();
    await alarm;
    expect(snapshotOf(host).phase).toBe("in-game");
    expect(snapshotOf(host).host.name).toBe("Captain");
    expect((await storedMatch()).names.p1).toBe("Captain");
    expect(held.calls).toBe(2);
  });

  it("a socket that drops keeps the match from starting without its player", async () => {
    const { host, guest } = await readiedLobby();
    const held = holdDeckReads();
    const alarm = startAlarm();
    await held.inside;
    await h.drop(guest);
    held.release();
    await alarm;
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(snapshotOf(host).guest?.connected).toBe(false);
    expect(matchKeys()).toEqual([]);
  });

  it("stops retrying after a bounded number of changes, and the next alarm starts the match", async () => {
    h.world.decks.set("deck-bo-2", { owner: "bo", ids: DECK });
    const { host, guest } = await readiedLobby();
    const endsAt = h.storage.alarm;
    const read = h.deps.loadDeck;
    let switches = 0;
    h.deps.loadDeck = async (deckId, owner) => {
      if (owner?.userId === "bo") {
        switches++;
        const next = switches % 2 === 1 ? "deck-bo-2" : "deck-bo";
        await h.send(guest, intent("g", { type: "select-deck", deckId: next, deckName: next }));
      }
      return read(deckId, owner);
    };
    await h.fireAlarm();
    expect(switches).toBe(3);
    expect(snapshotOf(host).phase).toBe("countdown");
    expect(matchKeys()).toEqual([]);
    expect(logged("handoff_deferred")).toMatchObject([{ lobby: "ABCD", attempts: 3 }]);
    expect(h.storage.alarm).toBe(endsAt);

    h.deps.loadDeck = read;
    await h.fireAlarm();
    expect(snapshotOf(host).phase).toBe("in-game");
    expect(readSnapshot(h.storage.data.get("snapshot"))?.guest?.deckId).toBe("deck-bo-2");
  });
});

describe("LobbyDO — lobbies stored before seat secrets (LB6)", () => {
  /** A live match whose stored seats carry the ids clients sent before the split, as a deploy
      finds it: its sockets dropped, the instance woken afresh. `lurker` stays connected. */
  async function legacyLobby() {
    await h.create();
    const lurker = await h.connect();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    await h.drop(host);
    await h.drop(guest);
    const stored = readSnapshot(h.storage.data.get("snapshot"));
    if (stored?.guest == null) throw new Error("no stored lobby");
    h.storage.data.set("snapshot", {
      ...stored,
      host: { ...stored.host, id: "6f1c2b9e-0a4d-4c3b-9e8f-1a2b3c4d5e6f" },
      guest: { ...stored.guest, id: "0b7f6a2e-9c1d-4e1f-8a6b-3c2d1e0f9a8b" },
    });
    h.hibernate();
    return { lurker };
  }

  it("wipes such a lobby on the next socket and answers it like an expired one", async () => {
    await legacyLobby();
    expect(await h.upgrade("ana")).toEqual({
      kind: "closed",
      code: LOBBY_WS_NOT_FOUND,
      reason: "no such lobby",
    });
    expect(h.storage.data.size).toBe(0);
    expect(h.storage.alarm).toBeNull();
    expect(logged("lobby_wiped", "info")).toMatchObject([{ lobby: "ABCD", cause: "legacy" }]);
    expect((await h.create()).status).toBe(201);
  });

  it("wipes such a lobby on its next alarm, closing what is still connected for good", async () => {
    const { lurker } = await legacyLobby();
    await h.fireAlarm();
    expect(h.storage.data.size).toBe(0);
    expect(h.storage.alarm).toBeNull();
    expect(lurker.closed?.code).toBe(LOBBY_WS_CLOSED);
  });
});

describe("LobbyDO — failures", () => {
  it("drops both back with a reason when D1 fails at the handoff, and keeps the alarm", async () => {
    const { host, guest } = await readiedLobby();
    h.deps.loadDeck = async () => {
      throw new Error("D1_ERROR: Network connection lost.");
    };
    await h.fireAlarm();
    const snapshot = snapshotOf(host);
    expect(snapshot.phase).toBe("selecting");
    expect([snapshot.host.ready, snapshot.guest?.ready]).toEqual([false, false]);
    const error = {
      kind: "match-error",
      reason: "Couldn't load the decks. Ready up to try again.",
    };
    expect(host.last("match-error")).toEqual(error);
    expect(guest.last("match-error")).toEqual(error);
    expect(h.storage.alarm).toBe(h.world.now + SEATED_LIVENESS_SWEEP_MS);
    expect(logged("handoff_failed")).toEqual([
      {
        evt: "lobby",
        kind: "handoff_failed",
        lobby: "ABCD",
        cause: "d1_error",
        error: "Error: D1_ERROR: Network connection lost.",
      },
    ]);
    // A D1 outage is a degradation the handoff handles, not a defect.
    expect(logged("handoff_failed", "error")).toEqual([]);
  });

  it("drops both back with a reason when starting the match throws", async () => {
    const { host, guest } = await readiedLobby();
    h.deps.shuffleDeck = () => {
      throw new Error("engine threw");
    };
    await h.fireAlarm();
    const error = {
      kind: "match-error",
      reason: "This match couldn't start. Ready up to try again.",
    };
    expect(host.last("match-error")).toEqual(error);
    expect(guest.last("match-error")).toEqual(error);
    const snapshot = snapshotOf(host);
    expect(snapshot.phase).toBe("selecting");
    expect([snapshot.host.ready, snapshot.guest?.ready]).toEqual([false, false]);
    expect(matchKeys()).toEqual([]);
    // The engine is meant to be total, so its throw is a code defect: error level.
    expect(logged("handoff_failed", "error")).toEqual([
      {
        evt: "lobby",
        kind: "handoff_failed",
        lobby: "ABCD",
        cause: "match_refused",
        error: "Error: engine threw",
      },
    ]);
    expect(logged("handoff_failed")).toEqual([]);
    expect(logged("alarm_failed", "error")).toEqual([]);
    expect(logged("match_started", "info")).toEqual([]);
    expect(h.storage.alarm).toBe(h.world.now + SEATED_LIVENESS_SWEEP_MS);
  });

  it("logs an alarm that throws and re-arms it a delay later, so the countdown is not stranded", async () => {
    const { host } = await readiedLobby();
    const put = h.storage.put.bind(h.storage);
    let fail = true;
    h.storage.put = async (key, value) => {
      if (fail && typeof key === "object" && "match" in key) throw new Error("SQLITE_TOOBIG");
      await put(key, value);
    };
    // The countdown's deadline is past, yet each failed pass waits before the next.
    for (const pass of [1, 2]) {
      await h.fireAlarm();
      expect(logged("alarm_failed", "error")).toHaveLength(pass);
      expect(h.storage.alarm).toBe(h.world.now + ALARM_RETRY_MS);
    }
    expect(logged("alarm_failed", "error")[0]).toEqual({
      evt: "lobby",
      kind: "alarm_failed",
      lobby: "ABCD",
      error: "Error: SQLITE_TOOBIG",
    });
    expect(logged("alarm_failed")).toEqual([]);
    fail = false;
    await h.fireAlarm();
    expect(snapshotOf(host).phase).toBe("in-game");
  });

  it("refuses a join with 503 when the session lookup fails, leaving no socket behind", async () => {
    await h.create();
    h.deps.resolveAccount = async () => {
      throw new Error("D1_ERROR: Network connection lost.");
    };
    await expect(h.connect("ana")).rejects.toThrow("upgrade refused with 503");
    expect(h.state.getWebSockets()).toEqual([]);
    expect(h.state.sockets[0]?.closed).toEqual({ code: 1011, reason: "session lookup failed" });
    expect(logged("ws_refused")).toMatchObject([{ lobby: "ABCD", cause: "session_lookup" }]);
    await fireAlarmsUntil(() => h.storage.data.size === 0);
  });

  it("keeps memory agreeing with storage when a snapshot write fails", async () => {
    const { host } = await seatBoth();
    await h.send(host, intent("h", { type: "select-deck", deckId: "deck-ana", deckName: "A" }));
    const put = h.storage.put.bind(h.storage);
    let fail = true;
    h.storage.put = async (key, value) => {
      if (fail && key === "snapshot") {
        fail = false;
        throw new Error("SQLITE_TOOBIG");
      }
      await put(key, value);
    };
    const ready = intent("h", { type: "set-ready", ready: true });
    await expect(h.send(host, ready)).rejects.toThrow("SQLITE_TOOBIG");
    // The frame's failure is a line under the lobby's code before the error goes on.
    expect(logged("frame_failed", "error")).toEqual([
      {
        evt: "lobby",
        kind: "frame_failed",
        lobby: "ABCD",
        frame: "intent",
        error: "Error: SQLITE_TOOBIG",
      },
    ]);
    await h.send(host, ready);
    expect(snapshotOf(host).host.ready).toBe(true);
    expect(readSnapshot(h.storage.data.get("snapshot"))?.host.ready).toBe(true);
    expect(logged("frame_failed", "error")).toHaveLength(1);
  });

  it("logs a failed frame once per frame kind, rethrowing the frame's own error when the code read fails too", async () => {
    const { host } = await seatBoth();
    // A woken instance holds no snapshot, so both the frame and the line's code read storage.
    h.hibernate();
    const get = h.storage.get.bind(h.storage) as (key: string) => Promise<unknown>;
    let reads = 0;
    h.storage.get = (async () => {
      reads++;
      throw new Error(`read ${String(reads)} failed`);
    }) as typeof h.storage.get;
    const pick = intent("h", { type: "select-deck", deckId: "deck-ana", deckName: "A" });
    await expect(h.send(host, pick)).rejects.toThrow("read 1 failed");
    expect(reads).toBe(2);
    await expect(h.send(host, pick)).rejects.toThrow("read 3 failed");
    await expect(h.send(host, hello("h"))).rejects.toThrow("read 5 failed");
    expect(logged("frame_failed", "error")).toEqual([
      {
        evt: "lobby",
        kind: "frame_failed",
        lobby: null,
        frame: "intent",
        error: "Error: read 1 failed",
      },
      {
        evt: "lobby",
        kind: "frame_failed",
        lobby: null,
        frame: "hello",
        error: "Error: read 5 failed",
      },
    ]);
    h.storage.get = get as typeof h.storage.get;
    await h.send(host, pick);
    expect(readSnapshot(h.storage.data.get("snapshot"))?.host.deckId).toBe("deck-ana");
  });
});

describe("LobbyDO — match lines (MET3)", () => {
  it("logs each match's start and its end with the cause, turn and duration, and a rematch's start", async () => {
    const { host, guest } = await startedMatch();
    expect(logged("match_started", "info")).toEqual([
      { evt: "lobby", kind: "match_started", lobby: "ABCD" },
    ]);
    const { startedAt } = await storedMatch();
    h.world.now += 90_000;
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    // A concede once the game is over changes nothing and logs nothing.
    await h.send(host, { kind: "action", action: { type: "concede" } });
    expect(logged("match_ended", "info")).toEqual([
      {
        evt: "lobby",
        kind: "match_ended",
        lobby: "ABCD",
        cause: "conceded",
        turns: (await storedMatch()).state.turn,
        durationMs: h.world.now - startedAt,
      },
    ]);
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    expect(logged("match_started", "info")).toHaveLength(2);
    expect(logged("match_ended", "info")).toHaveLength(1);
  });

  it("ends a match left mid-game as `left`, after its forfeit line", async () => {
    const { guest } = await startedMatch();
    await h.send(guest, { kind: "bye", from: seatIdOf("g"), slot: "guest" });
    const kinds = info.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.evt === "lobby")
      .map((line) => line.kind);
    expect(kinds.slice(-2)).toEqual(["forfeit", "match_ended"]);
    expect(logged("match_ended", "info")).toMatchObject([{ cause: "left", turns: 0 }]);
  });
});

describe("LobbyDO — the session behind a socket", () => {
  it("loads no deck for a socket whose session ended after it connected", async () => {
    const { host } = await readiedLobby();
    h.world.endedSessions.add(sessionIdOf("bo"));
    await h.fireAlarm();
    expect(host.last("match-error")).toEqual({
      kind: "match-error",
      reason: "Bo: sign in again to play a saved deck.",
    });
    expect(matchKeys()).toEqual([]);
  });

  it("plays a socket attached before sessions were recorded as signed out", async () => {
    const { host, guest } = await readiedLobby();
    guest.serializeAttachment({ playerId: seatIdOf("g"), userId: "bo", displayName: "Bo" });
    await h.fireAlarm();
    expect(host.last("match-error")).toEqual({
      kind: "match-error",
      reason: "Bo: you must be signed in to play a saved deck.",
    });
  });
});

describe("LobbyDO — a rematch re-checks each seat's session (MI4)", () => {
  /** A finished match: the guest conceded. Counts the session checks from then on. */
  async function finishedMatch() {
    const seated = await startedMatch();
    await h.send(seated.guest, { kind: "action", action: { type: "concede" } });
    expect((await storedMatch()).state.phase.kind).toBe("gameOver");
    const checks: string[][] = [];
    const check = h.deps.liveSessions;
    h.deps.liveSessions = (owners) => {
      checks.push(owners.map((owner) => owner.sessionId));
      return check(owners);
    };
    return { ...seated, checks };
  }

  it("starts the rematch after one read of both sessions, and never reads them per frame", async () => {
    const { host, guest, checks } = await finishedMatch();
    // A signed-in socket refused a seat holds none, so its session is not the rematch's to check.
    const watcher = await h.connect("vic");
    await h.send(watcher, hello("w"));
    expect(watcher.last("reject")?.reason).toBe("full");
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(checks).toEqual([[sessionIdOf("ana"), sessionIdOf("bo")]]);
    // The rest of the lobby's life reads no session: a repeated rematch, intents and a new match.
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(checks).toHaveLength(1);
  });

  it("refuses a requester whose session was revoked, and its reconnect only watches", async () => {
    const { host, guest, checks } = await finishedMatch();
    h.world.endedSessions.add(sessionIdOf("bo"));
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(guest.last("reject-action")).toEqual({
      kind: "reject-action",
      reason: "You're signed out. Sign in again to play another game.",
    });
    expect(guest.closed).toEqual({ code: 1008, reason: "session ended" });
    expect(host.closed).toBeNull();
    expect(host.framesOf("reject-action")).toEqual([]);
    expect(snapshotOf(host).phase).toBe("in-game");
    expect((await storedMatch()).state.phase.kind).toBe("gameOver");
    expect(checks).toHaveLength(1);
    expect(logged("rematch_refused")).toEqual([
      {
        evt: "lobby",
        kind: "rematch_refused",
        lobby: "ABCD",
        cause: "session_ended",
        sockets: 1,
        requester: true,
      },
    ]);

    // Without a live cookie the reload is anonymous: the account-bound seat refuses it, and it
    // is sent no board and cannot act for the seat.
    const reloaded = await h.connect();
    await h.send(reloaded, hello("g"));
    expect(reloaded.last("reject")).toEqual({ kind: "reject", to: seatIdOf("g"), reason: "full" });
    expect(reloaded.framesOf("match")).toEqual([]);
    await h.send(reloaded, { kind: "rematch", from: seatIdOf("g") });
    expect(snapshotOf(host).phase).toBe("in-game");
    expect(logged("hello_refused")).toMatchObject([{ cause: "bound", signedIn: false }]);
  });

  it("refuses a rematch with an opponent whose account was deleted", async () => {
    const { host, guest } = await finishedMatch();
    // Deleting an account deletes its sessions.
    h.world.endedSessions.add(sessionIdOf("ana"));
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(guest.last("reject-action")).toEqual({
      kind: "reject-action",
      reason: "Your opponent is signed out, so there's no rematch.",
    });
    expect(host.closed).toEqual({ code: 1008, reason: "session ended" });
    expect(guest.closed).toBeNull();
    expect(snapshotOf(guest).phase).toBe("in-game");
    expect(logged("rematch_refused")).toMatchObject([{ sockets: 1, requester: false }]);
  });

  it("takes a rematch that finds the lobby already out of the game as its acceptance", async () => {
    const { host, guest, checks } = await finishedMatch();
    // Both pressed Rematch before seeing the other's: the host's lands first.
    await h.send(host, { kind: "rematch", from: seatIdOf("h") });
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(snapshotOf(guest)).toMatchObject({
      phase: "countdown",
      host: { ready: true },
      guest: { ready: true },
    });
    expect(checks).toHaveLength(2);
    // The chooser is the first rematch's: the guest conceded, so the guest picks.
    expect(h.storage.data.get("nextChooser")).toBe(seatIdOf("g"));
    await h.fireAlarm();
    expect((await storedMatch()).state.phase.kind).toBe("setup:chooseFirst");
    // Once ready, a repeated rematch reads nothing and changes nothing.
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(checks).toHaveLength(2);
  });

  it("takes a rematch whose session read the other seat's rematch overtook as its acceptance", async () => {
    const { host, guest } = await finishedMatch();
    const release = holdSessionRead();
    const first = h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await h.send(host, { kind: "rematch", from: seatIdOf("h") });
    expect(snapshotOf(guest)).toMatchObject({ phase: "selecting", guest: { ready: false } });
    release();
    await first;
    expect(snapshotOf(host)).toMatchObject({ phase: "countdown", guest: { ready: true } });
    expect(h.storage.data.get("nextChooser")).toBe(seatIdOf("g"));
  });

  it("refuses a late rematch from a signed-out seat as a rematch is refused", async () => {
    const { host, guest } = await finishedMatch();
    await h.send(host, { kind: "rematch", from: seatIdOf("h") });
    h.world.endedSessions.add(sessionIdOf("bo"));
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(guest.last("reject-action")).toEqual({
      kind: "reject-action",
      reason: "You're signed out. Sign in again to play another game.",
    });
    expect(guest.closed).toEqual({ code: 1008, reason: "session ended" });
    expect(snapshotOf(host)).toMatchObject({ phase: "selecting", guest: { ready: false } });
  });

  it("starts a rematch from the lobby as its session read left it: an opponent who left stays away", async () => {
    const { host, guest } = await finishedMatch();
    const release = holdSessionRead();
    const asked = h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    await h.send(host, { kind: "bye", from: seatIdOf("h"), slot: "host" });
    release();
    await asked;
    expect(snapshotOf(guest)).toMatchObject({
      phase: "selecting",
      host: { connected: false },
      guest: { ready: true },
    });
  });

  it("lets the rematch through when the session read fails, since the handoff re-checks", async () => {
    const { host, guest } = await finishedMatch();
    h.deps.liveSessions = async () => {
      throw new Error("D1_ERROR: network connection lost");
    };
    h.world.endedSessions.add(sessionIdOf("bo"));
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(logged("rematch_unchecked")).toMatchObject([{ cause: "session_lookup" }]);
    await readyUp(host, "h", "deck-ana");
    await readyUp(guest, "g", "deck-bo");
    await h.fireAlarm();
    expect(host.last("match-error")).toEqual({
      kind: "match-error",
      reason: "Bo: sign in again to play a saved deck.",
    });
    expect(matchKeys()).toEqual([]);
  });
});

describe("LobbyDO — bounded growth", () => {
  it("clips a long account name to the seat bound and drops a hello with an over-long id", async () => {
    h.world.displayNames.set("bo", "B".repeat(300));
    const { host } = await seatBoth();
    expect(snapshotOf(host).guest?.name).toBe("B".repeat(64));
    const stranger = await h.connect();
    await h.send(stranger, { kind: "hello", from: "x".repeat(65), name: "x" });
    expect(stranger.sent).toEqual([]);
  });

  it("keeps seat bindings only for the ids still seated", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    for (let i = 0; i < 20; i++) {
      // Paced within the socket's frame budget.
      h.world.now += 1000;
      await h.send(guest, hello(`g${i}`));
      await h.send(guest, { kind: "bye", from: seatIdOf(`g${i}`), slot: "guest" });
    }
    await h.send(guest, hello("g-last"));
    expect(h.storage.data.get("seatUsers")).toEqual({
      [seatIdOf("h")]: "ana",
      [seatIdOf("g-last")]: "bo",
    });
  });

  it("lets go of a socket that never answered a keepalive, so an empty lobby still expires", async () => {
    await h.create();
    const connectedAt = h.world.now;
    const host = await h.connect("ana");
    host.pings = false;
    await h.send(host, hello("h"));
    await fireAlarmsUntil(() => host.closed !== null);
    expect(host.closed).toEqual({ code: 1001, reason: "keepalive lost" });
    expect(h.world.now - connectedAt).toBeGreaterThan(
      SOCKET_SILENCE_MS + FIRST_KEEPALIVE_MARGIN_MS,
    );
    await fireAlarmsUntil(() => h.storage.data.size === 0);
  });

  it("starts the window of a socket attached before connection times were recorded at its first sweep", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    host.pings = false;
    host.serializeAttachment({ playerId: seatIdOf("h"), userId: "ana", displayName: "Ana" });
    h.hibernate();
    await h.fireAlarm();
    const firstSweep = h.world.now;
    expect(host.closed).toBeNull();
    await fireAlarmsUntil(() => host.closed !== null);
    expect(h.world.now - firstSweep).toBeGreaterThan(SOCKET_SILENCE_MS + FIRST_KEEPALIVE_MARGIN_MS);
  });
});

describe("LobbyDO — no-ops cost nothing", () => {
  it("writes, sends and schedules nothing for a repeated intent", async () => {
    const { host, guest } = await seatBoth();
    await readyUp(host, "h", "deck-ana");
    const writes = recordWrites();
    const frames = host.sent.length + guest.sent.length;
    for (let i = 0; i < 3; i++) {
      await readyUp(host, "h", "deck-ana");
    }
    expect(writes).toEqual([]);
    expect(host.sent.length + guest.sent.length).toBe(frames);
  });

  it("writes and sends nothing for an accepted action that changes nothing", async () => {
    const { host, guest } = await startedMatch();
    const [active, benched] = (await storedMatch()).state.players.p1.hand;
    await h.send(host, { kind: "action", action: { type: "setupPlaceActive", uid: active } });
    await h.send(host, { kind: "action", action: { type: "setupPlaceBench", uid: benched } });
    const writes = recordWrites();
    const frames = host.sent.length + guest.sent.length;
    for (let i = 0; i < 3; i++) {
      await h.send(host, {
        kind: "action",
        action: { type: "reorderBench", uid: benched, index: 0 },
      });
    }
    expect(host.framesOf("reject-action")).toEqual([]);
    expect(writes).toEqual([]);
    expect(host.sent.length + guest.sent.length).toBe(frames);
  });

  it("sets the alarm once for the countdown's handoff", async () => {
    await readiedLobby();
    const writes = recordWrites();
    await h.fireAlarm();
    expect(writes.filter((key) => key === "setAlarm")).toEqual(["setAlarm"]);
  });
});
