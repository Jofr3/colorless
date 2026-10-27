import {
  COUNTDOWN_MS,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyClientMessage,
  type LobbyIntent,
  type LobbyServerMessage,
  type LobbySnapshot,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  basicCard,
  createLobbyHarness,
  type FakeSocket,
  LEGAL_DECK,
  type LobbyHarness,
} from "./lobbyHarness";
import {
  ABANDON_GRACE_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  LIVENESS_SWEEP_MS,
  SOCKET_SILENCE_MS,
} from "./logic";
import { MATCH_RECORD_VERSION, type MatchRecord, matchFrameFor, readMatchRecord } from "./match";
import { MatchStore } from "./matchStore";

const DECK = [...LEGAL_DECK];
const STALE_REASON =
  "This match ended because the server was updated. Pick your decks and ready up to play again.";

let h: LobbyHarness;

beforeEach(() => {
  h = createLobbyHarness({
    seed: 42,
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

afterEach(() => h.dispose());

const hello = (from: string, name = `anon-${from}`): LobbyClientMessage => ({
  kind: "hello",
  from,
  name,
});

const intent = (from: string, change: LobbyIntent): LobbyClientMessage => ({
  kind: "intent",
  from,
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

/** Fire alarms until `done` holds, failing if the lobby stops scheduling them first. */
async function fireAlarmsUntil(done: () => boolean | Promise<boolean>, limit = 50): Promise<void> {
  for (let i = 0; i < limit && !(await done()); i++) await h.fireAlarm();
  if (!(await done())) throw new Error("condition never held");
}

describe("LobbyDO — create and seat", () => {
  it("refuses a socket for a code that was never created", async () => {
    await expect(h.connect("ana")).rejects.toThrow("upgrade refused with 404");
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

  it("refuses another account replaying a seat's player id", async () => {
    await seatBoth();
    const thief = await h.connect("eve");
    await h.send(thief, hello("h"));
    expect(thief.last("reject")).toEqual({ kind: "reject", to: "h", reason: "full" });
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
    expect(record.seed).toBe(42);
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

  it("lets a rematch's loser choose the play order", async () => {
    const { host, guest } = await startedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect((await storedMatch()).state.phase.kind).toBe("gameOver");
    await h.send(guest, { kind: "rematch", from: "g" });
    expect(snapshotOf(host).phase).toBe("selecting");
    expect(matchKeys()).toEqual([]);
    expect(h.storage.data.get("nextChooser")).toBe("g");

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

  it("lets a refused socket watch with the seatless view, but not act", async () => {
    await startedMatch();
    const watcher = await h.connect("eve");
    await h.send(watcher, hello("w"));
    const record = await storedMatch();
    expect(watcher.last("reject")).toEqual({ kind: "reject", to: "w", reason: "full" });
    expect(snapshotOf(watcher).phase).toBe("in-game");
    expect(watcher.last("match")).toEqual(matchFrameFor(record, "spectator"));

    await h.send(watcher, { kind: "action", action: { type: "concede" } });
    expect(await storedMatch()).toEqual(record);
  });
});

describe("LobbyDO — log deltas", () => {
  const deltaHello = (from: string): LobbyClientMessage => ({
    kind: "hello",
    from,
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
    await h.send(guest, { kind: "bye", from: "g", slot: "guest" });
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

  it("gives a spectator the full log on arrival and deltas after", async () => {
    const { guest } = await mixedMatch();
    const watcher = await h.connect("eve");
    await h.send(watcher, deltaHello("w"));
    const start = await storedMatch();
    expect(watcher.last("match")).toEqual(matchFrameFor(start, "spectator"));
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(watcher.last("match")).toEqual(
      matchFrameFor(await storedMatch(), "spectator", start.log.length),
    );
  });

  it("starts a rematch with the full log", async () => {
    const { host, guest } = await mixedMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    await h.send(guest, { kind: "rematch", from: "g" });
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

    const emptiedAt = h.world.now;
    await h.drop(host);
    await fireAlarmsUntil(() => h.storage.data.size === 0);
    expect(h.storage.alarm).toBeNull();
    expect(h.world.now).toBe(emptiedAt + EMPTY_LOBBY_TTL_MS);
    expect((await h.create()).status).toBe(201);
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

  it("closes a socket that stopped answering keepalives and starts its grace", async () => {
    const { host, guest } = await startedMatch();
    guest.lastPong = new Date(h.world.now);
    host.lastPong = new Date(h.world.now + LIVENESS_SWEEP_MS);
    await fireAlarmsUntil(() => guest.closed !== null);
    expect(h.world.now - guest.lastPong.getTime()).toBeGreaterThan(SOCKET_SILENCE_MS);
    expect(guest.closed).toEqual({ code: 1001, reason: "keepalive lost" });
    expect(host.closed).toBeNull();
    expect(h.storage.data.get("pendingDisconnects")).toEqual([
      { playerId: "g", deadline: h.world.now + DISCONNECT_GRACE_MS },
    ]);
  });
});

describe("LobbyDO — stale records", () => {
  async function staleMatch() {
    const seated = await startedMatch();
    await h.storage.put("match", { ...(await storedMatch()), version: MATCH_RECORD_VERSION + 1 });
    h.hibernate();
    return seated;
  }

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
  });

  it("retires an unreadable record when a player acts", async () => {
    const { guest } = await staleMatch();
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    expect(matchKeys()).toEqual([]);
    expect(snapshotOf(guest).phase).toBe("selecting");
    expect(guest.last("match-error")).toEqual({ kind: "match-error", reason: STALE_REASON });
  });
});
