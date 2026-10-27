import {
  createSnapshot,
  type LobbySnapshot,
  makePlayer,
  type RedactedGame,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLobbyChannel } from "../test/fakeLobbyChannel";
import {
  countdownSeconds,
  LobbyClient,
  NOT_FOUND_MS,
  PRESENCE_TIMEOUT_MS,
  versusStatus,
} from "./lobbyClient";

// The framework-free lobby client, driven through a fake channel that records
// posts and pushes server frames, on fake timers for the 700 ms tick.

const CODE = "ABCD";
const host = makePlayer("h", "Host");
const guest = makePlayer("g", "Guest");
const snap = (over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  ...createSnapshot(CODE, host),
  guest,
  phase: "selecting",
  ...over,
});
const game = { seat: "p1", phase: { kind: "turn:action" } } as unknown as RedactedGame;

function make(role: "host" | "guest", playerId = role === "host" ? "h" : "g") {
  const fake = fakeLobbyChannel();
  const client = new LobbyClient(
    { code: CODE, role, playerId, name: role === "host" ? "Host" : "Guest" },
    { channel: fake.channel },
  );
  return { client, ...fake };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LobbyClient", () => {
  it("seeds the host's snapshot and says hello at once", () => {
    const { client, posts } = make("host");
    expect(client.state.status).toBe("connected");
    expect(client.state.snapshot?.host.id).toBe("h");
    expect(client.self?.id).toBe("h");
    expect(client.opponent).toBeNull();
    expect(posts).toEqual([{ kind: "hello", from: "h", name: "Host", logDeltas: true }]);
  });

  it("a guest adopts only a state that seats it", () => {
    const { client, push } = make("guest");
    expect(client.state).toMatchObject({ snapshot: null, status: "connecting" });
    push({ kind: "state", snapshot: snap({ guest: makePlayer("x", "Other") }) });
    expect(client.state.snapshot).toBeNull();
    push({ kind: "state", snapshot: snap() });
    expect(client.state.status).toBe("connected");
    expect(client.self?.id).toBe("g");
    expect(client.opponent?.id).toBe("h");
  });

  it("re-sends hello until seated, then reports not-found after 4 s of silence", () => {
    const { client, kinds } = make("guest");
    vi.advanceTimersByTime(NOT_FOUND_MS);
    expect(kinds().filter((k) => k === "hello").length).toBeGreaterThan(3);
    expect(client.state.status).toBe("connecting");
    vi.advanceTimersByTime(700);
    expect(client.state.status).toBe("not-found");
    const sent = kinds().length;
    vi.advanceTimersByTime(5000);
    expect(kinds().length).toBe(sent);
  });

  it("reports not-found and stops re-announcing once the server closes the lobby for good", () => {
    const { client, push, kinds } = make("guest");
    push({ kind: "state", snapshot: snap() });
    client.lobbyClosed();
    expect(client.state.status).toBe("not-found");
    const sent = kinds().length;
    vi.advanceTimersByTime(60_000);
    expect(kinds().length).toBe(sent);
    expect(client.state.status).toBe("not-found");
  });

  it("flips to connecting after 5 s without the server, and back on the next state", () => {
    const { client, push, kinds } = make("guest");
    push({ kind: "state", snapshot: snap() });
    const sent = kinds().length;
    vi.advanceTimersByTime(PRESENCE_TIMEOUT_MS - 700);
    push({ kind: "heartbeat", from: "server", slot: "host" });
    vi.advanceTimersByTime(PRESENCE_TIMEOUT_MS);
    expect(client.state.status).toBe("connected");
    expect(kinds().length).toBe(sent);
    vi.advanceTimersByTime(1400);
    expect(client.state.status).toBe("connecting");
    expect(kinds().at(-1)).toBe("hello");
    push({ kind: "state", snapshot: snap() });
    expect(client.state.status).toBe("connected");
  });

  it("a full lobby turns into spectating once a match arrives", () => {
    const { client, push } = make("guest", "z");
    push({ kind: "reject", to: "someone-else", reason: "full" });
    expect(client.state.status).toBe("connecting");
    push({ kind: "reject", to: "z", reason: "full" });
    expect(client.state.status).toBe("full");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    expect(client.state.snapshot?.phase).toBe("in-game");
    expect(client.state.status).toBe("full");
    push({ kind: "match", game, log: [] });
    expect(client.state.status).toBe("spectating");
    expect(client.state.match).toBe(game);
  });

  it("a kick is sticky: later states, matches and errors are ignored", () => {
    const { client, push, kinds } = make("guest");
    push({ kind: "state", snapshot: snap() });
    push({ kind: "reject", to: "g", reason: "kicked" });
    expect(client.state.status).toBe("kicked");
    push({ kind: "state", snapshot: snap() });
    push({ kind: "match", game, log: [] });
    push({ kind: "match-error", reason: "x" });
    expect(client.state).toMatchObject({ status: "kicked", match: null, matchError: null });
    const sent = kinds().length;
    vi.advanceTimersByTime(10_000);
    expect(kinds().length).toBe(sent);
  });

  it("a match-error survives the state that clears it", () => {
    const { client, push } = make("host");
    push({ kind: "state", snapshot: snap({ phase: "countdown", countdownStartedAt: 1 }) });
    push({ kind: "state", snapshot: snap() });
    push({ kind: "match-error", reason: "Guest: no deck selected." });
    expect(client.state.matchError).toBe("Guest: no deck selected.");
    push({ kind: "state", snapshot: snap() });
    expect(client.state.matchError).toBeNull();
  });

  it("bumps the reject-action nonce and clears it on the next match", () => {
    const { client, push } = make("host");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    push({ kind: "reject-action", reason: "Not your turn." });
    push({ kind: "reject-action", reason: "Not your turn." });
    expect(client.state.actionError).toEqual({ reason: "Not your turn.", nonce: 2 });
    push({ kind: "match", game, log: [] });
    expect(client.state.actionError).toBeNull();
  });

  it("replaces the match log per frame and drops the match when the lobby leaves in-game", () => {
    const { client, push } = make("host");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    const a = { kind: "turn", turn: 1 } as const;
    const b = { kind: "turn", turn: 2 } as const;
    push({ kind: "match", game, log: [a] });
    push({ kind: "match", game, log: [a, b] });
    expect(client.state.matchLog).toEqual([a, b]);
    push({ kind: "state", snapshot: snap() });
    expect(client.state).toMatchObject({ match: null, matchLog: [] });
  });

  it("appends a log delta that continues the held log", () => {
    const { client, push, kinds } = make("host");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    const a = { kind: "turn", turn: 1 } as const;
    const b = { kind: "turn", turn: 2 } as const;
    const c = { kind: "turn", turn: 3 } as const;
    push({ kind: "match", game, log: [a] });
    const next = { ...game, turn: 2 } as RedactedGame;
    push({ kind: "match", game: next, log: [b, c], logFrom: 1 });
    expect(client.state.matchLog).toEqual([a, b, c]);
    expect(client.state.match).toBe(next);
    push({ kind: "match", game, log: [], logFrom: 3 });
    expect(client.state.matchLog).toEqual([a, b, c]);
    push({ kind: "match", game, log: [a], logFrom: 0 });
    expect(client.state.matchLog).toEqual([a, b, c]);
    expect(kinds().filter((k) => k === "hello")).toHaveLength(2);
  });

  it("drops a delta past the held log and says hello for a full frame", () => {
    const { client, push, posts } = make("host");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    const a = { kind: "turn", turn: 1 } as const;
    const c = { kind: "turn", turn: 3 } as const;
    push({ kind: "match", game, log: [a] });
    const sent = posts.length;
    const skipped = { ...game, turn: 3 } as RedactedGame;
    push({ kind: "match", game: skipped, log: [c], logFrom: 2 });
    expect(client.state.matchLog).toEqual([a]);
    expect(client.state.match).toBe(game);
    expect(posts.slice(sent)).toEqual([
      { kind: "hello", from: "h", name: "Host", logDeltas: true },
    ]);
    push({ kind: "match", game: skipped, log: [a, a, c] });
    expect(client.state.matchLog).toEqual([a, a, c]);
  });

  it("a spectator resyncs a gap the same way", () => {
    const { client, push, kinds } = make("guest", "z");
    push({ kind: "reject", to: "z", reason: "full" });
    push({ kind: "match", game, log: [] });
    const sent = kinds().length;
    push({ kind: "match", game, log: [{ kind: "turn", turn: 2 }], logFrom: 1 });
    expect(client.state.matchLog).toEqual([]);
    expect(kinds().slice(sent)).toEqual(["hello"]);
  });

  it("publishes an immutable state per change", () => {
    const { client, push } = make("guest");
    const seen: unknown[] = [];
    const off = client.subscribe((s) => seen.push(s));
    const before = client.state;
    push({ kind: "state", snapshot: snap() });
    expect(seen).toEqual([client.state]);
    expect(client.state).not.toBe(before);
    off();
    push({ kind: "match-error", reason: "x" });
    expect(seen.length).toBe(1);
  });

  it("dispose says bye and closes; {bye:false} only closes", () => {
    const a = make("host");
    a.client.dispose();
    expect(a.posts.at(-1)).toEqual({ kind: "bye", from: "h", slot: "host" });
    expect(a.closed()).toBe(true);
    const sent = a.kinds().length;
    vi.advanceTimersByTime(5000);
    expect(a.kinds().length).toBe(sent);
    const b = make("guest");
    b.client.dispose({ bye: false });
    expect(b.kinds()).not.toContain("bye");
    expect(b.closed()).toBe(true);
  });

  it("kick needs the host seat and a guest", () => {
    const g = make("guest");
    g.push({ kind: "state", snapshot: snap() });
    g.client.kick();
    expect(g.kinds()).not.toContain("reject");
    const h = make("host");
    h.client.kick();
    expect(h.kinds()).not.toContain("reject");
    h.push({ kind: "state", snapshot: snap() });
    h.client.kick();
    expect(h.posts.at(-1)).toEqual({ kind: "reject", to: "g", reason: "kicked" });
  });

  it("posts intents, rematch and actions for its own seat", () => {
    const { client, posts } = make("guest");
    client.selectDeck({ id: "d", name: "Deck" });
    client.setReady(true);
    client.requestRematch();
    client.leave();
    expect(posts.slice(1)).toEqual([
      { kind: "intent", from: "g", intent: { type: "select-deck", deckId: "d", deckName: "Deck" } },
      { kind: "intent", from: "g", intent: { type: "set-ready", ready: true } },
      { kind: "rematch", from: "g" },
      { kind: "bye", from: "g", slot: "guest" },
    ]);
  });
});

describe("lobby helpers", () => {
  it("counts the start down in whole seconds, floored at 0", () => {
    expect(countdownSeconds(1000, 1000)).toBe(3);
    expect(countdownSeconds(1000, 2001)).toBe(2);
    expect(countdownSeconds(1000, 3500)).toBe(1);
    expect(countdownSeconds(1000, 4000)).toBe(0);
    expect(countdownSeconds(1000, 9000)).toBe(0);
  });

  it("words the versus status", () => {
    const me = { ...guest, connected: true };
    const them = { ...host, connected: true };
    expect(versusStatus(me, null)).toMatch(/^Opponent disconnected/);
    expect(versusStatus(me, { ...them, connected: false })).toMatch(/^Opponent disconnected/);
    expect(versusStatus(me, them)).toBe("");
    expect(versusStatus({ ...me, ready: true }, them)).toBe(
      "Waiting for your opponent to ready up...",
    );
    expect(versusStatus({ ...me, ready: true }, { ...them, ready: true })).toBe(
      "Both ready - starting...",
    );
  });
});
