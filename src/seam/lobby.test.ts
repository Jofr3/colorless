import {
  DISCONNECT_GRACE_MS,
  LIVENESS_SWEEP_MS,
  SEATED_LIVENESS_SWEEP_MS,
  SOCKET_SILENCE_MS,
  seatIdOf,
  seatSecret,
  sessionIdOf,
} from "@colorless/api/testing/lobbyHarness";
import { COUNTDOWN_MS } from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEAT_LOST } from "../lua/onlineTable";
import { UNREACHABLE_MS } from "../online/lobbyClient";
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

  it("an action lost on a half-open link stops holding the table once the link is replaced", async () => {
    const { host, guest } = await inGame();
    lastSocket(guest).socket.blackholed = true;
    concede(guest);
    expect(guest.match.lifecycle().flags).toContain("pending");
    await b.run(SOCKET_SILENCE_MS / 2);
    expect(guest.match.lifecycle().flags).toContain("pending");
    await b.run(SOCKET_SILENCE_MS * 2);
    expect(guest.sockets).toHaveLength(2);
    expect(guest.match.lifecycle().flags).not.toContain("pending");
    // The concede went down with the old socket: the match goes on, and the player can act again.
    expect(host.match.view()?.outcome).toBeNull();
    concede(guest);
    await b.run(300);
    expect(host.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
  });

  it("a player whose link goes half-open and stays down shows as away within 20 s", async () => {
    const { host, guest } = await inGame();
    // The guest's network goes: the open socket is dead without a close, and no new one connects.
    lastSocket(guest).socket.blackholed = true;
    guest.offline = true;
    let away = 0;
    for (let elapsed = 0; elapsed < 30_000 && away === 0; elapsed += 500) {
      await b.run(500);
      if (host.match.lifecycle().opponentAway !== null) away = elapsed + 500;
    }
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThanOrEqual(
      SEATED_LIVENESS_SWEEP_MS + SOCKET_SILENCE_MS + DISCONNECT_GRACE_MS,
    );
    expect(host.match.lifecycle().opponentAway?.forfeitAt).toBeTypeOf("number");
    // The outage ends inside the forfeit window: the guest is reseated and the host told.
    guest.offline = false;
    await b.run(20_000);
    expect(guest.client().state.status).toBe("connected");
    expect(host.match.lifecycle().opponentAway).toBeNull();
    expect(host.match.view()?.outcome).toBeNull();
  });

  it("a lone host's lobby sweeps every 30 s, and every 5 s once a guest sits down", async () => {
    await b.online(b.tab("ana"), "host", "h");
    await b.run(500);
    const alarms = vi.spyOn(b.h.lobby, "alarm");
    await b.run(60_000);
    expect(alarms).toHaveBeenCalledTimes(60_000 / LIVENESS_SWEEP_MS);
    await b.online(b.tab("bo"), "guest", "g");
    await b.run(500);
    alarms.mockClear();
    await b.run(60_000);
    expect(alarms).toHaveBeenCalledTimes(60_000 / SEATED_LIVENESS_SWEEP_MS);
  });

  it("a code that names no lobby shows not-found at once, and the tab stops reconnecting", async () => {
    b.h.storage.data.clear();
    const guest = await b.online(b.tab("bo"), "guest", "g");
    await b.run(300);
    expect(guest.online.step()).toBe("not-found");
    await b.run(30_000);
    expect(guest.sockets).toHaveLength(1);
    expect(guest.online.step()).toBe("not-found");
  });

  it("a slow first socket shows joining, never not-found, until the lobby answers", async () => {
    await b.online(b.tab("ana"), "host", "h");
    await b.run(500);
    const slow = b.tab("bo");
    slow.connectDelayMs = 6000;
    const guest = await b.online(slow, "guest", "g");
    const steps = new Set<string>();
    for (let elapsed = 0; elapsed < 7000; elapsed += 100) {
      await b.run(100);
      steps.add(guest.online.step());
    }
    expect([...steps]).toEqual(["joining", "versus"]);
  });

  it("a lobby that answers only after the unreachable window still shows a later outage", async () => {
    await b.online(b.tab("ana"), "host", "h");
    await b.run(500);
    const down = b.tab("bo");
    down.offline = true;
    const guest = await b.online(down, "guest", "g");
    await b.run(UNREACHABLE_MS + 1000);
    expect(guest.online.step()).toBe("unreachable");
    down.offline = false;
    await b.run(10_000);
    expect(guest.online.step()).toBe("versus");
    const opened = guest.sockets.length;
    lastSocket(guest).socket.blackholed = true;
    await b.run(6000);
    expect(guest.client().state.status).toBe("connecting");
    await b.run(10_000);
    expect(guest.client().state.status).toBe("connected");
    expect(guest.sockets).toHaveLength(opened + 1);
  });

  it("after a deploy both tabs reconnect into the match, and a tab that cannot is forfeited", async () => {
    const { host, guest } = await inGame();
    b.deliver(async () => b.h.redeploy());
    await b.run(5000);
    expect(host.sockets).toHaveLength(2);
    expect(guest.sockets).toHaveLength(2);
    expect(host.match.lifecycle().opponentAway).toBeNull();
    // The guest's network goes, and a second deploy drops it with everyone else.
    guest.offline = true;
    b.deliver(async () => b.h.redeploy());
    // The next liveness sweep, at most 5 s on with both seats held, finds the seat orphaned; its
    // grace runs 5 s.
    await b.run(SEATED_LIVENESS_SWEEP_MS + DISCONNECT_GRACE_MS + 1000);
    expect(host.match.lifecycle().opponentAway).toMatchObject({ name: "g" });
    await b.run(100_000);
    expect(host.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
  });

  it("a page that fails mid-match lets the opponent's forfeit clock run", async () => {
    const { host, guest } = await inGame();
    host.online.halt();
    await b.run(6000);
    expect(guest.match.lifecycle().opponentAway).toMatchObject({ name: "h" });
    expect(guest.match.lifecycle().opponentAway?.forfeitAt).toBeTypeOf("number");
    await b.run(95_000);
    expect(guest.match.view()?.outcome).toMatchObject({ winner: "you", reason: "conceded" });
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

  it("an opponent's crafted name with a lone surrogate reaches the host's screen cleaned", async () => {
    const host = await b.online(b.tab("ana"), "host", "h");
    await b.run(500);
    await b.online(b.tab(undefined), "guest", "g", "Bro\udc00ck");
    await b.run(500);
    const opponentRow = () =>
      (host.publish.mock.lastCall?.[0] ?? "")
        .split("\n")
        .map((row) => row.split("\t").map(decodeURIComponent))
        .find((row) => row[0] === "P" && row[1] === "opponent");
    expect(opponentRow()?.[3]).toBe("Brock");
    host.client().selectDeck({ id: "deck-ana", name: "Ana's deck" });
    await b.run(500);
    expect(host.client().self?.hasDeck).toBe(true);
    expect(opponentRow()?.[3]).toBe("Brock");
  });

  it("a tab a full lobby keeps turning away backs off rather than reconnecting in a loop", async () => {
    await inGame();
    const watch = (label: string) => {
      const tab = b.tab(undefined);
      const client = b.client(tab, {
        code: SEAM_CODE,
        role: "guest",
        secret: seatSecret(label),
        name: label,
      });
      return { tab, client };
    };
    // Two seats and ten watchers fill the lobby's sockets.
    for (let i = 0; i < 10; i++) watch(`w${i}`);
    await b.run(1000);
    const late = watch("late");
    await b.run(60_000);
    expect(late.tab.sockets.length).toBeGreaterThan(3);
    expect(late.tab.sockets.length).toBeLessThan(15);
    expect(late.client.state.status).toBe("full");
  });

  it("a tab refused full that its own re-sent hello later seats takes the seat up", async () => {
    const host = b.client(b.tab("ana"), {
      code: SEAM_CODE,
      role: "host",
      secret: seatSecret("h"),
      name: "h",
    });
    await b.run(500);
    const guest = b.client(b.tab("bo"), {
      code: SEAM_CODE,
      role: "guest",
      secret: seatSecret("g"),
      name: "g",
    });
    await b.run(500);
    const lateTab = b.tab("cy");
    const late = b.client(lateTab, {
      code: SEAM_CODE,
      role: "guest",
      secret: seatSecret("c"),
      name: "c",
    });
    await b.run(1000);
    expect(late.state.status).toBe("full");
    guest.dispose();
    await b.run(1000);
    expect(host.state.snapshot?.guest).toBeNull();
    // The late tab's path dies; the channel reconnects it, leading the new socket with its hello.
    const socket = lateTab.sockets.at(-1);
    if (!socket) throw new Error("no socket");
    socket.blackholed = true;
    await b.run(15_000);
    expect(host.state.snapshot?.guest).toMatchObject({ id: seatIdOf("c"), connected: true });
    expect(late.state.status).toBe("connected");
    expect(late.self?.id).toBe(seatIdOf("c"));
    late.selectDeck({ id: "deck-cy", name: "Cy's deck" });
    late.setReady(true);
    await b.run(500);
    expect(host.state.snapshot?.guest).toMatchObject({ hasDeck: true, ready: true });
  });

  it("a signed-out seat's rematch is refused, and the tab keeps its result", async () => {
    const { host, guest } = await inGame();
    concede(host);
    await b.run(300);
    expect(guest.match.view()?.outcome).toMatchObject({ winner: "you" });
    b.h.world.endedSessions.add(sessionIdOf("bo"));
    guest.user = undefined;
    guest.match.rematch();
    await b.run(3000);
    expect(guest.client().state.status).toBe("full");
    expect(guest.match.view()?.outcome).toMatchObject({ winner: "you" });
    expect(guest.match.lifecycle()).toMatchObject({ flags: ["leave"], warning: SEAT_LOST });
    expect(guest.route).not.toHaveBeenLastCalledWith("online", SEAM_CODE, true);
    guest.match.rematch();
    await b.run(1000);
    expect(host.client().state.snapshot?.phase).toBe("in-game");
  });
});
