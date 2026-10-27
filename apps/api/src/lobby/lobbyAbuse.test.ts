// The lobby abuse harness (security audit, Phase 0). Each case measures what one abusive client
// costs the lobby today, in storage writes, alarms, sockets and frames, and asserts today's number.
// None of these is a limit: they are the baselines the Phase 1-3 limits change on purpose, so a
// fix flips the assertion named by its finding id rather than passing unnoticed. A "known gap" case
// asserts today's unsafe outcome the same way, with the outcome its fix should produce beside it.

import type { LobbyClientMessage, LobbyIntent } from "@colorless/schema";
import type { GameState } from "@colorless/engine";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import { createLobbyHarness, type FakeSocket, LEGAL_DECK, type LobbyHarness } from "./lobbyHarness";
import { type MatchRecord, readMatchRecord } from "./match";
import { MatchStore } from "./matchStore";

let h: LobbyHarness;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  h = createLobbyHarness({
    seed: 42,
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

describe("lobby abuse — frames (LB1)", () => {
  it("LB1: every alternating set-name frame from an anonymous host is a snapshot write and an alarm", async () => {
    await h.create();
    const ws = await h.connect();
    await h.send(ws, hello("attacker"));
    const writes = countWrites();
    const frames = 200;
    for (let i = 0; i < frames; i++) {
      h.world.now += 1;
      await h.send(ws, intent("attacker", { type: "set-name", name: i % 2 ? "a" : "b" }));
    }
    // Today: one snapshot put and one setAlarm per frame (2 rows written each), and the socket is
    // never closed. A per-socket budget and an alarm that is not re-set while armed lower these.
    expect(writes).toEqual({ puts: frames, keys: frames, deletes: 0, alarms: frames });
    expect(ws.closed).toBeNull();
  });

  it("LB1: oversized and invalid frames are parsed and dropped, and the socket stays open", async () => {
    await h.create();
    const ws = await h.connect();
    await h.send(ws, hello("attacker"));
    const writes = countWrites();
    for (let i = 0; i < 100; i++) await h.send(ws, "x".repeat(100_000));
    await h.send(
      ws,
      JSON.stringify({ kind: "intent", from: "attacker", junk: "y".repeat(1_000_000) }),
    );
    // Today: no size cap and no invalid-frame budget, so nothing closes the socket.
    expect(ws.closed).toBeNull();
    expect(writes).toEqual({ puts: 0, keys: 0, deletes: 0, alarms: 0 });
  });

  it("LB1 (MI2): every accepted bench reorder in a match is a match write and a frame per socket", async () => {
    const { host, guest, actor, actorSocket } = await matchInTurnOne();
    const before = await storedRecord();
    const writes = countWrites();
    const frames = host.sent.length + guest.sent.length;
    const actions = 100;
    for (let i = 0; i < actions; i++) {
      const bench = (await storedState()).players[actor].bench;
      const uid = bench[0]?.stack[0];
      await h.send(actorSocket, {
        kind: "action",
        action: { type: "reorderBench", uid, index: 1 },
      });
    }
    // Today: one match head put per reorder (the log and tables are unchanged, so only the head
    // key), no alarm, and one match frame to each of the two sockets. No reorder is refused.
    expect(writes).toEqual({ puts: actions, keys: actions, deletes: 0, alarms: 0 });
    expect(host.sent.length + guest.sent.length - frames).toBe(2 * actions);
    expect(actorSocket.framesOf("reject-action")).toEqual([]);
    // MIX2: a reorder appends no log row, so this loop does not grow the log the way a repeatable
    // ability (Solar Transfer) does.
    expect((await storedRecord()).log.length).toBe(before.log.length);
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
  it("LB2: a lobby accepts every socket, and one that never says hello gets every state frame", async () => {
    await h.create();
    const lurkers: FakeSocket[] = [];
    const count = 100;
    for (let i = 0; i < count; i++) lurkers.push(await h.connect());
    const host = await h.connect("ana");
    await h.send(host, hello("h"));
    // Today: no per-lobby socket cap and no hello deadline.
    expect(h.state.getWebSockets()).toHaveLength(count + 1);
    expect(lurkers.every((ws) => ws.last("state")?.snapshot.host.id === "h")).toBe(true);
  });

  it("LB2: every spectator costs one more redacted match frame per accepted action", async () => {
    const { host, guest, actor, actorSocket } = await matchInTurnOne();
    const spectators: FakeSocket[] = [];
    for (let i = 0; i < 20; i++) {
      const ws = await h.connect();
      await h.send(ws, hello(`watcher-${String(i)}`));
      spectators.push(ws);
    }
    const sockets = [host, guest, ...spectators];
    const before = sockets.map((ws) => ws.framesOf("match").length);
    const uid = (await storedState()).players[actor].bench[0]?.stack[0];
    await h.send(actorSocket, { kind: "action", action: { type: "reorderBench", uid, index: 1 } });
    const sent = sockets.map((ws, i) => ws.framesOf("match").length - (before[i] ?? 0));
    // Today: refused hellos during a match all watch, uncapped, and each is redacted for alone.
    expect(sent).toEqual(sockets.map(() => 1));
  });

  it("LB2: a pinging socket that never says hello keeps the lobby and its 30s alarm alive", async () => {
    await h.create();
    const ws = await h.connect();
    const writes = countWrites();
    const wakes = 120; // an hour of liveness sweeps
    for (let i = 0; i < wakes; i++) await h.fireAlarm();
    // Today: no inactivity ceiling. Each sweep re-sets the alarm (a row written) and the lobby is
    // never wiped while the socket pings.
    expect(ws.closed).toBeNull();
    expect(h.storage.data.has("created")).toBe(true);
    expect(writes).toEqual({ puts: 0, keys: 0, deletes: 0, alarms: wakes });
  });

  it("LB3: a lobby that is created and never entered costs these writes through its wipe", async () => {
    const writes = countWrites();
    await h.create();
    const atCreate = { ...writes };
    await h.fireAlarm();
    // Today: create writes `created` and `code` in one put, then `cleanupAt` and its alarm; the
    // wipe deletes all three and clears the alarm.
    expect(atCreate).toEqual({ puts: 2, keys: 3, deletes: 0, alarms: 1 });
    expect(writes).toEqual({ puts: 2, keys: 3, deletes: 3, alarms: 2 });
    expect(h.storage.data.size).toBe(0);
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

  it("LBX1 (known gap): the shadow socket can still walk the bound guest out of the lobby", async () => {
    const { host, shadow, victim } = await shadowedGuest();
    await h.send(shadow, { kind: "bye", from: "vic-id", slot: "guest" });
    // Today the bye lands: `onBye` checks only the socket's attached player, never the binding, so
    // the guest seat is freed under the signed-in victim. Phase 1 (`ownsSeat`) flips this to the
    // guest staying seated as "vic-id".
    expect(host.last("state")?.snapshot.guest).toBeNull();
    expect(victim.closed).toBeNull();
  });

  it("LBX1 (known gap): the shadow socket can still change the bound guest's deck", async () => {
    const { host, shadow } = await shadowedGuest();
    await h.send(
      shadow,
      intent("vic-id", { type: "select-deck", deckId: "deck-ana", deckName: "x" }),
    );
    // Today the shadow picks the deck the victim's seat will try to load (it then fails the owner
    // check at handoff). Phase 1 flips this to the intent being dropped, leaving deckId null.
    expect(host.last("state")?.snapshot.guest?.deckId).toBe("deck-ana");
  });
});
