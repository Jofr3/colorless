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
  ABANDON_GRACE_MS,
  abandonsMatch,
  applyBye,
  DISCONNECT_GRACE_MS,
  countdownEndsAt,
  forfeitDeadlines,
  endMatch,
  helloDecision,
  parseClientMessage,
  readSnapshot,
  rematch,
  reseatHost,
  resetAfterFailedStart,
  seatClaimAllowed,
  setSeatConnected,
  LIVENESS_SWEEP_MS,
  slotOf,
  SOCKET_SILENCE_MS,
  socketIsSilent,
  splitDuePending,
  stampCountdown,
  withForfeitAt,
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

describe("the forfeit deadline on the seat (3c-v)", () => {
  const running = (): LobbySnapshot => ({ ...countdownLobby(), phase: "in-game" });

  it("arms the deadline in the SAME write that marks the seat gone", () => {
    // One writer for the pair is the whole point: you cannot disconnect a seat
    // without deciding its forfeit, and you cannot mark one present and forget to
    // cancel one — the bug that would cost a returning player their game.
    const next = setSeatConnected(running(), "guest", false, 9_000);
    expect(next.guest).toMatchObject({ connected: false, forfeitAt: 9_000 });
  });

  it("clears it on every path that marks a seat PRESENT", () => {
    const away = setSeatConnected(running(), "guest", false, 9_000);
    expect(setSeatConnected(away, "guest", true).guest?.forfeitAt).toBeNull();
    // …and the reconnect paths the hello branches actually take.
    expect(seatGuest(away, "g1", "Bo").guest?.forfeitAt).toBeNull();
    const hostAway = setSeatConnected(running(), "host", false, 9_000);
    expect(reseatHost(hostAway, "Ana").host.forfeitAt).toBeNull();
    // A brand-new seat never carries one.
    expect(makePlayer("x", "X").forfeitAt).toBeNull();
  });

  it("defaults to none, so a plain disconnect outside a match arms nothing", () => {
    expect(setSeatConnected(lobbyWithGuest(), "guest", false).guest?.forfeitAt).toBeNull();
  });

  it("reports armed deadlines for the alarm to schedule and judge", () => {
    let snapshot = setSeatConnected(running(), "guest", false, 9_000);
    expect(forfeitDeadlines(snapshot)).toEqual([{ slot: "guest", deadline: 9_000 }]);
    snapshot = withForfeitAt(snapshot, "host", 4_000);
    // Host first, so the caller sees both — the alarm takes the minimum.
    expect(forfeitDeadlines(snapshot)).toEqual([
      { slot: "host", deadline: 4_000 },
      { slot: "guest", deadline: 9_000 },
    ]);
    expect(
      forfeitDeadlines(withForfeitAt(withForfeitAt(snapshot, "host", null), "guest", null)),
    ).toEqual([]);
  });

  it("ignores a guest seat that isn't there", () => {
    const solo = createSnapshot("ABCD", makePlayer("h1", "Ana"));
    expect(withForfeitAt(solo, "guest", 1)).toBe(solo);
    expect(forfeitDeadlines(solo)).toEqual([]);
  });
});

describe("readSnapshot — the stored shape, completed (3c-v)", () => {
  it("defaults a seat written before `forfeitAt` existed", () => {
    // A deploy must not evict live lobbies. The guard is on the TYPE, not on
    // nullishness, because the field feeds Math.min in the alarm scheduler — an
    // undefined that slipped through would set the next alarm to NaN.
    const legacy = {
      code: "ABCD",
      phase: "selecting",
      host: { id: "h1", name: "Ana", deckId: null, deckName: null, ready: false, connected: true },
      guest: { id: "g1", name: "Bo", deckId: null, deckName: null, ready: false, connected: false },
      countdownStartedAt: null,
    };
    const read = readSnapshot(legacy);
    expect(read?.host.forfeitAt).toBeNull();
    expect(read?.guest?.forfeitAt).toBeNull();
    // Everything else survives untouched.
    expect(read?.guest?.connected).toBe(false);
  });

  it("keeps a real deadline, and reads nothing back as null", () => {
    const armed = withForfeitAt(lobbyWithGuest(), "guest", 1234);
    expect(readSnapshot(armed)?.guest?.forfeitAt).toBe(1234);
    expect(readSnapshot(undefined)).toBeNull();
    expect(readSnapshot("nope")).toBeNull();
    // Never throws on a blob that isn't one — the DO is the only writer, which is
    // precisely why an impossible value must not take the lobby down.
    expect(readSnapshot({})).toBeNull();
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

describe("seatClaimAllowed (3a-sec seat authentication)", () => {
  it("lets anyone claim an UNBOUND seat (anonymous or authenticated)", () => {
    expect(seatClaimAllowed(null, null)).toBe(true);
    expect(seatClaimAllowed(null, "user-1")).toBe(true);
  });

  it("lets ONLY the bound account re-adopt a bound seat", () => {
    expect(seatClaimAllowed("user-1", "user-1")).toBe(true);
  });

  it("refuses a bound seat to a different account or an anonymous socket", () => {
    // A socket replaying the seat's public playerId without its session — the
    // impersonation the leak needed. Neither a rival account nor anonymous passes.
    expect(seatClaimAllowed("user-1", "user-2")).toBe(false);
    expect(seatClaimAllowed("user-1", null)).toBe(false);
  });
});

describe("resetAfterFailedStart", () => {
  it("un-readies both seats and falls back to selecting for a retry", () => {
    const next = resetAfterFailedStart(countdownLobby());
    expect(next.phase).toBe("selecting");
    expect(next.host.ready).toBe(false);
    expect(next.guest?.ready).toBe(false);
    // Deck picks survive — the players just re-ready, they don't re-pick.
    expect(next.host.deckId).toBe("d1");
    expect(next.guest?.deckId).toBe("d2");
    expect(next.countdownStartedAt).toBeNull();
  });

  it("CANNOT end a running match — recomputePhase never leaves in-game", () => {
    // The trap `endMatch` exists for: this helper is for a lobby still in
    // COUNTDOWN. Pointed at an in-game one it un-readies the seats but leaves the
    // phase alone (recomputePhase returns an in-game snapshot untouched), so a
    // caller that used it to tear down a live match would wedge the lobby in-game.
    const running: LobbySnapshot = { ...countdownLobby(), phase: "in-game" };
    expect(resetAfterFailedStart(running).phase).toBe("in-game");
  });
});

describe("endMatch — stopping a RUNNING match", () => {
  const running = (): LobbySnapshot => ({ ...countdownLobby(), phase: "in-game" });

  it("leaves in-game and hands the lobby back at selecting, both un-readied", () => {
    const next = endMatch(running());
    expect(next.phase).toBe("selecting");
    expect(next.host.ready).toBe(false);
    expect(next.guest?.ready).toBe(false);
    // Deck picks survive, exactly as they do after a failed start — the players
    // ready up again, they don't re-pick.
    expect(next.host.deckId).toBe("d1");
    expect(next.guest?.deckId).toBe("d2");
    expect(next.countdownStartedAt).toBeNull();
  });

  it("is the transition `abandonsMatch` reports, so commit drops the record", () => {
    const before = running();
    expect(abandonsMatch(before, endMatch(before))).toBe(true);
  });

  it("falls back to waiting when the guest already left", () => {
    const soloed: LobbySnapshot = { ...running(), guest: null };
    expect(endMatch(soloed).phase).toBe("waiting");
  });

  it("does not re-enter countdown even though both were ready", () => {
    // Un-readying is what stops the countdown re-firing straight back into a
    // handoff — the same loop-breaker resetAfterFailedStart relies on.
    expect(endMatch(running()).phase).not.toBe("countdown");
  });
});

describe("rematch — play again in the same lobby (3c-vi)", () => {
  const running = (): LobbySnapshot => ({ ...countdownLobby(), phase: "in-game" });

  it("ends the match and READIES the asker, leaving the opponent to accept", () => {
    // Pressing Rematch is an offer; the opponent accepts by readying, which is the
    // same agreement the first game needed — so no second piece of lobby state.
    const next = rematch(running(), "host");
    expect(next.phase).toBe("selecting");
    expect(next.host.ready).toBe(true);
    expect(next.guest?.ready).toBe(false);
    // Deck picks survive, so accepting is one click.
    expect(next.host.deckId).toBe("d1");
    expect(next.guest?.deckId).toBe("d2");
  });

  it("is the transition `abandonsMatch` reports, so the finished game is dropped", () => {
    // Without this the next handoff would hit its idempotency guard and re-serve
    // the game that just ended.
    const before = running();
    expect(abandonsMatch(before, rematch(before, "guest"))).toBe(true);
  });

  it("starts the countdown as soon as the other seat readies", () => {
    const offered = rematch(running(), "host");
    const accepted = applyIntent(offered, "guest", { type: "set-ready", ready: true });
    expect(accepted.phase).toBe("countdown");
  });

  it("cannot ready a seat with no deck — the asker just lands back un-readied", () => {
    const deckless: LobbySnapshot = {
      ...running(),
      host: { ...running().host, deckId: null, deckName: null },
    };
    expect(rematch(deckless, "host").host.ready).toBe(false);
  });
});

describe("applyBye — a graceful leave (3c-iv)", () => {
  const running = (): LobbySnapshot => ({ ...countdownLobby(), phase: "in-game" });

  it("frees the guest seat when no match is running", () => {
    const next = applyBye(lobbyWithGuest(), "guest");
    expect(next.guest).toBeNull();
    expect(next.phase).toBe("waiting");
  });

  it("only parks the host seat — the host id is pinned for the lobby's life", () => {
    const next = applyBye(lobbyWithGuest(), "host");
    expect(next.host.connected).toBe(false);
    expect(next.host.ready).toBe(false);
    expect(next.guest).not.toBeNull();
  });

  it("KEEPS an in-game seat, so the match record and the winner's board survive", () => {
    // The bug this closes: freeing the seat mid-match took the lobby out of
    // in-game, which drops the persisted match (abandonsMatch → commit) and blanks
    // the opponent's board — the DO has just conceded for the leaver, so that
    // would erase the result a frame after announcing it.
    for (const slot of ["host", "guest"] as const) {
      const next = applyBye(running(), slot);
      expect(next.phase).toBe("in-game");
      expect(next.guest).not.toBeNull();
      expect(abandonsMatch(running(), next)).toBe(false);
    }
  });

  it("marks the leaver away in-game, and leaves the seat that stayed alone", () => {
    const next = applyBye(running(), "guest");
    expect(next.guest?.connected).toBe(false);
    expect(next.host.connected).toBe(true);
  });

  it("is idempotent in-game, so a second bye can't undo the first", () => {
    // A leave is often TWO frames (an explicit leave() plus the unmount's). Under
    // the old guest branch the second would have freed the seat and voided the
    // match the first had just ended properly.
    const once = applyBye(running(), "guest");
    expect(applyBye(once, "guest")).toEqual(once);
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

describe("socketIsSilent — the half-open connection (3c-viii)", () => {
  const at = (ms: number) => new Date(ms);

  it("gives up on a socket whose keepalives stopped", () => {
    // The client pings every 1.5s and the runtime auto-answers, so a gap this
    // long means the connection is gone even though no close ever arrived.
    expect(socketIsSilent(at(1_000), 1_000 + SOCKET_SILENCE_MS + 1)).toBe(true);
  });

  it("leaves a socket answering on time alone, including right on the boundary", () => {
    expect(socketIsSilent(at(1_000), 1_500)).toBe(false);
    expect(socketIsSilent(at(1_000), 1_000 + SOCKET_SILENCE_MS)).toBe(false);
  });

  it("treats a socket that has NEVER auto-answered as alive", () => {
    // Every connection looks like this for its first ping, and nothing here can
    // tell "just opened" from "opened long ago and never pinged" — so the only
    // safe reading is to leave it be. Closing a healthy one-second-old socket
    // would be the worse mistake.
    expect(socketIsSilent(null, 1_000_000)).toBe(false);
  });

  it("is comfortably inside the forfeit clock it feeds", () => {
    // Detection has to fit in the budget it starts: sweep + silence + the 5s
    // grace all happen BEFORE the 90s forfeit begins, or a dead network would
    // resolve slower than a player who simply closed their tab.
    expect(LIVENESS_SWEEP_MS + SOCKET_SILENCE_MS + DISCONNECT_GRACE_MS).toBeLessThan(
      ABANDON_GRACE_MS,
    );
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
