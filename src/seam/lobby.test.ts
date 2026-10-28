import { sessionIdOf } from "@colorless/api/testing/lobbyHarness";
import { COUNTDOWN_MS } from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEAT_LOST } from "../lua/onlineTable";
import { type Bridge, type OnlineTab, openBridge, SEAM_CODE } from "./lobbyBridge";

// Two tabs' real lobby clients, Lua online modals and tables against the real lobby DO, through
// sockets that can drop, reopen and go half-open: the handshakes between them (hello, presence,
// reconnect, rematch) as a browser and the Worker run them.

let b: Bridge;
beforeEach(async () => {
  b = await openBridge();
});
afterEach(() => {
  b.dispose();
  vi.unstubAllGlobals();
});

/** Both tabs seated with a deck picked and readied, through the countdown into a match each tab's
    table has taken. */
async function inGame() {
  const host = await b.online(b.tab("ana"), "host", "h");
  await b.run(500);
  const guest = await b.online(b.tab("bo"), "guest", "g");
  await b.run(500);
  host.client().selectDeck({ id: "deck-ana", name: "Ana's deck" });
  guest.client().selectDeck({ id: "deck-bo", name: "Bo's deck" });
  await b.run(500);
  await host.online.command("ready\t1");
  await guest.online.command("ready\t1");
  await b.run(COUNTDOWN_MS + 1000);
  return { host: seated(host), guest: seated(guest) };
}

/** The tab's table on the running match. */
function seated(tab: OnlineTab) {
  expect(tab.route).toHaveBeenLastCalledWith("match", SEAM_CODE, true);
  const table = tab.table();
  if (table === null) throw new Error("no live match to take");
  return Object.assign(tab, { match: table });
}

/** The tab's player concedes from its table. */
function concede(tab: ReturnType<typeof seated>) {
  const seat = tab.match.view()?.seat;
  if (seat === undefined) throw new Error("no board to concede");
  tab.match.send({ type: "concede", seat });
}

/** The newest socket `tab` opened, with its accepted server end. */
function lastSocket(tab: OnlineTab) {
  const socket = tab.sockets.at(-1);
  if (socket?.server == null) throw new Error("no accepted socket");
  return { socket, server: socket.server };
}

describe("the web client against the lobby DO", () => {
  it("starts a match both tables take, one seat each", async () => {
    const { host, guest } = await inGame();
    expect(host.match.view()?.seat).toBe("p1");
    expect(guest.match.view()?.seat).toBe("p2");
    expect(guest.match.names()).toEqual({ you: "g", opponent: "h" });
    expect(host.match.lifecycle().flags).toEqual(["concede", "leave"]);
  });

  it("a socket reopened before the client misses the server re-seats and can act", async () => {
    const { host, guest } = await inGame();
    const { server } = lastSocket(guest);
    b.deliver(() => b.h.drop(server));
    await b.run(1500);
    expect(guest.sockets).toHaveLength(2);
    concede(guest);
    await b.run(300);
    expect(host.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
  });

  it("a move made while the link is down lands after the reconnect, behind the seat's hello", async () => {
    const { host, guest } = await inGame();
    guest.offline = true;
    const { server } = lastSocket(guest);
    b.deliver(() => b.h.drop(server));
    await b.run(1000);
    concede(guest);
    // Long enough for the client to miss the server and say hello again while still down.
    await b.run(5000);
    guest.offline = false;
    await b.run(10_000);
    expect(host.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
    expect(guest.client().state.status).toBe("connected");
  });

  it("a half-open link is given up for a new socket before the server forfeits the player", async () => {
    const { host, guest } = await inGame();
    const { socket, server } = lastSocket(guest);
    // The guest's network path changes: the old connection is dead without a close either way.
    socket.blackholed = true;
    await b.run(30_000);
    expect(guest.sockets).toHaveLength(2);
    expect(guest.client().state.status).toBe("connected");
    expect(host.match.lifecycle().opponentAway).toBeNull();
    await b.run(150_000);
    expect(server.closed).not.toBeNull();
    expect(host.match.view()?.outcome).toBeNull();
    concede(guest);
    await b.run(300);
    expect(host.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
  });

  it("both pressing Rematch within a round trip starts the next match on both tables", async () => {
    const { host, guest } = await inGame();
    concede(guest);
    await b.run(300);
    const first = host.match.matchId();
    host.match.rematch();
    guest.match.rematch();
    await b.run(COUNTDOWN_MS + 2000);
    for (const tab of [host, guest]) {
      expect(tab.client().state.snapshot?.phase).toBe("in-game");
      expect(tab.match.matchId()).not.toBe(first);
      expect(tab.match.view()?.outcome).toBeNull();
      expect(tab.match.lifecycle().flags).toEqual(["concede", "leave"]);
    }
  });

  it("a signed-out seat's rematch is refused, and the tab keeps its result as a watcher", async () => {
    const { host, guest } = await inGame();
    concede(host);
    await b.run(300);
    expect(guest.match.view()?.outcome).toMatchObject({ winner: "you" });
    b.h.world.endedSessions.add(sessionIdOf("bo"));
    guest.user = undefined;
    guest.match.rematch();
    await b.run(3000);
    expect(guest.client().state.status).toBe("spectating");
    expect(guest.match.view()?.outcome).toMatchObject({ winner: "you" });
    expect(guest.match.lifecycle()).toMatchObject({ flags: ["leave"], warning: SEAT_LOST });
    expect(guest.route).not.toHaveBeenLastCalledWith("online", SEAM_CODE, true);
    guest.match.rematch();
    await b.run(1000);
    expect(host.client().state.snapshot?.phase).toBe("in-game");
  });
});
