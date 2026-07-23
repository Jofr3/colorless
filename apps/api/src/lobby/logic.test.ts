import {
  applyIntent,
  COUNTDOWN_MS,
  createSnapshot,
  type LobbySnapshot,
  makePlayer,
  removeGuest,
  seatGuest,
} from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  abandonsMatch,
  countdownEndsAt,
  helloDecision,
  parseClientMessage,
  reseatHost,
  setSeatConnected,
  slotOf,
  splitDuePending,
  stampCountdown,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";

function lobbyWithGuest(): LobbySnapshot {
  return seatGuest(createSnapshot("ABCD", makePlayer("h1", "Ana")), "g1", "Bo");
}

function countdownLobby(): LobbySnapshot {
  let snapshot = lobbyWithGuest();
  snapshot = applyIntent(snapshot, "host", { type: "select-deck", deckId: "d1", deckName: "A" });
  snapshot = applyIntent(snapshot, "guest", { type: "select-deck", deckId: "d2", deckName: "B" });
  snapshot = applyIntent(snapshot, "host", { type: "set-ready", ready: true });
  snapshot = applyIntent(snapshot, "guest", { type: "set-ready", ready: true });
  expect(snapshot.phase).toBe("countdown");
  return snapshot;
}

describe("parseClientMessage", () => {
  it("parses a valid frame", () => {
    expect(parseClientMessage(JSON.stringify({ kind: "hello", from: "g1", name: "Bo" }))).toEqual({
      kind: "hello",
      from: "g1",
      name: "Bo",
    });
  });

  it("drops bad JSON, junk shapes and server-only frames", () => {
    expect(parseClientMessage("{nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "boom" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "heartbeat", from: "x" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ kind: "reject", to: "g1", reason: "full" })),
    ).toBeNull();
  });
});

describe("slotOf", () => {
  it("resolves both seats and rejects strangers", () => {
    const snapshot = lobbyWithGuest();
    expect(slotOf(snapshot, "h1")).toBe("host");
    expect(slotOf(snapshot, "g1")).toBe("guest");
    expect(slotOf(snapshot, "x9")).toBeNull();
  });
});

describe("helloDecision", () => {
  it("claims the host seat in a lobby with no snapshot yet", () => {
    expect(helloDecision(null, "h1")).toBe("claim-host");
  });

  it("re-seats known ids on their own seats", () => {
    const snapshot = lobbyWithGuest();
    expect(helloDecision(snapshot, "h1")).toBe("reseat-host");
    expect(helloDecision(snapshot, "g1")).toBe("seat-guest");
  });

  it("seats a newcomer while the guest seat is empty", () => {
    expect(helloDecision(createSnapshot("ABCD", makePlayer("h1", "Ana")), "g1")).toBe("seat-guest");
  });

  it("refuses a newcomer while the incumbent guest is connected", () => {
    expect(helloDecision(lobbyWithGuest(), "g2")).toBe("reject-full");
  });

  it("lets a newcomer take over an abandoned seat, pre-match only", () => {
    const abandoned = setSeatConnected(lobbyWithGuest(), "guest", false);
    expect(helloDecision(abandoned, "g2")).toBe("seat-guest");

    const inCountdown = setSeatConnected(countdownLobby(), "guest", false);
    // Disconnecting drops ready and leaves countdown, so re-enter it manually
    // to model the "seat dropped but match underway" refusals.
    const inGame: LobbySnapshot = { ...inCountdown, phase: "in-game" };
    expect(helloDecision(inGame, "g2")).toBe("reject-full");
    const countdown: LobbySnapshot = { ...inCountdown, phase: "countdown" };
    expect(helloDecision(countdown, "g2")).toBe("reject-full");
  });
});

describe("setSeatConnected", () => {
  it("disconnecting the host drops their ready and leaves the countdown", () => {
    const next = setSeatConnected(countdownLobby(), "host", false);
    expect(next.host.connected).toBe(false);
    expect(next.host.ready).toBe(false);
    expect(next.phase).toBe("selecting");
    expect(next.countdownStartedAt).toBeNull();
  });

  it("reconnecting the host keeps deck and ready state", () => {
    const away = setSeatConnected(lobbyWithGuest(), "host", false);
    const back = setSeatConnected(away, "host", true);
    expect(back.host.connected).toBe(true);
    expect(back.phase).toBe("selecting");
  });

  it("delegates the guest seat to the reducer's setGuestConnected", () => {
    const next = setSeatConnected(countdownLobby(), "guest", false);
    expect(next.guest?.connected).toBe(false);
    expect(next.guest?.ready).toBe(false);
    expect(next.phase).toBe("selecting");
  });
});

describe("reseatHost", () => {
  it("marks the host present with the announced name, keeping their pick", () => {
    let snapshot = countdownLobby();
    snapshot = setSeatConnected(snapshot, "host", false);
    const back = reseatHost(snapshot, "Ana2");
    expect(back.host).toMatchObject({ name: "Ana2", connected: true, deckId: "d1" });
  });
});

describe("countdown helpers", () => {
  it("stamps the start once and only in the countdown phase", () => {
    const entered = countdownLobby();
    expect(entered.countdownStartedAt).toBeNull();
    const stamped = stampCountdown(entered, 1000);
    expect(stamped.countdownStartedAt).toBe(1000);
    // Already stamped → untouched; other phases → untouched.
    expect(stampCountdown(stamped, 2000)).toBe(stamped);
    const waiting = createSnapshot("ABCD", makePlayer("h1", "Ana"));
    expect(stampCountdown(waiting, 1000)).toBe(waiting);
  });

  it("computes the end of a stamped countdown", () => {
    const stamped = stampCountdown(countdownLobby(), 1000);
    expect(countdownEndsAt(stamped)).toBe(1000 + COUNTDOWN_MS);
    expect(countdownEndsAt(lobbyWithGuest())).toBeNull();
  });
});

describe("abandonsMatch", () => {
  it("is true only when a commit takes the lobby out of in-game (the match-record drop)", () => {
    const inGame: LobbySnapshot = { ...countdownLobby(), phase: "in-game" };
    // The real abandon path: removeGuest (a guest's bye / the host's kick) resets
    // in-game → waiting. This is the transition that must drop the stale match.
    expect(abandonsMatch(inGame, removeGuest(inGame))).toBe(true);
    // Entering the match (countdown → in-game) is NOT an abandon — the handoff
    // just wrote the record; dropping it here would erase every fresh match.
    expect(abandonsMatch(countdownLobby(), inGame)).toBe(false);
    // A pre-match guest leave (never in-game) has no match to abandon.
    expect(abandonsMatch(lobbyWithGuest(), removeGuest(lobbyWithGuest()))).toBe(false);
    // A brand-new lobby (no prior snapshot) was never in-game.
    expect(abandonsMatch(null, inGame)).toBe(false);
    // Staying in-game (a re-broadcast) keeps the record.
    expect(abandonsMatch(inGame, inGame)).toBe(false);
  });
});

describe("pending-disconnect bookkeeping", () => {
  it("adds, refreshes and removes entries by player", () => {
    let pending = withPendingDisconnect([], "g1", 5000);
    pending = withPendingDisconnect(pending, "h1", 6000);
    pending = withPendingDisconnect(pending, "g1", 7000); // refresh, not duplicate
    expect(pending).toHaveLength(2);
    expect(pending.find((entry) => entry.playerId === "g1")?.deadline).toBe(7000);
    expect(withoutPendingDisconnect(pending, "g1").map((entry) => entry.playerId)).toEqual(["h1"]);
  });

  it("splits due from waiting at a boundary-inclusive deadline", () => {
    const pending = [
      { playerId: "g1", deadline: 5000 },
      { playerId: "h1", deadline: 6000 },
    ];
    const { due, waiting } = splitDuePending(pending, 5000);
    expect(due.map((entry) => entry.playerId)).toEqual(["g1"]);
    expect(waiting.map((entry) => entry.playerId)).toEqual(["h1"]);
  });
});
