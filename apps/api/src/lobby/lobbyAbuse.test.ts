import { drbgSeed } from "@colorless/engine/testing";
// The lobby abuse harness (security audit, Phase 0). Each case measures what one abusive client
// costs the lobby, in storage writes, alarms, sockets and frames, and asserts the number. The
// Phase 0 baselines were changed on purpose by the fix their finding id names (LB1, LB2, LB3, MI2
// and MIX2 in Phase 3), and each such case says what the number was.

import { LOBBY_WS_CLOSED, type LobbyClientMessage, type LobbyIntent } from "@colorless/schema";
import type { GameState } from "@colorless/engine";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import { createLobbyHarness, type FakeSocket, LEGAL_DECK, type LobbyHarness } from "./lobbyHarness";
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
      await h.send(ws, intent("attacker", { type: "set-name", name: i % 2 ? "a" : "b" }));
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
        playerId: "attacker",
        deadline: h.world.now - (frames - FRAME_BURST) + DISCONNECT_GRACE_MS,
      },
    ]);
    expect(logged("socket_closed")).toEqual([
      { evt: "lobby", kind: "socket_closed", lobby: "ABCD", cause: "frame_rate" },
    ]);
  });

  it("LB1: commits a player paces re-arm the alarm only once the armed one is due", async () => {
    await h.create();
    const ws = await h.connect();
    await h.send(ws, hello("host"));
    const writes = countWrites();
    for (let i = 0; i < 60; i++) {
      h.world.now += 1000;
      await h.send(ws, intent("host", { type: "set-name", name: i % 2 ? "a" : "b" }));
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

    const junk = await h.connect();
    for (let i = 0; i < FRAME_BURST; i++) await h.send(junk, "not json");
    expect(junk.closed).toBeNull();
    await h.send(junk, "not json");
    expect(junk.closed).toEqual({ code: 1008, reason: "too many messages" });
    // Frames still in flight from a closed socket are dropped unread.
    await h.send(junk, hello("late"));
    expect(h.storage.data.get("snapshot")).toMatchObject({ host: { id: "big" }, guest: null });
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
    await h.send(host, intent("h", { type: "set-name", name: "Ana B" }));
    expect(members.every((ws) => ws.last("state")?.snapshot.host.name === "Ana B")).toBe(true);
    expect(overflow.every((ws) => ws.sent.length === 0)).toBe(true);

    // A turned-away socket's hello is answered "full", which the client shows as a full lobby.
    const [asks, ...silent] = overflow;
    if (asks === undefined) throw new Error("no overflow socket");
    await h.send(asks, hello("watcher", "Watcher"));
    expect(asks.sent).toEqual([{ kind: "reject", to: "watcher", reason: "full" }]);
    expect(asks.closed).toEqual({ code: 1013, reason: "lobby full" });
    // One that never says hello is let go at the next sweep.
    h.world.now += OVERFLOW_HELLO_MS + 1;
    await h.fireAlarm();
    expect(silent.every((ws) => ws.closed?.code === 1013)).toBe(true);
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
    expect(reload.last("state")?.snapshot.host).toMatchObject({ id: "h", connected: true });
    // Another account is turned away; the seat's own account fills up to the hard cap only.
    const stranger = await h.connect("bo");
    await h.send(stranger, hello("g"));
    expect(stranger.last("reject")).toEqual({ kind: "reject", to: "g", reason: "full" });
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
    expect(logged("lobby_wiped")).toMatchObject([{ cause: "inactive", inGame: false }]);
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
        await h.send(host, intent("h", { type: "set-name", name: `Ana ${minute}` }));
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
  /** The guest joins signed out as `vic-id`, a second anonymous socket replays that public id,
      and the guest then signs in, which binds the seat to their account. */
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
    expect(await h.storage.get("seatUsers")).toEqual({ h: "ana", "vic-id": "vic" });
    return { host, shadow, victim };
  }

  it("LBX1: binding the seat closes the shadow socket and keeps the guest seated", async () => {
    const { host, shadow, victim } = await shadowedGuest();
    expect(shadow.closed).toEqual({ code: 1008, reason: "seat claimed by an account" });
    expect(victim.closed).toBeNull();
    expect(host.last("state")?.snapshot.guest).toMatchObject({ id: "vic-id", connected: true });
    expect(await h.storage.get("pendingDisconnects")).toBeUndefined();
    expect(logged("seat_evicted")).toEqual([
      { evt: "lobby", kind: "seat_evicted", lobby: "ABCD", sockets: 1 },
    ]);
  });

  it("LBX1: the evicted socket cannot walk the bound guest out or change their deck", async () => {
    const { host, shadow, victim } = await shadowedGuest();
    await h.send(shadow, { kind: "bye", from: "vic-id", slot: "guest" });
    await h.send(
      shadow,
      intent("vic-id", { type: "select-deck", deckId: "deck-ana", deckName: "x" }),
    );
    expect(host.last("state")?.snapshot.guest).toMatchObject({ id: "vic-id", deckId: null });
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
    await h.storage.put("seatUsers", { h: "ana", "vic-id": "vic" });
    h.hibernate();
    const victim = await h.connect("vic");
    await h.send(victim, hello("vic-id", "Vic"));
    expect(shadow.closed).toBeNull();

    await h.send(
      shadow,
      intent("vic-id", { type: "select-deck", deckId: "deck-x", deckName: "x" }),
    );
    await h.send(shadow, intent("vic-id", { type: "set-ready", ready: true }));
    expect(host.last("state")?.snapshot.guest).toMatchObject({ deckId: null, ready: false });
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
    await h.send(shadow, { kind: "rematch", from: "vic-id" });
    await h.send(shadow, { kind: "bye", from: "vic-id", slot: "guest" });
    expect(await storedRecord()).toEqual(before);
    expect(host.last("state")?.snapshot.guest).toMatchObject({ id: "vic-id", connected: true });
    expect(shadow.framesOf("match")).toEqual([]);
  });

  it("LBX1: a shadow on the host's seat cannot kick the guest", async () => {
    await h.create();
    const shadow = await h.connect();
    await h.send(shadow, hello("h", "Evil"));
    await h.storage.put("seatUsers", { h: "ana" });
    h.hibernate();
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    const guest = await h.connect("bo");
    await h.send(guest, hello("g"));
    await h.send(shadow, { kind: "reject", to: "g", reason: "kicked" });
    expect(host.last("state")?.snapshot.guest?.id).toBe("g");
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
    await h.send(anon, intent("g1", { type: "set-name", name: FORGED }));
    await h.send(anon, intent("g1", { type: "select-deck", deckId: "deck-x", deckName: FORGED }));
    expect(victim.last("state")?.snapshot.guest).toMatchObject({ name: CLEAN, deckName: CLEAN });
    await h.send(anon, { kind: "bye", from: "g1", slot: "guest" });

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
