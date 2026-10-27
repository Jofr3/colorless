import { drbgSeed } from "@colorless/engine/testing";
// The lobby abuse harness (security audit, Phase 0). Each case measures what one abusive client
// costs the lobby, in storage writes, alarms, sockets and frames, and asserts the number. The
// Phase 0 baselines were changed on purpose by the fix their finding id names (LB1, LB2, LB3, MI2
// and MIX2 in Phase 3), and each such case says what the number was.

import { LOBBY_WS_CLOSED, type LobbyClientMessage, type LobbyIntent } from "@colorless/schema";
import type { GameState } from "@colorless/engine";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import {
  createLobbyHarness,
  type FakeSocket,
  LEGAL_DECK,
  type LobbyHarness,
  seatIdOf,
  seatSecret,
  sessionIdOf,
} from "./lobbyHarness";
import {
  DISCONNECT_GRACE_MS,
  FRAME_BURST,
  FRAME_MAX_CHARS,
  FRAME_REFILL_PER_SECOND,
  INACTIVE_LOBBY_MS,
  LIVENESS_SWEEP_MS,
  LOBBY_SOCKET_CAP,
  LOBBY_SOCKET_HARD_CAP,
  OVERFLOW_HELLO_MS,
  OVERFLOW_SOCKETS_MAX,
} from "./logic";
import { MATCH_LOG_KEPT, MATCH_LOG_MAX, type MatchRecord, readMatchRecord } from "./match";
import { LOG_CHUNK, MatchStore } from "./matchStore";

let h: LobbyHarness;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  h = createLobbyHarness({
    seed: drbgSeed(42),
    displayNames: new Map([
      ["ana", "Ana"],
      ["bo", "Bo"],
      ["vic", "Vic"],
    ]),
    decks: new Map([
      ["deck-ana", { owner: "ana", ids: [...LEGAL_DECK] }],
      ["deck-bo", { owner: "bo", ids: [...LEGAL_DECK] }],
      ["deck-vic", { owner: "vic", ids: [...LEGAL_DECK] }],
    ]),
  });
});

afterEach(() => {
  h.dispose();
  vi.restoreAllMocks();
  resetLogThrottle();
});

/** The fields of every `lobby` log line of `kind` written so far. */
function logged(kind: string): Record<string, unknown>[] {
  return warn.mock.calls
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

/** A deck pick that differs from the one before it, so every such intent is a lobby commit. */
const pick = (i: number): LobbyIntent => ({
  type: "select-deck",
  deckId: "deck-x",
  deckName: i % 2 ? "b" : "a",
});

/** Storage operations from now on, as the Free plan bills them: every key put, key deleted and
    alarm set or cleared is a row written. */
function countWrites() {
  const counts = { puts: 0, keys: 0, deletes: 0, alarms: 0 };
  const storage = h.storage;
  const put = storage.put.bind(storage);
  const remove = storage.delete.bind(storage) as (keys: string | string[]) => Promise<unknown>;
  const deleteAll = storage.deleteAll.bind(storage);
  const setAlarm = storage.setAlarm.bind(storage);
  const deleteAlarm = storage.deleteAlarm.bind(storage);
  storage.put = async (key, value) => {
    counts.puts++;
    counts.keys += typeof key === "string" ? 1 : Object.keys(key).length;
    await put(key, value);
  };
  storage.delete = (async (keys: string | string[]) => {
    counts.deletes += Array.isArray(keys) ? keys.length : 1;
    return remove(keys);
  }) as typeof storage.delete;
  storage.deleteAll = async () => {
    counts.deletes += storage.data.size;
    await deleteAll();
  };
  storage.setAlarm = async (at) => {
    counts.alarms++;
    await setAlarm(at);
  };
  storage.deleteAlarm = async () => {
    counts.alarms++;
    await deleteAlarm();
  };
  return counts;
}

async function storedState(): Promise<GameState> {
  return storedRecord().then((record) => record.state);
}

async function storedRecord(): Promise<MatchRecord> {
  const record = readMatchRecord(await new MatchStore(h.storage).get());
  if (record === null) throw new Error("no readable match record");
  return record;
}

/** A started match past setup, on the turn-1 player's action phase. Every deck is all Basics, so
    each seat places an Active and a full Bench. */
async function matchInTurnOne() {
  await h.create();
  const host = await h.connect("ana");
  await h.send(host, hello("h"));
  const guest = await h.connect("bo");
  await h.send(guest, hello("g"));
  for (const [ws, from, deckId] of [
    [host, "h", "deck-ana"],
    [guest, "g", "deck-bo"],
  ] as const) {
    await h.send(ws, intent(from, { type: "select-deck", deckId, deckName: deckId }));
    await h.send(ws, intent(from, { type: "set-ready", ready: true }));
  }
  await h.fireAlarm();
  const sockets = { p1: host, p2: guest } as const;
  for (const seat of ["p1", "p2"] as const) {
    const [active, ...rest] = (await storedState()).players[seat].hand;
    await h.send(sockets[seat], {
      kind: "action",
      action: { type: "setupPlaceActive", uid: active },
    });
    for (const uid of rest.slice(0, 5))
      await h.send(sockets[seat], { kind: "action", action: { type: "setupPlaceBench", uid } });
  }
  for (const seat of ["p1", "p2"] as const)
    await h.send(sockets[seat], { kind: "action", action: { type: "setupReady" } });
  const state = await storedState();
  if (state.phase.kind !== "turn:action" || state.turn !== 1) throw new Error("expected turn 1");
  const actor = state.phase.seat;
  return { host, guest, actor, actorSocket: sockets[actor] };
}

describe("lobby abuse — frames (LB1, MI2)", () => {
  it("LB1: a socket past its frame budget is closed (1008) and its seat goes through the grace", async () => {
    await h.create();
    const ws = await h.connect();
    await h.send(ws, hello("attacker"));
    const writes = countWrites();
    const frames = 200;
    let processed = 0;
    for (let i = 0; i < frames; i++) {
      h.world.now += 1;
      const before = h.storage.data.get("snapshot");
      await h.send(ws, intent("attacker", pick(i)));
      if (h.storage.data.get("snapshot") !== before) processed++;
    }
    // Was: 200 snapshot puts and 200 alarms (2 rows a frame), and the socket never closed. Now the
    // hello spent one token of the burst, the next 39 frames are written (39ms refill less than
    // one more), and the frame after them closes the socket. The alarm the hello armed is due
    // first, so no frame re-sets it.
    expect(processed).toBe(FRAME_BURST - 1);
    expect(ws.closed).toEqual({ code: 1008, reason: "too many messages" });
    // The close is a dropped link: the seat's grace and the empty lobby's expiry are written, and
    // the alarm is brought forward to the grace.
    expect(writes).toEqual({ puts: FRAME_BURST + 1, keys: FRAME_BURST + 1, deletes: 0, alarms: 1 });
    expect(await h.storage.get("pendingDisconnects")).toEqual([
      {
        playerId: seatIdOf("attacker"),
        deadline: h.world.now - (frames - FRAME_BURST) + DISCONNECT_GRACE_MS,
      },
    ]);
    // One line for the socket, never one per frame (LB8): the hello and the 39 frames it paid
    // for, then the one that closed it, 40ms after the upgrade.
    expect(logged("socket_closed")).toEqual([
      {
        evt: "lobby",
        kind: "socket_closed",
        lobby: "ABCD",
        cause: "frame_rate",
        code: 1008,
        frames: FRAME_BURST + 1,
        chars: JSON.stringify(intent("attacker", pick(frames))).length,
        seated: true,
        ageMs: FRAME_BURST,
      },
    ]);
  });

  it("LB1: commits a player paces re-arm the alarm only once the armed one is due", async () => {
    await h.create();
    const ws = await h.connect();
    await h.send(ws, hello("host"));
    const writes = countWrites();
    for (let i = 0; i < 60; i++) {
      h.world.now += 1000;
      await h.send(ws, intent("host", pick(i)));
    }
    // Was one alarm per commit. Each commit pushes the liveness deadline 30s on, and the armed
    // alarm, due sooner, is kept until it is due: a minute of commits sets it twice.
    expect(writes).toEqual({ puts: 60, keys: 60, deletes: 0, alarms: 2 });
    expect(ws.closed).toBeNull();
  });

  it("LB1: an oversized frame closes the socket (1009); junk spends the budget like any frame", async () => {
    await h.create();
    const big = await h.connect();
    await h.send(big, hello("big"));
    await h.send(big, "x".repeat(FRAME_MAX_CHARS));
    expect(big.closed).toBeNull();
    await h.send(big, "x".repeat(FRAME_MAX_CHARS + 1));
    expect(big.closed).toEqual({ code: 1009, reason: "message too big" });
    expect(logged("socket_closed")).toMatchObject([
      { cause: "frame_size", code: 1009, frames: 3, chars: FRAME_MAX_CHARS + 1, seated: true },
    ]);

    const junk = await h.connect();
    for (let i = 0; i < FRAME_BURST; i++) await h.send(junk, "not json");
    expect(junk.closed).toBeNull();
    await h.send(junk, "not json");
    expect(junk.closed).toEqual({ code: 1008, reason: "too many messages" });
    // Frames still in flight from a closed socket are dropped unread.
    await h.send(junk, hello("late"));
    expect(h.storage.data.get("snapshot")).toMatchObject({
      host: { id: seatIdOf("big") },
      guest: null,
    });
  });

  it("LB1: the largest legitimate frame, an action over a whole deck, fits the cap twice over", async () => {
    const { actorSocket, actor } = await matchInTurnOne();
    const deck = Array.from({ length: 60 }, (_, i) => `${actor}#${i}`);
    const assignments = deck.map((uid, i) => ({
      uid,
      to: { seat: actor, spot: { spot: "bench", index: i % 5 } },
    }));
    const action: LobbyClientMessage = {
      kind: "action",
      action: { type: "resolveEffect", choice: { kind: "attachCards", assignments } },
    };
    const longHello = hello("x".repeat(64), "y".repeat(64));
    for (const frame of [action, longHello]) {
      expect(JSON.stringify(frame).length).toBeLessThan(FRAME_MAX_CHARS / 2);
    }
    h.world.now += 1000;
    await h.send(actorSocket, action);
    expect(actorSocket.closed).toBeNull();
    expect(actorSocket.framesOf("reject-action")).toHaveLength(1);
  });

  it("LB1 (MI2): a paced bench reorder is one match write and a frame per socket; a loop is closed", async () => {
    const { host, guest, actor, actorSocket } = await matchInTurnOne();
    const before = await storedRecord();
    const writes = countWrites();
    const frames = host.sent.length + guest.sent.length;
    const reorder = async () => {
      const bench = (await storedState()).players[actor].bench;
      const uid = bench[0]?.stack[0];
      await h.send(actorSocket, {
        kind: "action",
        action: { type: "reorderBench", uid, index: 1 },
      });
    };
    const actions = 100;
    for (let i = 0; i < actions; i++) {
      h.world.now += 1000 / FRAME_REFILL_PER_SECOND;
      await reorder();
    }
    // Each accepted reorder costs what it did (one match head put, no alarm, one frame to each
    // socket); the budget is what bounds how many a socket can send.
    expect(writes).toEqual({ puts: actions, keys: actions, deletes: 0, alarms: 0 });
    expect(host.sent.length + guest.sent.length - frames).toBe(2 * actions);
    expect(actorSocket.framesOf("reject-action")).toEqual([]);
    expect((await storedRecord()).log.length).toBe(before.log.length);

    // Unpaced, the loop is closed once the burst is spent.
    const puts = writes.puts;
    for (let i = 0; i < actions && actorSocket.closed === null; i++) await reorder();
    expect(actorSocket.closed).toEqual({ code: 1008, reason: "too many messages" });
    expect(writes.puts - puts).toBeLessThanOrEqual(FRAME_BURST);
  });
});

describe("lobby abuse — crafted actions (MI3)", () => {
  it("MI3: a turn-1 attack whose index names an array member is refused, not thrown", async () => {
    const { actorSocket } = await matchInTurnOne();
    const before = await storedRecord();
    for (const index of ["__proto__", "constructor", "length"]) {
      await h.send(actorSocket, { kind: "action", action: { type: "attack", index } });
    }
    expect(actorSocket.framesOf("reject-action")).toHaveLength(3);
    expect(await storedRecord()).toEqual(before);
    expect(logged("action_threw")).toEqual([]);
  });

  it("MI3: an engine throw is refused like any move and logged, throttled", async () => {
    const { actorSocket } = await matchInTurnOne();
    // A record whose state the engine cannot read stands in for any input that breaks its
    // totality contract. It passes the record gate, which checks only the top level.
    const record = await storedRecord();
    const broken = { ...record, state: { ...record.state, players: {} } } as MatchRecord;
    await new MatchStore(h.storage).put(broken);
    h.hibernate();
    for (let i = 0; i < 2; i++)
      await h.send(actorSocket, { kind: "action", action: { type: "endTurn" } });
    expect(actorSocket.framesOf("reject-action")).toEqual([
      { kind: "reject-action", reason: "That move isn't available here." },
      { kind: "reject-action", reason: "That move isn't available here." },
    ]);
    expect(logged("action_threw")).toEqual([
      {
        evt: "lobby",
        kind: "action_threw",
        lobby: "ABCD",
        type: "endTurn",
        error: expect.stringMatching(/^TypeError: /),
      },
    ]);
  });
});

describe("lobby abuse — sockets and lifetime (LB2, LB3)", () => {
  /** Open `count` sockets, signed in as `userId` or not, counting the refused upgrades. */
  async function connectMany(count: number, userId?: string) {
    const accepted: FakeSocket[] = [];
    let refused = 0;
    for (let i = 0; i < count; i++) {
      try {
        accepted.push(await h.connect(userId));
      } catch (error) {
        expect(String(error)).toContain("upgrade refused with 503");
        refused++;
      }
    }
    return { accepted, refused };
  }

  it("LB2: a lobby holds 12 sockets, turns 4 more away as full, and refuses the rest", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const { accepted, refused } = await connectMany(100);
    // Was: every one of 100 accepted, and every lurker sent every state frame.
    expect(h.state.getWebSockets()).toHaveLength(LOBBY_SOCKET_CAP + OVERFLOW_SOCKETS_MAX);
    expect(refused).toBe(100 - (LOBBY_SOCKET_CAP - 1) - OVERFLOW_SOCKETS_MAX);
    const members = accepted.slice(0, LOBBY_SOCKET_CAP - 1);
    const overflow = accepted.slice(LOBBY_SOCKET_CAP - 1);
    await h.send(host, intent("h", pick(1)));
    expect(members.every((ws) => ws.last("state")?.snapshot.host.deckName === "b")).toBe(true);
    expect(overflow.every((ws) => ws.sent.length === 0)).toBe(true);

    // A turned-away socket's hello is answered "full", which the client shows as a full lobby.
    const [asks, ...silent] = overflow;
    if (asks === undefined) throw new Error("no overflow socket");
    await h.send(asks, hello("watcher", "Watcher"));
    expect(asks.sent).toEqual([{ kind: "reject", to: seatIdOf("watcher"), reason: "full" }]);
    expect(asks.closed).toEqual({ code: 1013, reason: "lobby full" });
    expect(logged("overflow_closed")).toMatchObject([
      { cause: "turned_away", code: 1013, sockets: 1 },
    ]);
    // One that never says hello is let go at the next sweep, in one line for all of them.
    resetLogThrottle();
    h.world.now += OVERFLOW_HELLO_MS + 1;
    await h.fireAlarm();
    expect(silent.every((ws) => ws.closed?.code === 1013)).toBe(true);
    expect(logged("overflow_closed").slice(1)).toMatchObject([
      { cause: "no_hello", code: 1013, sockets: silent.length },
    ]);
    expect(members.every((ws) => ws.closed === null)).toBe(true);
    expect(logged("ws_refused")[0]).toMatchObject({ cause: "lobby_full" });
  });

  it("LB2: a full lobby still lets a seated account back in, up to the hard cap", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    await connectMany(LOBBY_SOCKET_CAP - 1);
    const reload = await h.connect("ana");
    await h.send(reload, hello("h"));
    expect(reload.last("state")?.snapshot.host).toMatchObject({
      id: seatIdOf("h"),
      connected: true,
    });
    // Another account is turned away; the seat's own account fills up to the hard cap only.
    const stranger = await h.connect("bo");
    await h.send(stranger, hello("g"));
    expect(stranger.last("reject")).toEqual({ kind: "reject", to: seatIdOf("g"), reason: "full" });
    const { accepted, refused } = await connectMany(10, "ana");
    expect(accepted).toHaveLength(LOBBY_SOCKET_HARD_CAP - LOBBY_SOCKET_CAP - 1);
    expect(refused).toBe(10 - accepted.length);
  });

  it("LB2: spectators are capped, and each distinct match frame is built once per broadcast", async () => {
    const { host, guest, actor, actorSocket } = await matchInTurnOne();
    const watchers: FakeSocket[] = [];
    for (let i = 0; i < 20; i++) {
      const ws = await h.connect();
      await h.send(ws, hello(`watcher-${String(i)}`));
      watchers.push(ws);
    }
    const spectators = watchers.filter((ws) => ws.framesOf("match").length > 0);
    const turnedAway = watchers.filter((ws) => ws.closed !== null);
    // Was: all 20 watched. Now the two seats and ten spectators fill the cap, and the rest are
    // answered "full" and closed.
    expect(spectators).toHaveLength(LOBBY_SOCKET_CAP - 2);
    expect(turnedAway).toHaveLength(20 - spectators.length);
    expect(turnedAway.every((ws) => ws.last("reject")?.reason === "full")).toBe(true);
    expect(turnedAway.every((ws) => ws.closed?.code === 1013)).toBe(true);

    const sockets = [host, guest, ...spectators];
    const before = sockets.map((ws) => ws.framesOf("match").length);
    const uid = (await storedState()).players[actor].bench[0]?.stack[0];
    const stringify = vi.spyOn(JSON, "stringify");
    await h.send(actorSocket, { kind: "action", action: { type: "reorderBench", uid, index: 1 } });
    const sent = sockets.map((ws, i) => ws.framesOf("match").length - (before[i] ?? 0));
    expect(sent).toEqual(sockets.map(() => 1));
    // Was one redaction and encoding per socket (12 here). Now one per distinct frame: each seat's
    // delta and the spectators' shared one, plus the harness encoding the action it sends.
    expect(stringify).toHaveBeenCalledTimes(1 + 3);
    stringify.mockRestore();
  });

  it("LB2: a lobby an idle pinging socket holds is closed and wiped after an hour", async () => {
    await h.create();
    const createdAt = h.world.now;
    const ws = await h.connect();
    const writes = countWrites();
    let wakes = 0;
    while (ws.closed === null && wakes < 200) {
      await h.fireAlarm();
      wakes++;
    }
    // Was: never closed or wiped, one alarm write every 30s. Now the sweep that finds an hour
    // without a commit closes the socket for good and wipes the lobby, freeing the code.
    expect(ws.closed).toEqual({
      code: LOBBY_WS_CLOSED,
      reason: "lobby closed after an hour without play",
    });
    expect(h.world.now - createdAt).toBe(INACTIVE_LOBBY_MS);
    expect(wakes).toBe(INACTIVE_LOBBY_MS / LIVENESS_SWEEP_MS);
    expect(h.storage.data.size).toBe(0);
    expect(h.storage.alarm).toBeNull();
    expect(writes).toEqual({ puts: 0, keys: 0, deletes: 2, alarms: wakes - 1 });
    expect(logged("lobby_wiped")).toMatchObject([{ cause: "inactive", sockets: 1, inGame: false }]);
    await expect(h.connect()).rejects.toThrow("upgrade refused with 404");
  });

  it("LB2: play keeps a lobby open past the hour, stamping its activity every few minutes", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const writes = countWrites();
    const minutes = 3 * 60;
    for (let minute = 1; minute <= minutes; minute++) {
      for (let sweep = 0; sweep < 2; sweep++) await h.fireAlarm();
      if (minute % 10 === 0) {
        await h.send(host, intent("h", pick(minute / 10)));
      }
    }
    expect(host.closed).toBeNull();
    expect(await h.storage.get("activeAt")).toBe(h.world.now);
    // Commits ten minutes apart each write a stamp beside the snapshot; commits closer together
    // than ACTIVITY_STAMP_MS share one.
    expect(writes.puts).toBe(2 * (minutes / 10));
  });

  it("LB2: a seated hello counts as activity, so a lobby older than the ceiling survives a deploy", async () => {
    // A lobby from before the activity stamp existed, its sockets dropped by the deploy.
    await h.create();
    h.world.now += 2 * INACTIVE_LOBBY_MS;
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    await h.fireAlarm();
    expect(host.closed).toBeNull();
    expect(await h.storage.get("activeAt")).toBe(h.world.now - LIVENESS_SWEEP_MS);
  });

  it("LB3: a lobby that is created and never entered costs these writes through its wipe", async () => {
    const writes = countWrites();
    await h.create();
    const atCreate = { ...writes };
    await h.fireAlarm();
    // Was: create also wrote `cleanupAt` (3 keys and an alarm), and the wipe deleted 3 keys and
    // cleared the alarm: 8 rows. Now the expiry is derived from `created` and the spent alarm is
    // not cleared: 5 rows.
    expect(atCreate).toEqual({ puts: 1, keys: 2, deletes: 0, alarms: 1 });
    expect(writes).toEqual({ puts: 1, keys: 2, deletes: 2, alarms: 1 });
    expect(h.storage.data.size).toBe(0);
  });
});

describe("lobby abuse — the match log (MIX2)", () => {
  it("MIX2: a log past its cap is trimmed behind a marker and sent whole, and its old chunks go", async () => {
    const { host, guest, actorSocket } = await matchInTurnOne();
    for (const [ws, from] of [
      [host, "h"],
      [guest, "g"],
    ] as const) {
      await h.send(ws, { kind: "hello", from, name: `anon-${from}`, logDeltas: true });
    }
    const record = await storedRecord();
    const filler = Array.from({ length: MATCH_LOG_MAX - record.log.length }, () => ({
      kind: "turn" as const,
      turn: 1,
    }));
    await new MatchStore(h.storage).put({ ...record, log: [...record.log, ...filler] });
    h.hibernate();
    const chunks = () => [...h.storage.data.keys()].filter((key) => key.startsWith("matchLog:"));
    expect(chunks()).toHaveLength(Math.ceil(MATCH_LOG_MAX / LOG_CHUNK));

    await h.send(actorSocket, { kind: "action", action: { type: "endTurn" } });
    const trimmed = (await storedRecord()).log;
    expect(trimmed).toHaveLength(MATCH_LOG_KEPT + 1);
    expect(trimmed[0]).toMatchObject({
      who: "system",
      segments: [{ text: "Earlier log entries were trimmed." }],
    });
    expect(chunks()).toHaveLength(Math.ceil((MATCH_LOG_KEPT + 1) / LOG_CHUNK));
    for (const ws of [host, guest]) {
      const frame = ws.last("match");
      expect(frame?.logFrom).toBeUndefined();
      expect(frame?.log).toEqual(trimmed);
    }
    // The next action continues the trimmed log as a delta.
    const next = (await storedState()).phase;
    if (next.kind !== "turn:action") throw new Error("expected the next turn");
    await h.send(next.seat === "p1" ? host : guest, {
      kind: "action",
      action: { type: "endTurn" },
    });
    expect(host.last("match")?.logFrom).toBe(MATCH_LOG_KEPT + 1);
  });
});

describe("lobby abuse — a socket left on a seat that is then bound (LBX1)", () => {
  /** The guest joins signed out as `vic-id`, a second anonymous socket presents that seat's
      secret too (a copy of the tab's storage: since LB6 a snapshot no longer hands it out), and
      the guest then signs in, which binds the seat to their account. */
  async function shadowedGuest() {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const signedOut = await h.connect();
    await h.send(signedOut, hello("vic-id", "Vic"));
    const shadow = await h.connect();
    await h.send(shadow, hello("vic-id", "Evil"));
    await h.drop(signedOut);
    const victim = await h.connect("vic");
    await h.send(victim, hello("vic-id", "Vic"));
    expect(await h.storage.get("seatUsers")).toEqual({
      [seatIdOf("h")]: "ana",
      [seatIdOf("vic-id")]: "vic",
    });
    return { host, shadow, victim };
  }

  it("LBX1: binding the seat closes the shadow socket and keeps the guest seated", async () => {
    const { host, shadow, victim } = await shadowedGuest();
    expect(shadow.closed).toEqual({ code: 1008, reason: "seat claimed by an account" });
    expect(victim.closed).toBeNull();
    expect(host.last("state")?.snapshot.guest).toMatchObject({
      id: seatIdOf("vic-id"),
      connected: true,
    });
    expect(await h.storage.get("pendingDisconnects")).toBeUndefined();
    expect(logged("seat_evicted")).toEqual([
      { evt: "lobby", kind: "seat_evicted", lobby: "ABCD", sockets: 1 },
    ]);
  });

  it("LBX1: the evicted socket cannot walk the bound guest out or change their deck", async () => {
    const { host, shadow, victim } = await shadowedGuest();
    await h.send(shadow, { kind: "bye", from: seatIdOf("vic-id"), slot: "guest" });
    await h.send(
      shadow,
      intent("vic-id", { type: "select-deck", deckId: "deck-ana", deckName: "x" }),
    );
    expect(host.last("state")?.snapshot.guest).toMatchObject({
      id: seatIdOf("vic-id"),
      hasDeck: false,
    });
    expect(victim.closed).toBeNull();
  });

  it("LBX1: the account's own second socket on the seat is not evicted", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const signedOut = await h.connect();
    await h.send(signedOut, hello("vic-id", "Vic"));
    const reload = await h.connect("vic");
    await h.send(reload, hello("vic-id"));
    const tab = await h.connect("vic");
    await h.send(tab, hello("vic-id"));
    expect(signedOut.closed).not.toBeNull();
    expect(reload.closed).toBeNull();
    expect(tab.closed).toBeNull();
  });

  it("LBX1: a socket left on a bound seat neither acts for it nor sees its hand", async () => {
    // A shadow that outlived the bind, as one attached before eviction existed would: the binding
    // is written straight to storage, so the victim's hello binds nothing and evicts nothing.
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const shadow = await h.connect();
    await h.send(shadow, hello("vic-id", "Evil"));
    await h.storage.put("seatUsers", { [seatIdOf("h")]: "ana", [seatIdOf("vic-id")]: "vic" });
    h.hibernate();
    const victim = await h.connect("vic");
    await h.send(victim, hello("vic-id", "Vic"));
    expect(shadow.closed).toBeNull();

    await h.send(
      shadow,
      intent("vic-id", { type: "select-deck", deckId: "deck-x", deckName: "x" }),
    );
    await h.send(shadow, intent("vic-id", { type: "set-ready", ready: true }));
    expect(host.last("state")?.snapshot.guest).toMatchObject({ hasDeck: false, ready: false });
    for (const [ws, from, deckId] of [
      [host, "h", "deck-ana"],
      [victim, "vic-id", "deck-vic"],
    ] as const) {
      await h.send(ws, intent(from, { type: "select-deck", deckId, deckName: deckId }));
      await h.send(ws, intent(from, { type: "set-ready", ready: true }));
    }
    // The shadow is first in acceptance order, yet the victim's deck loads as the victim's.
    await h.fireAlarm();
    expect(host.last("state")?.snapshot.phase).toBe("in-game");
    expect(victim.last("match")?.game.seat).toBe("p2");
    expect(shadow.framesOf("match")).toEqual([]);

    const before = await storedRecord();
    await h.send(shadow, { kind: "action", action: { type: "concede" } });
    await h.send(shadow, { kind: "rematch", from: seatIdOf("vic-id") });
    await h.send(shadow, { kind: "bye", from: seatIdOf("vic-id"), slot: "guest" });
    expect(await storedRecord()).toEqual(before);
    expect(host.last("state")?.snapshot.guest).toMatchObject({
      id: seatIdOf("vic-id"),
      connected: true,
    });
    expect(shadow.framesOf("match")).toEqual([]);
  });

  it("LBX1: a shadow on the host's seat cannot kick the guest", async () => {
    await h.create();
    const shadow = await h.connect();
    await h.send(shadow, hello("h", "Evil"));
    await h.storage.put("seatUsers", { [seatIdOf("h")]: "ana" });
    h.hibernate();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));
    await h.send(shadow, { kind: "reject", to: seatIdOf("g"), reason: "kicked" });
    expect(host.last("state")?.snapshot.guest?.id).toBe(seatIdOf("g"));
    expect(guest.framesOf("reject")).toEqual([]);
  });
});

describe("lobby abuse — names that forge client bridge commands (WC1)", () => {
  const FORGED = "x\nCOLORLESS:auth:open\tdelete\nCOLORLESS:auth:submit\n\u202e";
  const CLEAN = "xCOLORLESS:auth:opendeleteCOLORLESS:auth:submit";

  /** Every string in `value`, at any depth. */
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value !== "object" || value === null) return [];
    return Object.values(value).flatMap(strings);
  }

  it("WC1: no name reaches another socket with a control or format character", async () => {
    // A legacy account name from before the account schemas refused them.
    h.world.displayNames.set("mal", `Mal${FORGED}`);
    h.world.decks.set("deck-mal", { owner: "mal", ids: [...LEGAL_DECK] });
    await h.create();
    const victim = await h.connect("vic");
    await h.send(victim, hello("h"));
    const spectator = await h.connect();

    const anon = await h.connect();
    await h.send(anon, hello("g1", FORGED));
    expect(victim.last("state")?.snapshot.guest?.name).toBe(CLEAN);
    await h.send(anon, intent("g1", { type: "select-deck", deckId: "deck-x", deckName: FORGED }));
    expect(victim.last("state")?.snapshot.guest).toMatchObject({ name: CLEAN, deckName: CLEAN });
    await h.send(anon, { kind: "bye", from: seatIdOf("g1"), slot: "guest" });

    const mal = await h.connect("mal");
    await h.send(mal, hello("g2", FORGED));
    expect(victim.last("state")?.snapshot.guest?.name).toBe(`Mal${CLEAN}`);
    for (const [ws, from, deckId] of [
      [victim, "h", "deck-vic"],
      [mal, "g2", "deck-mal"],
    ] as const) {
      await h.send(ws, intent(from, { type: "select-deck", deckId, deckName: FORGED }));
      await h.send(ws, intent(from, { type: "set-ready", ready: true }));
    }
    await h.fireAlarm();
    await h.send(mal, { kind: "action", action: { type: "concede" } });
    await h.send(spectator, hello("watcher"));

    expect(victim.framesOf("match").length).toBeGreaterThan(0);
    expect(spectator.framesOf("match").length).toBeGreaterThan(0);
    const seen = [...victim.sent, ...spectator.sent].flatMap(strings);
    expect(seen.filter((text) => /[\p{Cc}\p{Cf}]/u.test(text))).toEqual([]);
    expect(seen.some((text) => text.includes(`Mal${CLEAN}`))).toBe(true);
  });
});

describe("lobby abuse — what a snapshot gives away (LB5, LB6)", () => {
  /** Everything a socket was sent, as the text it went out as. */
  const wire = (ws: FakeSocket) => ws.sent.map((frame) => JSON.stringify(frame)).join("\n");

  it("LB5, LB6: no frame carries a deck id or a seat secret, to an opponent, a spectator or a lurker", async () => {
    await h.create();
    const lurker = await h.connect();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));
    for (const [ws, from, deckId] of [
      [host, "h", "deck-ana"],
      [guest, "g", "deck-bo"],
    ] as const) {
      await h.send(ws, intent(from, { type: "select-deck", deckId, deckName: `${from}'s list` }));
      await h.send(ws, intent(from, { type: "set-ready", ready: true }));
    }
    await h.fireAlarm();
    expect(host.last("state")?.snapshot.phase).toBe("in-game");
    const spectator = await h.connect("eve");
    await h.send(spectator, hello("w"));
    expect(spectator.framesOf("match").length).toBeGreaterThan(0);
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });

    // Was: every state frame carried both seats' deck ids, and the public id a hello claims with.
    const hidden = ["deck-ana", "deck-bo", seatSecret("h"), seatSecret("g")];
    for (const ws of [host, guest, spectator, lurker]) {
      expect(ws.sent.length).toBeGreaterThan(0);
      const text = wire(ws);
      expect(hidden.filter((value) => text.includes(value))).toEqual([]);
    }
    // A pick shows as made, under its name; the DO keeps the id it reads the deck with.
    expect(lurker.last("state")?.snapshot.guest).toMatchObject({
      id: seatIdOf("g"),
      hasDeck: true,
      deckName: "g's list",
    });
    expect(h.storage.data.get("snapshot")).toMatchObject({
      host: { deckId: "deck-ana" },
      guest: { deckId: "deck-bo" },
    });
  });

  it("LB6: a seat's public id, read off a snapshot, neither claims the seat nor binds it", async () => {
    // Two anonymous seats, which no account guards: the secret is all that claims them.
    await h.create();
    const host = await h.connect();
    await h.send(host, hello("h", "Host"));
    const guest = await h.connect();
    await h.send(guest, hello("g", "Guest"));
    const seen = host.last("state")?.snapshot;
    if (seen?.guest == null) throw new Error("no seated guest");
    const hostId = seen.host.id;
    const guestId = seen.guest.id;

    // Was: a signed-in intruder's hello with the guest's id took the seat and bound it to the
    // intruder's account (LB-hijack), and one with the host's id re-seated it (LB-anon-host).
    const intruder = await h.connect("eve");
    for (const id of [hostId, guestId]) {
      await h.send(intruder, { kind: "hello", from: id, name: "Evil" });
      expect(intruder.last("reject")).toEqual({ kind: "reject", to: id, reason: "full" });
    }
    // A secret of its own names a seat of its own, which the held guest seat refuses.
    await h.send(intruder, hello("eve"));
    expect(intruder.last("reject")).toEqual({
      kind: "reject",
      to: seatIdOf("eve"),
      reason: "full",
    });
    // No hello seated it, so it acts for neither seat.
    await h.send(intruder, { kind: "reject", to: guestId, reason: "kicked" });
    await h.send(intruder, {
      kind: "intent",
      from: guestId,
      intent: { type: "select-deck", deckId: "deck-eve", deckName: "X" },
    });
    await h.send(intruder, { kind: "bye", from: hostId, slot: "host" });

    const after = host.last("state")?.snapshot;
    expect(after?.host).toMatchObject({ id: hostId, name: "Host", connected: true });
    expect(after?.guest).toMatchObject({ id: guestId, name: "Guest", connected: true });
    expect(guest.framesOf("reject")).toEqual([]);
    expect(h.storage.data.has("seatUsers")).toBe(false);
    expect(logged("hello_refused")[0]).toMatchObject({ cause: "credential" });

    // The guest's own secret still seats it, and binds it to the account it signs in with.
    const signedIn = await h.connect("bo");
    await h.send(signedIn, hello("g", "Guest"));
    expect(signedIn.framesOf("reject")).toEqual([]);
    expect(h.storage.data.get("seatUsers")).toEqual({ [guestId]: "bo" });
  });

  it("LB6: a client from before the split is answered full and holds nothing", async () => {
    await h.create();
    const old = await h.connect("ana");
    const uuid = "0b7f6a2e-9c1d-4e1f-8a6b-3c2d1e0f9a8b";
    await h.send(old, { kind: "hello", from: uuid, name: "Ana", logDeltas: true });
    // The old client shows a full lobby; a reload brings it the current client.
    expect(old.sent).toEqual([{ kind: "reject", to: uuid, reason: "full" }]);
    expect(old.closed).toBeNull();
    await h.send(old, { kind: "intent", from: uuid, intent: { type: "set-ready", ready: true } });
    expect(h.storage.data.has("snapshot")).toBe(false);
    const current = await h.connect("ana");
    await h.send(current, hello("h"));
    expect(current.last("state")?.snapshot.host).toMatchObject({ id: seatIdOf("h"), name: "Ana" });
  });
});

describe("lobby abuse — the audit trail (LB8)", () => {
  it("LB8: a seat-claim refusal is logged by cause, and a spectator's is not", async () => {
    await h.create();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));

    // Both seats are held: a third player is refused.
    const third = await h.connect("vic");
    await h.send(third, hello("v"));
    expect(third.last("reject")).toEqual({ kind: "reject", to: seatIdOf("v"), reason: "full" });
    expect(logged("hello_refused")).toEqual([
      {
        evt: "lobby",
        kind: "hello_refused",
        lobby: "ABCD",
        cause: "full",
        signedIn: true,
        spectating: false,
      },
    ]);

    // The guest's own secret, without the account the seat is bound to.
    resetLogThrottle();
    const shadow = await h.connect();
    await h.send(shadow, hello("g"));
    expect(shadow.last("reject")).toEqual({ kind: "reject", to: seatIdOf("g"), reason: "full" });
    expect(logged("hello_refused").slice(1)).toMatchObject([
      { cause: "bound", signedIn: false, spectating: false },
    ]);

    // Throttled: a refused client that keeps asking writes one line per ten minutes.
    for (let i = 0; i < 5; i++) await h.send(shadow, hello("g"));
    expect(logged("hello_refused")).toHaveLength(2);
  });

  it("LB8: watching a match is not a refusal worth a line", async () => {
    await matchInTurnOne();
    const watcher = await h.connect("vic");
    await h.send(watcher, hello("w"));
    expect(watcher.framesOf("match").length).toBeGreaterThan(0);
    expect(logged("hello_refused")).toEqual([]);
  });

  it("LB8: no lobby line names an account, a session, a seat secret or a deck", async () => {
    const { host, guest } = await matchInTurnOne();
    const shadow = await h.connect();
    await h.send(shadow, hello("g"));
    await h.send(guest, { kind: "action", action: { type: "concede" } });
    h.world.endedSessions.add(sessionIdOf("bo"));
    await h.send(guest, { kind: "rematch", from: seatIdOf("g") });
    for (let i = 0; i <= FRAME_BURST; i++) await h.send(host, "junk");
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const secrets = ["ana", "bo", sessionIdOf("ana"), sessionIdOf("bo"), "deck-ana", "deck-bo"];
    secrets.push(seatSecret("h"), seatSecret("g"));
    for (const secret of secrets) {
      expect(lines.filter((line) => line.includes(`"${secret}"`))).toEqual([]);
    }
  });
});

describe("lobby abuse — the removed set-name intent (AU8)", () => {
  it("AU8: an older client's set-name is dropped unread and still spends the frame budget", async () => {
    await h.create();
    const host = await h.connect();
    await h.send(host, hello("h", "Ana"));
    const writes = countWrites();
    const rename = JSON.stringify({
      kind: "intent",
      from: seatIdOf("h"),
      intent: { type: "set-name", name: "Captain" },
    });
    for (let i = 1; i < FRAME_BURST; i++) await h.send(host, rename);
    expect(host.closed).toBeNull();
    expect(writes).toEqual({ puts: 0, keys: 0, deletes: 0, alarms: 0 });
    expect(host.last("state")?.snapshot.host.name).toBe("Ana");
    await h.send(host, rename);
    expect(host.closed).toEqual({ code: 1008, reason: "too many messages" });
    expect(logged("socket_closed")).toMatchObject([
      { cause: "frame_rate", frames: FRAME_BURST + 1 },
    ]);
  });
});
