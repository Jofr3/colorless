import {
  LOBBY_PROTOCOL,
  createSnapshot,
  type LobbySnapshot,
  makePlayer,
  type RedactedGame,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLobbyChannel, testSeatId, testSeatSecret } from "../test/fakeLobbyChannel";
import {
  countdownSeconds,
  LobbyClient,
  PRESENCE_TIMEOUT_MS,
  UNREACHABLE_MS,
  versusStatus,
} from "./lobbyClient";

// The framework-free lobby client, driven through a fake channel that records
// posts and pushes server frames, on fake timers for the 700 ms tick.

const CODE = "ABCD";
const host = makePlayer(testSeatId("h"), "Host");
const guest = makePlayer(testSeatId("g"), "Guest");
const snap = (over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  ...createSnapshot(CODE, host),
  guest,
  phase: "selecting",
  ...over,
});
const game = { seat: "p1", phase: { kind: "turn:action" } } as unknown as RedactedGame;

function make(role: "host" | "guest", label = role === "host" ? "h" : "g") {
  const fake = fakeLobbyChannel();
  const client = new LobbyClient(
    { code: CODE, role, secret: testSeatSecret(label), name: role === "host" ? "Host" : "Guest" },
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
    expect(client.state.snapshot?.host.id).toBe(testSeatId("h"));
    expect(client.self?.id).toBe(testSeatId("h"));
    expect(client.opponent).toBeNull();
    expect(posts).toEqual([
      { kind: "hello", from: testSeatSecret("h"), name: "Host", protocol: LOBBY_PROTOCOL },
    ]);
  });

  it("a guest adopts only a state that seats it", () => {
    const { client, push } = make("guest");
    expect(client.state).toMatchObject({ snapshot: null, status: "connecting" });
    push({ kind: "state", snapshot: snap({ guest: makePlayer(testSeatId("x"), "Other") }) });
    expect(client.state.snapshot).toBeNull();
    push({ kind: "state", snapshot: snap() });
    expect(client.state.status).toBe("connected");
    expect(client.self?.id).toBe(testSeatId("g"));
    expect(client.opponent?.id).toBe(testSeatId("h"));
  });

  it("stays connecting through a silence, re-sending hello, then reports unreachable after 20 s", () => {
    const { client, kinds } = make("guest");
    // A slow first socket is silence, not "not found": that takes the server's word.
    vi.advanceTimersByTime(UNREACHABLE_MS);
    expect(kinds().filter((k) => k === "hello").length).toBeGreaterThan(20);
    expect(client.state.status).toBe("connecting");
    vi.advanceTimersByTime(700);
    expect(client.state.status).toBe("unreachable");
    const sent = kinds().length;
    vi.advanceTimersByTime(5000);
    expect(kinds().length).toBe(sent);
  });

  it("reports not-found at once when the server says the code names no lobby", () => {
    const { client, kinds } = make("guest");
    vi.advanceTimersByTime(700);
    client.lobbyClosed();
    expect(client.state.status).toBe("not-found");
    const sent = kinds().length;
    vi.advanceTimersByTime(UNREACHABLE_MS);
    expect(kinds().length).toBe(sent);
    expect(client.state.status).toBe("not-found");
  });

  it("reports outdated, and stops re-announcing, when the server says this page is too old", () => {
    const { client, push, kinds } = make("guest");
    push({ kind: "state", snapshot: snap() });
    client.lobbyClosed("outdated");
    expect(client.state.status).toBe("outdated");
    const sent = kinds().length;
    vi.advanceTimersByTime(UNREACHABLE_MS);
    expect(kinds().length).toBe(sent);
  });

  it("a host whose first socket never answers reports unreachable, not its seeded lobby", () => {
    const { client } = make("host");
    vi.advanceTimersByTime(UNREACHABLE_MS + 700);
    expect(client.state.status).toBe("unreachable");
  });

  it("a server that answers only after the unreachable window takes the client back, its poll running again", () => {
    const { client, push, posts } = make("guest");
    vi.advanceTimersByTime(UNREACHABLE_MS + 700);
    expect(client.state.status).toBe("unreachable");
    // A slow cold start: the lobby's first state lands after the window.
    push({ kind: "state", snapshot: snap() });
    expect(client.state.status).toBe("connected");
    const hellos = () => posts.filter((p) => p.kind === "hello").length;
    const before = hellos();
    vi.advanceTimersByTime(PRESENCE_TIMEOUT_MS + 700);
    expect(client.state.status).toBe("connecting");
    expect(hellos()).toBeGreaterThan(before);
    push({ kind: "state", snapshot: snap() });
    expect(client.state.status).toBe("connected");
  });

  it("a full lobby that answers only after the unreachable window is re-announced to after a silence", () => {
    const { client, push, posts } = make("guest");
    vi.advanceTimersByTime(UNREACHABLE_MS + 700);
    push({ kind: "reject", to: testSeatId("g"), reason: "full" });
    expect(client.state.status).toBe("full");
    const before = posts.filter((p) => p.kind === "hello").length;
    vi.advanceTimersByTime(PRESENCE_TIMEOUT_MS + 700);
    expect(posts.filter((p) => p.kind === "hello").length).toBe(before + 1);
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

  it("a full lobby stays full: later states, matches and errors are ignored", () => {
    const { client, push } = make("guest", "z");
    push({ kind: "reject", to: "someone-else", reason: "full" });
    expect(client.state.status).toBe("connecting");
    push({ kind: "reject", to: testSeatId("z"), reason: "full" });
    expect(client.state.status).toBe("full");
    push({ kind: "state", snapshot: snap({ phase: "in-game" }) });
    push({ kind: "match", game, log: [] });
    push({ kind: "match-error", reason: "x" });
    expect(client.state).toMatchObject({
      status: "full",
      snapshot: null,
      match: null,
      matchError: null,
    });
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
      { kind: "hello", from: testSeatSecret("h"), name: "Host", protocol: LOBBY_PROTOCOL },
    ]);
    push({ kind: "match", game: skipped, log: [a, a, c] });
    expect(client.state.matchLog).toEqual([a, a, c]);
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
    expect(a.posts.at(-1)).toEqual({ kind: "bye", from: testSeatId("h"), slot: "host" });
    expect(a.closed()).toBe(true);
    const sent = a.kinds().length;
    vi.advanceTimersByTime(5000);
    expect(a.kinds().length).toBe(sent);
    const b = make("guest");
    b.client.dispose({ bye: false });
    expect(b.kinds()).not.toContain("bye");
    expect(b.closed()).toBe(true);
  });

  it("posts intents, rematch and actions for its own seat", () => {
    const { client, posts } = make("guest");
    client.selectDeck({ id: "d", name: "Deck" });
    client.setReady(true);
    client.requestRematch();
    client.leave();
    expect(posts.slice(1)).toEqual([
      {
        kind: "intent",
        from: testSeatId("g"),
        intent: { type: "select-deck", deckId: "d", deckName: "Deck" },
      },
      { kind: "intent", from: testSeatId("g"), intent: { type: "set-ready", ready: true } },
      { kind: "rematch", from: testSeatId("g") },
      { kind: "bye", from: testSeatId("g"), slot: "guest" },
    ]);
  });

  it("sends its seat secret in the hello alone, and knows its seat by the public id (LB6)", () => {
    const { client, posts, push } = make("guest");
    client.selectDeck({ id: "d", name: "Deck" });
    client.leave();
    const secret = testSeatSecret("g");
    expect(posts[0]).toMatchObject({ kind: "hello", from: secret });
    expect(posts.slice(1).every((post) => !JSON.stringify(post).includes(secret))).toBe(true);
    expect(client.playerId).toBe(testSeatId("g"));
    // A snapshot naming the seat by its secret is not ours: only the public id is.
    push({ kind: "state", snapshot: snap({ guest: makePlayer(secret, "Guest") }) });
    expect(client.state.snapshot).toBeNull();
  });

  it("remembers its own deck pick, which the server never sends back (LB5)", () => {
    const { client, push } = make("guest");
    push({ kind: "state", snapshot: snap() });
    client.selectDeck({ id: "d", name: "Deck" });
    expect(client.state.deckId).toBe("d");
    push({
      kind: "state",
      snapshot: snap({ guest: { ...guest, hasDeck: true, deckName: "Deck" } }),
    });
    expect(client.state.deckId).toBe("d");
    push({ kind: "state", snapshot: snap() });
    expect(client.state.deckId).toBeNull();
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
