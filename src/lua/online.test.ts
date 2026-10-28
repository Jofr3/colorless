import {
  createSnapshot,
  isSeatSecret,
  type LobbySnapshot,
  makePlayer,
  publicSeatId,
  type RedactedGame,
  type User,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLobbyChannel, testSeatId, testSeatSecret } from "../test/fakeLobbyChannel";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "../game/cardPool";
import { LobbyClient, type LobbyClientOptions } from "../online/lobbyClient";
import { LuaOnline, NOTICE_MS, TABLE_CLAIM_MS } from "./online";

const CODE = "ABCD";
const card = {
  ...cardBrief(),
  illustrator: null,
  evolveFrom: null,
  retreat: 0,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  effect: null,
  variants: null,
};
const old = { ...card, id: "old", name: "Old Joltik", legal: { standard: false, expanded: true } };
const energy = {
  ...card,
  id: "energy",
  name: "Basic Grass Energy",
  category: "Energy",
  energyType: "Normal",
  stage: null,
};
const summaries = [
  { id: "x", name: "Zap", cardCount: 60, folderId: null },
  { id: "y", name: "Archive", cardCount: 60, folderId: "f" },
  { id: "short", name: "Short", cardCount: 40, folderId: null },
  { id: "z", name: "Relic", cardCount: 60, folderId: null },
];
const saved = (id: string, cardId: string, format: string) => ({
  id,
  name: summaries.find((d) => d.id === id)?.name,
  format,
  cards: [
    { cardId, count: 4 },
    { cardId: "energy", count: 56 },
  ],
});
/** The complete decks' format and cards, which GET /decks carries on their summaries. */
const contents: Record<string, ReturnType<typeof saved>> = {
  x: saved("x", card.id, "standard"),
  y: saved("y", "old", "expanded"),
  z: saved("z", "old", "standard"),
};
const deckReads = {
  "GET /decks": () => json(summaries.map((deck) => ({ ...deck, ...contents[deck.id] }))),
  "GET /cards/full": fullCardsFrom({ [card.id]: card, old, energy }),
};

type Made = { opts: LobbyClientOptions; client: LobbyClient } & ReturnType<typeof fakeLobbyChannel>;

function setup(user: User | null = null) {
  const made: Made[] = [];
  const publish = vi.fn<(s: string) => void>();
  const route = vi.fn<(page: string, id: string, replace: boolean) => void>();
  const online = new LuaOnline(publish, route, {
    user: () => user,
    client: (opts) => {
      const fake = fakeLobbyChannel();
      const client = new LobbyClient(opts, { channel: fake.channel });
      made.push({ opts, client, ...fake });
      return client;
    },
  });
  const rows = () =>
    (publish.mock.lastCall?.[0] ?? "")
      .split("\n")
      .map((row) => row.split("\t").map(decodeURIComponent));
  const header = () => rows()[0] ?? [];
  const last = () => {
    const m = made.at(-1);
    if (!m) throw new Error("no client");
    return m;
  };
  return { online, publish, route, made, rows, header, last };
}

const snap = (over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  ...createSnapshot(CODE, makePlayer(testSeatId("h"), "Host")),
  phase: "selecting",
  ...over,
});
const seated = (id: string, over: Partial<LobbySnapshot> = {}) =>
  snap({ guest: makePlayer(id, "Me"), ...over });
const game = { seat: "p2", phase: { kind: "turn:action" } } as unknown as RedactedGame;
const identity = (code = CODE) => {
  const raw = sessionStorage.getItem(`online.identity.${code}`);
  return raw ? JSON.parse(raw) : null;
};
/** The public id of the seat this tab's staked secret claims. */
const myId = () => publicSeatId(identity().secret);
const store = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("localStorage", store());
  localStorage.setItem("online.playerName", "Ash");
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("location", { origin: "https://colorless.test" });
});
afterEach(() => {
  clearCardPoolCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Lua online adapter", () => {
  it("creates a lobby: stakes the host, lands on waiting and replaces the route", async () => {
    stubFetch({ "POST /lobby": () => json({ code: CODE }, 201) });
    const { online, header, route, last } = setup();
    await online.command("open");
    expect(header().slice(1, 3)).toEqual(["menu", "0"]);
    expect(header()[10]).toBe("Ash");
    const pending = online.command("create");
    expect(header()[2]).toBe("1");
    await pending;
    expect(header().slice(1, 7)).toEqual(["waiting", "0", "", CODE, "host", "connected"]);
    expect(route).toHaveBeenCalledWith("online", CODE, true);
    expect(identity()).toMatchObject({ role: "host", name: "Ash" });
    expect(last().posts[0]).toEqual({
      kind: "hello",
      from: identity().secret,
      name: "Ash",
      logDeltas: true,
    });
    await online.command("create");
    expect(route).toHaveBeenCalledOnce();
  });

  it("reports a failed or malformed create without routing", async () => {
    stubFetch({ "POST /lobby": () => json({ error: "could not mint" }, 503) });
    const { online, header, route, made } = setup();
    await online.command("open");
    await online.command("create");
    expect(header().slice(1, 4)).toEqual([
      "menu",
      "0",
      "Couldn't reach the lobby server. Try again in a moment.",
    ]);
    stubFetch({ "POST /lobby": () => json({ code: "0O1I" }, 201) });
    await online.command("create");
    expect(header()[1]).toBe("menu");
    expect(route).not.toHaveBeenCalled();
    expect(made).toHaveLength(0);
  });

  it("announces the same generated name it shows when none is stored", async () => {
    localStorage.removeItem("online.playerName");
    const { online, header } = setup();
    await online.command("open");
    const shown = header()[10];
    expect(shown).toMatch(/^Player \d{4}$/);
    await online.command("join\tABCD");
    expect(identity()).toMatchObject({ name: shown });
    expect(header()[10]).toBe(shown);
  });

  it("refuses an incomplete join code and flags an invalid deep link", async () => {
    const { online, header, made } = setup();
    await online.command("open");
    await online.command("join\tAB");
    expect(header()[3]).toBe("Enter the full 4-character code.");
    expect(made).toHaveLength(0);
    await online.command("open\t0O1");
    expect(header()[1]).toBe("invalid");
    await online.command("leave");
    expect(header()[1]).toBe("menu");
  });

  it("joins: joining until seated, then versus with the opponent's deck hidden", async () => {
    const { online, header, rows, route, last } = setup();
    await online.command("open");
    await online.command("join\tab-cd");
    expect(header().slice(1, 7)).toEqual(["joining", "0", "", CODE, "guest", "connecting"]);
    expect(route).toHaveBeenCalledWith("online", CODE, true);
    expect(rows()).toHaveLength(1);
    const me = myId();
    last().push({ kind: "state", snapshot: snap({ guest: makePlayer("other", "Other") }) });
    expect(header()[1]).toBe("joining");
    const host = { ...makePlayer("h", "Host"), hasDeck: true, deckName: "Secret", ready: true };
    last().push({
      kind: "state",
      snapshot: snap({ host, guest: { ...makePlayer(me, "Me"), hasDeck: true, deckName: "Mine" } }),
    });
    expect(header().slice(1, 2)).toEqual(["versus"]);
    expect(header()[12]).toBe("0");
    expect(header()[13]).toBe("");
    // A pick this client did not make here (a reload) has no deck id to show, only its name.
    expect(rows().slice(1)).toEqual([
      ["P", "you", "1", "Me", "1", "0", "", "Mine", "1"],
      ["P", "opponent", "1", "Host", "1", "1", "", "", "1"],
    ]);
  });

  it("keeps emitting when the opponent's name holds a lone surrogate", async () => {
    const { online, header, rows, last } = setup();
    await online.command("open");
    await online.command("join\tab-cd");
    const me = myId();
    const host = makePlayer("h", "Ho\udc00st");
    last().push({ kind: "state", snapshot: snap({ host, guest: makePlayer(me, "Me") }) });
    expect(header()[1]).toBe("versus");
    expect(rows()[2]?.[3]).toBe("Ho\ufffdst");
    last().push({
      kind: "state",
      snapshot: snap({ host: { ...host, ready: true }, guest: makePlayer(me, "Me") }),
    });
    expect(rows()[2]?.[5]).toBe("1");
  });

  it("resumes a staked identity on a deep link (reload keeps the seat)", async () => {
    sessionStorage.setItem(
      `online.identity.${CODE}`,
      JSON.stringify({ secret: testSeatSecret("h"), role: "host", name: "Ash" }),
    );
    const { online, header, last } = setup();
    await online.command(`open\t${CODE}`);
    expect(last().opts).toMatchObject({ code: CODE, role: "host", secret: testSeatSecret("h") });
    expect(header()[1]).toBe("waiting");
    await online.command(`open\t${CODE}`);
    expect(header()[1]).toBe("waiting");
  });

  it("joins afresh from an identity saved before seat secrets (LB6)", async () => {
    sessionStorage.setItem(
      `online.identity.${CODE}`,
      JSON.stringify({
        playerId: "0b7f6a2e-9c1d-4e1f-8a6b-3c2d1e0f9a8b",
        role: "host",
        name: "Ash",
      }),
    );
    const { online, last } = setup();
    await online.command(`open\t${CODE}`);
    expect(last().opts.role).toBe("guest");
    expect(isSeatSecret(last().opts.secret)).toBe(true);
    expect(identity()).toMatchObject({ secret: last().opts.secret, role: "guest" });
  });

  it("lists playable decks with their regulation flags and online verdict, or reports anonymous", async () => {
    const { calls } = stubFetch(deckReads);
    const { online, header, rows } = setup();
    online.session("anonymous", "");
    await online.command("decks");
    expect(header()[9]).toBe("anonymous");
    expect(header()[11]).toBe("anonymous");
    online.session("authenticated", "u");
    await vi.waitFor(() => expect(header()[9]).toBe("ready"));
    expect(header()[11]).toBe("authenticated");
    expect(rows().slice(1)).toEqual([
      ["D", "y", "Archive", "60", "0", "1", "1", "Expanded"],
      ["D", "z", "Relic", "60", "0", "1", "0", "Standard"],
      ["D", "x", "Zap", "60", "1", "1", "1", "Standard"],
    ]);
    // The list carries every complete deck's cards, so no deck is fetched on its own.
    expect(calls).toEqual(["GET /decks", "GET /cards/full"]);
  });

  it("sends select, ready and kick only when they are allowed", async () => {
    stubFetch(deckReads);
    const { online, header, rows, last } = setup();
    online.session("authenticated", "u");
    await online.command("decks");
    sessionStorage.setItem(
      `online.identity.${CODE}`,
      JSON.stringify({ secret: testSeatSecret("h"), role: "host", name: "Ash" }),
    );
    await online.command(`open\t${CODE}`);
    const c = last();
    await online.command("kick");
    await online.command("ready\t1");
    await online.command("select\tshort");
    expect(c.kinds()).toEqual(["hello"]);
    c.push({ kind: "state", snapshot: seated(testSeatId("g")) });
    expect(header()[12]).toBe("1");
    const before = c.posts.length;
    await online.command("select\tz");
    expect(c.posts).toHaveLength(before);
    await online.command("select\tx");
    expect(c.posts.at(-1)).toEqual({
      kind: "intent",
      from: testSeatId("h"),
      intent: { type: "select-deck", deckId: "x", deckName: "Zap" },
    });
    const ash = { ...makePlayer(testSeatId("h"), "Ash"), hasDeck: true, deckName: "Zap" };
    c.push({ kind: "state", snapshot: seated(testSeatId("g"), { host: ash }) });
    // The snapshot only says a deck is picked; the client remembers which.
    expect(rows()[1]).toEqual(["P", "you", "1", "Ash", "1", "0", "x", "Zap", "1"]);
    await online.command("ready\t1");
    expect(c.posts.at(-1)).toMatchObject({ intent: { type: "set-ready", ready: true } });
    c.push({
      kind: "state",
      snapshot: seated(testSeatId("g"), { host: { ...ash, ready: true } }),
    });
    const sent = c.posts.length;
    await online.command("select\ty");
    expect(c.posts.length).toBe(sent);
    await online.command("kick");
    expect(c.posts.at(-1)).toEqual({ kind: "reject", to: testSeatId("g"), reason: "kicked" });
  });

  it("emits the countdown only when the whole second changes", async () => {
    const { online, header, publish, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const me = myId();
    last().push({
      kind: "state",
      snapshot: seated(me, { phase: "countdown", countdownStartedAt: Date.now() }),
    });
    expect(header().slice(1, 2)).toEqual(["countdown"]);
    expect(header()[7]).toBe("3");
    const before = publish.mock.calls.length;
    vi.advanceTimersByTime(800);
    expect(publish.mock.calls.length).toBe(before);
    vi.advanceTimersByTime(400);
    expect(header()[7]).toBe("2");
    expect(publish.mock.calls.length).toBe(before + 1);
    vi.advanceTimersByTime(2000);
    expect(header()[7]).toBe("0");
  });

  it("routes to the match once the lobby is in-game with a board", async () => {
    const { online, route, header, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    route.mockClear();
    const me = myId();
    last().push({ kind: "state", snapshot: seated(me, { phase: "in-game" }) });
    expect(header()[1]).toBe("starting");
    expect(route).not.toHaveBeenCalled();
    last().push({ kind: "match", game, log: [] });
    last().push({ kind: "match", game, log: [] });
    expect(route.mock.calls).toEqual([["match", CODE, true]]);
  });

  it("leave says bye, forgets the identity and returns to the menu", async () => {
    const { online, route, header, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const c = last();
    route.mockClear();
    await online.command("leave");
    expect(c.kinds()).toContain("bye");
    expect(identity()).toBeNull();
    expect(header().slice(1, 2)).toEqual(["menu"]);
    expect(route).toHaveBeenCalledWith("online", "", true);
    await online.command(`join\t${CODE}`);
    route.mockClear();
    await online.command("leave\thome");
    expect(route).not.toHaveBeenCalled();
  });

  it("close says bye after a tick but keeps the identity", async () => {
    const { online, header, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const c = last();
    await online.command("close");
    expect(c.kinds()).not.toContain("bye");
    vi.advanceTimersByTime(0);
    expect(c.kinds()).toContain("bye");
    expect(identity()).not.toBeNull();
    expect(header()[1]).toBe("menu");
  });

  it("a match surface taking the client in the same tick prevents the bye", async () => {
    const { online, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const c = last();
    await online.command("close");
    expect(online.attach("ZZZZ")).toBeNull();
    expect(online.attach(CODE)).toBe(c.client);
    vi.advanceTimersByTime(0);
    expect(c.kinds()).not.toContain("bye");
    online.detach();
    vi.advanceTimersByTime(0);
    expect(c.kinds()).toContain("bye");
  });

  it("a live match routed to the table waits for the table to load before any bye", async () => {
    const { online, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const c = last();
    const me = myId();
    c.push({ kind: "state", snapshot: seated(me, { phase: "in-game" }) });
    c.push({ kind: "match", game, log: [] });
    // The modal closes as it routes; the lazily imported table takes the client later.
    await online.command("close");
    vi.advanceTimersByTime(TABLE_CLAIM_MS - 1);
    expect(c.kinds()).not.toContain("bye");
    expect(online.attach(CODE)).toBe(c.client);
    online.detach();
    vi.advanceTimersByTime(0);
    expect(c.kinds()).toContain("bye");
  });

  it("a live match the table never claims says bye once the wait is over", async () => {
    const { online, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const c = last();
    c.push({ kind: "state", snapshot: seated(myId(), { phase: "in-game" }) });
    c.push({ kind: "match", game, log: [] });
    await online.command("close");
    vi.advanceTimersByTime(TABLE_CLAIM_MS);
    expect(c.kinds()).toContain("bye");
  });

  it("a sign-in reopens the socket with the same identity and no bye", async () => {
    const user = { id: "u", displayName: " Misty ", email: "m@x" } as User;
    let current: User | null = null;
    const made: Made[] = [];
    const online = new LuaOnline(vi.fn(), vi.fn(), {
      user: () => current,
      client: (opts) => {
        const fake = fakeLobbyChannel();
        const client = new LobbyClient(opts, { channel: fake.channel });
        made.push({ opts, client, ...fake });
        return client;
      },
    });
    online.session("anonymous", "");
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const first = made[0];
    current = user;
    online.session("authenticated", "u");
    expect(made).toHaveLength(2);
    expect(first?.kinds()).not.toContain("bye");
    expect(first?.closed()).toBe(true);
    expect(made[1]?.opts).toMatchObject({
      code: CODE,
      role: "guest",
      secret: first?.opts.secret,
      name: "Misty",
    });
    online.session("authenticated", "u");
    expect(made).toHaveLength(2);
  });

  it("a sign-in while seated holds the step instead of flashing joining", async () => {
    let current: User | null = null;
    const made: Made[] = [];
    const steps: string[] = [];
    const online = new LuaOnline((s) => steps.push(s.split("\t")[1] ?? ""), vi.fn(), {
      user: () => current,
      client: (opts) => {
        const fake = fakeLobbyChannel();
        const client = new LobbyClient(opts, { channel: fake.channel });
        made.push({ opts, client, ...fake });
        return client;
      },
    });
    online.session("anonymous", "");
    await online.command("open");
    await online.command(`join\t${CODE}`);
    const me = publicSeatId(made[0]?.opts.secret ?? "");
    made[0]?.push({ kind: "state", snapshot: seated(me) });
    steps.length = 0;
    current = { id: "u", displayName: "Misty", email: "m@x" } as User;
    online.session("authenticated", "u");
    expect(made).toHaveLength(2);
    expect(steps).toEqual(["versus"]);
    made[1]?.push({ kind: "state", snapshot: seated(me) });
    expect(steps.at(-1)).toBe("versus");
  });

  it("copies the code or the invite link and flashes the notice", async () => {
    const { online, header } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    await online.command("copy\tcode");
    expect(writeText).toHaveBeenLastCalledWith(CODE);
    expect(header()[8]).toBe("Copied");
    vi.advanceTimersByTime(NOTICE_MS);
    expect(header()[8]).toBe("");
    await online.command("copy\tlink");
    expect(writeText).toHaveBeenLastCalledWith(`https://colorless.test/online/${CODE}`);
    writeText.mockRejectedValueOnce(new Error("denied"));
    await online.command("copy\tcode");
    expect(header()[8]).toBe("Copy failed");
  });

  it("maps refusals to info steps (full never spectates)", async () => {
    const { online, header, rows, route, last } = setup();
    await online.command("open");
    await online.command(`join\t${CODE}`);
    route.mockClear();
    const me = myId();
    last().push({ kind: "reject", to: me, reason: "full" });
    last().push({ kind: "state", snapshot: seated("other", { phase: "in-game" }) });
    expect(header()[1]).toBe("full");
    expect(rows()).toHaveLength(1);
    last().push({ kind: "match", game, log: [] });
    expect(header()[1]).toBe("full");
    expect(route).not.toHaveBeenCalled();
    await online.command("leave");
    await online.command(`join\t${CODE}`);
    vi.advanceTimersByTime(5000);
    expect(header()[1]).toBe("not-found");
  });
});
