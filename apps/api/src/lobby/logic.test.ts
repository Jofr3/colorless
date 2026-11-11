import { COUNTDOWN_MS, LOBBY_DECK_NAME_MAX, LOBBY_ID_MAX, LOBBY_NAME_MAX } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  ABANDON_GRACE_MS,
  abandonsMatch,
  applyBye,
  DISCONNECT_GRACE_MS,
  countdownEndsAt,
  forfeitDeadlines,
  endMatch,
  FIRST_KEEPALIVE_MARGIN_MS,
  FRAME_BURST,
  FRAME_REFILL_PER_SECOND,
  type FrameBudget,
  helloDecision,
  isLegacySnapshot,
  parseClientMessage,
  readSnapshot,
  readStored,
  rematch,
  reseatHost,
  resetAfterFailedStart,
  sameSnapshot,
  seatClaimAllowed,
  seatedUsers,
  setSeatConnected,
  LIVENESS_SWEEP_MS,
  livenessSweepMs,
  SEATED_LIVENESS_SWEEP_MS,
  slotOf,
  SOCKET_SILENCE_MS,
  socketIsSilent,
  spendFrame,
  splitDuePending,
  stampCountdown,
  storedChooserSchema,
  storedCleanupAtSchema,
  storedCodeSchema,
  storedPendingSchema,
  storedSeatUsersSchema,
  withForfeitAt,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";
import {
  applyIntent,
  createLobbyState,
  type LobbyState,
  makeSeat,
  removeGuest,
  seatGuest,
} from "./snapshot";

// Public seat ids, as the DO stores (seatId.ts): 22 base64url characters.
const H1 = "h1".padEnd(22, "0");
const G1 = "g1".padEnd(22, "0");

function lobbyWithGuest(): LobbyState {
  return seatGuest(createLobbyState("ABCD", makeSeat(H1, "Ana")), G1, "Bo");
}

function countdownLobby(): LobbyState {
  let snapshot = lobbyWithGuest();
  snapshot = applyIntent(snapshot, "host", { type: "select-deck", deckId: "d1", deckName: "A" });
  snapshot = applyIntent(snapshot, "guest", { type: "select-deck", deckId: "d2", deckName: "B" });
  snapshot = applyIntent(snapshot, "host", { type: "set-ready", ready: true });
  snapshot = applyIntent(snapshot, "guest", { type: "set-ready", ready: true });
  expect(snapshot.phase).toBe("countdown");
  return snapshot;
}

describe("parseClientMessage — the length bounds", () => {
  const long = (length: number) => "x".repeat(length);

  it("refuses an id longer than the bound in every frame that carries one", () => {
    const id = long(LOBBY_ID_MAX + 1);
    for (const frame of [
      { kind: "hello", from: id, name: "Bo" },
      { kind: "intent", from: id, intent: { type: "set-ready", ready: true } },
      { kind: "intent", from: G1, intent: { type: "select-deck", deckId: id, deckName: "A" } },
      { kind: "bye", from: id, slot: "guest" },
      { kind: "rematch", from: id },
    ]) {
      expect(parseClientMessage(JSON.stringify(frame))).toBeNull();
    }
    const fits = { kind: "rematch", from: long(LOBBY_ID_MAX) };
    expect(parseClientMessage(JSON.stringify(fits))).toEqual(fits);
  });

  it("clips a name or deck name longer than the bound", () => {
    const hello = parseClientMessage(JSON.stringify({ kind: "hello", from: G1, name: long(5000) }));
    expect(hello).toEqual({ kind: "hello", from: G1, name: long(LOBBY_NAME_MAX) });
    const pick = parseClientMessage(
      JSON.stringify({
        kind: "intent",
        from: G1,
        intent: { type: "select-deck", deckId: "d1", deckName: long(5000) },
      }),
    );
    expect(pick).toMatchObject({ intent: { deckName: long(LOBBY_DECK_NAME_MAX) } });
  });

  it("strips control characters from a hello's name and a deck name", () => {
    const forged = "x\nCOLORLESS:auth:submit\u200b";
    expect(parseClientMessage(JSON.stringify({ kind: "hello", from: G1, name: forged }))).toEqual({
      kind: "hello",
      from: G1,
      name: "xCOLORLESS:auth:submit",
    });
    const pick = parseClientMessage(
      JSON.stringify({
        kind: "intent",
        from: G1,
        intent: { type: "select-deck", deckId: "d1", deckName: forged },
      }),
    );
    expect(pick).toMatchObject({ intent: { deckName: "xCOLORLESS:auth:submit" } });
  });

  it("drops the removed set-name intent, clean name or not (AU8)", () => {
    for (const name of ["Ana", "x\nCOLORLESS:auth:submit"]) {
      const rename = { kind: "intent", from: G1, intent: { type: "set-name", name } };
      expect(parseClientMessage(JSON.stringify(rename))).toBeNull();
    }
  });
});

describe("seatedUsers — the bindings worth keeping", () => {
  it("keeps the host's and guest's bindings and drops every departed id's", () => {
    const lobby = lobbyWithGuest();
    expect(seatedUsers({ [H1]: "ana", [G1]: "bo", gone: "eve", other: "zed" }, lobby)).toEqual({
      [H1]: "ana",
      [G1]: "bo",
    });
    expect(seatedUsers({ [H1]: "ana", [G1]: "bo" }, removeGuest(lobby))).toEqual({ [H1]: "ana" });
  });
});

describe("parseClientMessage", () => {
  it("parses a valid frame", () => {
    expect(parseClientMessage(JSON.stringify({ kind: "hello", from: G1, name: "Bo" }))).toEqual({
      kind: "hello",
      from: G1,
      name: "Bo",
    });
  });

  it("drops bad JSON, junk shapes and server-only frames", () => {
    expect(parseClientMessage("{nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "boom" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "heartbeat", from: "x" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ kind: "reject", to: G1, reason: "full" })),
    ).toBeNull();
  });
});

describe("slotOf", () => {
  it("resolves both seats and rejects strangers", () => {
    const snapshot = lobbyWithGuest();
    expect(slotOf(snapshot, H1)).toBe("host");
    expect(slotOf(snapshot, G1)).toBe("guest");
    expect(slotOf(snapshot, "x9")).toBeNull();
  });
});

describe("helloDecision", () => {
  it("claims the host seat in a lobby with no snapshot yet", () => {
    expect(helloDecision(null, H1)).toBe("claim-host");
  });

  it("re-seats known ids on their own seats", () => {
    const snapshot = lobbyWithGuest();
    expect(helloDecision(snapshot, H1)).toBe("reseat-host");
    expect(helloDecision(snapshot, G1)).toBe("seat-guest");
  });

  it("seats a newcomer while the guest seat is empty", () => {
    expect(helloDecision(createLobbyState("ABCD", makeSeat(H1, "Ana")), G1)).toBe("seat-guest");
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
    const inGame: LobbyState = { ...inCountdown, phase: "in-game" };
    expect(helloDecision(inGame, "g2")).toBe("reject-full");
    const countdown: LobbyState = { ...inCountdown, phase: "countdown" };
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

  it("delegates the guest seat to setGuestConnected", () => {
    const next = setSeatConnected(countdownLobby(), "guest", false);
    expect(next.guest?.connected).toBe(false);
    expect(next.guest?.ready).toBe(false);
    expect(next.phase).toBe("selecting");
  });
});

describe("the forfeit deadline on the seat (3c-v)", () => {
  const running = (): LobbyState => ({ ...countdownLobby(), phase: "in-game" });

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
    expect(seatGuest(away, G1, "Bo").guest?.forfeitAt).toBeNull();
    const hostAway = setSeatConnected(running(), "host", false, 9_000);
    expect(reseatHost(hostAway, "Ana").host.forfeitAt).toBeNull();
    // A brand-new seat never carries one.
    expect(makeSeat("x", "X").forfeitAt).toBeNull();
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
    const solo = createLobbyState("ABCD", makeSeat(H1, "Ana"));
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
      host: { id: H1, name: "Ana", deckId: null, deckName: null, ready: false, connected: true },
      guest: { id: G1, name: "Bo", deckId: null, deckName: null, ready: false, connected: false },
      countdownStartedAt: null,
    };
    const read = readSnapshot(legacy);
    expect(read?.host.forfeitAt).toBeNull();
    expect(read?.guest?.forfeitAt).toBeNull();
    expect(read?.host.avatarSeed).toBeNull();
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

  it("clips names stored before frames were bounded, rather than refusing the lobby", () => {
    const stored = lobbyWithGuest();
    const long = {
      ...stored,
      host: { ...stored.host, name: "n".repeat(5000), deckName: "d".repeat(5000) },
    };
    const read = readSnapshot(long);
    expect(read?.host.name).toBe("n".repeat(LOBBY_NAME_MAX));
    expect(read?.host.deckName).toBe("d".repeat(LOBBY_DECK_NAME_MAX));
    expect(read?.guest?.deckName).toBeNull();
    expect(readSnapshot(stored)).toEqual(stored);
  });

  it("strips control and format characters from names stored before the wire refused them", () => {
    const stored = lobbyWithGuest();
    const forged = {
      ...stored,
      host: { ...stored.host, name: "x\nCOLORLESS:auth:submit\u202e", deckName: "d\r\n\t" },
    };
    const read = readSnapshot(forged);
    expect(read?.host.name).toBe("xCOLORLESS:auth:submit");
    expect(read?.host.deckName).toBe("d");
  });

  it("reads a lobby stored before seats had public ids as legacy, and as no snapshot (LB6)", () => {
    const stored = lobbyWithGuest();
    const legacy = {
      ...stored,
      guest: stored.guest && { ...stored.guest, id: "0b7f6a2e-9c1d-4e1f-8a6b-3c2d1e0f9a8b" },
    };
    expect(isLegacySnapshot(legacy)).toBe(true);
    expect(readSnapshot(legacy)).toBeNull();
    expect(isLegacySnapshot(stored)).toBe(false);
    expect(isLegacySnapshot(undefined)).toBe(false);
    expect(isLegacySnapshot("nope")).toBe(false);
  });

  it("keeps a stored avatar seed and reads a malformed seat as no snapshot", () => {
    const stored = lobbyWithGuest();
    const seeded = { ...stored, host: { ...stored.host, avatarSeed: "seed-1" } };
    expect(readSnapshot(seeded)?.host.avatarSeed).toBe("seed-1");
    expect(readSnapshot({ ...stored, host: { ...stored.host, ready: "yes" } })).toBeNull();
    expect(readSnapshot({ ...stored, phase: "lost" })).toBeNull();
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

describe("sameSnapshot", () => {
  it("compares values, not key order or identity", () => {
    const snapshot = countdownLobby();
    const reordered = JSON.parse(
      JSON.stringify({
        ...snapshot,
        host: Object.fromEntries(Object.entries(snapshot.host).reverse()),
      }),
    ) as LobbyState;
    expect(sameSnapshot(snapshot, reordered)).toBe(true);
    expect(sameSnapshot(snapshot, reseatHost(snapshot, "Ana"))).toBe(true);
  });

  it("tells apart any changed seat field, a seat leaving, and the countdown stamp", () => {
    const snapshot = countdownLobby();
    expect(sameSnapshot(snapshot, reseatHost(snapshot, "Ana2"))).toBe(false);
    expect(sameSnapshot(snapshot, reseatHost(snapshot, "Ana", "seed"))).toBe(false);
    expect(sameSnapshot(snapshot, withForfeitAt(snapshot, "guest", 5))).toBe(false);
    expect(sameSnapshot(snapshot, stampCountdown(snapshot, 1))).toBe(false);
    expect(sameSnapshot(removeGuest(snapshot), snapshot)).toBe(false);
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
    const running: LobbyState = { ...countdownLobby(), phase: "in-game" };
    expect(resetAfterFailedStart(running).phase).toBe("in-game");
  });
});

describe("endMatch — stopping a RUNNING match", () => {
  const running = (): LobbyState => ({ ...countdownLobby(), phase: "in-game" });

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
    const soloed: LobbyState = { ...running(), guest: null };
    expect(endMatch(soloed).phase).toBe("waiting");
  });

  it("does not re-enter countdown even though both were ready", () => {
    // Un-readying is what stops the countdown re-firing straight back into a
    // handoff — the same loop-breaker resetAfterFailedStart relies on.
    expect(endMatch(running()).phase).not.toBe("countdown");
  });
});

describe("rematch — play again in the same lobby (3c-vi)", () => {
  const running = (): LobbyState => ({ ...countdownLobby(), phase: "in-game" });

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
    const deckless: LobbyState = {
      ...running(),
      host: { ...running().host, deckId: null, deckName: null },
    };
    expect(rematch(deckless, "host").host.ready).toBe(false);
  });
});

describe("applyBye — a graceful leave (3c-iv)", () => {
  const running = (): LobbyState => ({ ...countdownLobby(), phase: "in-game" });

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
    const waiting = createLobbyState("ABCD", makeSeat(H1, "Ana"));
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
    const inGame: LobbyState = { ...countdownLobby(), phase: "in-game" };
    // Any commit that leaves in-game, here removeGuest from a running match, resets
    // in-game → waiting: the transition that must drop the stale match.
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
    expect(socketIsSilent(at(1_000), 0, 1_000 + SOCKET_SILENCE_MS + 1)).toBe(true);
  });

  it("leaves a socket answering on time alone, including right on the boundary", () => {
    expect(socketIsSilent(at(1_000), 0, 1_500)).toBe(false);
    expect(socketIsSilent(at(1_000), 0, 1_000 + SOCKET_SILENCE_MS)).toBe(false);
  });

  it("gives a socket that has NEVER auto-answered one window from its upgrade, plus the margin", () => {
    const window = SOCKET_SILENCE_MS + FIRST_KEEPALIVE_MARGIN_MS;
    expect(socketIsSilent(null, 1_000, 1_000)).toBe(false);
    expect(socketIsSilent(null, 1_000, 1_000 + window)).toBe(false);
    expect(socketIsSilent(null, 1_000, 1_000 + window + 1)).toBe(true);
  });

  it("is comfortably inside the forfeit clock it feeds", () => {
    // Detection has to fit in the budget it starts: sweep + silence + the 5s
    // grace all happen BEFORE the 90s forfeit begins, or a dead network would
    // resolve slower than a player who simply closed their tab.
    expect(LIVENESS_SWEEP_MS + SOCKET_SILENCE_MS + DISCONNECT_GRACE_MS).toBeLessThan(
      ABANDON_GRACE_MS,
    );
  });

  it("tells a seated opponent within 20s, inside a 30s outage", () => {
    expect(SEATED_LIVENESS_SWEEP_MS + SOCKET_SILENCE_MS + DISCONNECT_GRACE_MS).toBeLessThanOrEqual(
      20_000,
    );
  });
});

describe("livenessSweepMs — the sweep's cadence", () => {
  it("polls every 30s with no lobby or one seat held: nobody to tell", () => {
    expect(livenessSweepMs(null)).toBe(LIVENESS_SWEEP_MS);
    expect(livenessSweepMs(createLobbyState("ABCD", makeSeat(H1, "Ana")))).toBe(LIVENESS_SWEEP_MS);
  });

  it("polls every 5s while both seats are held, in the versus screen or a match", () => {
    expect(livenessSweepMs(lobbyWithGuest())).toBe(SEATED_LIVENESS_SWEEP_MS);
    expect(livenessSweepMs({ ...lobbyWithGuest(), phase: "in-game" })).toBe(
      SEATED_LIVENESS_SWEEP_MS,
    );
    expect(SEATED_LIVENESS_SWEEP_MS).toBeLessThan(LIVENESS_SWEEP_MS);
  });
});

describe("pending-disconnect bookkeeping", () => {
  it("adds, refreshes and removes entries by player", () => {
    let pending = withPendingDisconnect([], G1, 5000);
    pending = withPendingDisconnect(pending, H1, 6000);
    pending = withPendingDisconnect(pending, G1, 7000); // refresh, not duplicate
    expect(pending).toHaveLength(2);
    expect(pending.find((entry) => entry.playerId === G1)?.deadline).toBe(7000);
    expect(withoutPendingDisconnect(pending, G1).map((entry) => entry.playerId)).toEqual([H1]);
  });

  it("splits due from waiting at a boundary-inclusive deadline", () => {
    const pending = [
      { playerId: G1, deadline: 5000 },
      { playerId: H1, deadline: 6000 },
    ];
    const { due, waiting } = splitDuePending(pending, 5000);
    expect(due.map((entry) => entry.playerId)).toEqual([G1]);
    expect(waiting.map((entry) => entry.playerId)).toEqual([H1]);
  });
});

describe("readStored — the DO's smaller storage keys", () => {
  // DO storage round-trips values through the structured clone algorithm.
  const stored = <T>(value: T): unknown => structuredClone(value);

  it("reads back what each writer stores", () => {
    const pending = withPendingDisconnect(withPendingDisconnect([], G1, 5000), H1, 6000);
    expect(readStored(storedPendingSchema, stored(pending))).toEqual(pending);
    expect(readStored(storedPendingSchema, stored([]))).toEqual([]);
    const seatUsers = { h1: "user-a", g1: "user-b" };
    expect(readStored(storedSeatUsersSchema, stored(seatUsers))).toEqual(seatUsers);
    expect(readStored(storedCodeSchema, stored("ABCD"))).toBe("ABCD");
    expect(readStored(storedCleanupAtSchema, stored(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(readStored(storedChooserSchema, stored(G1))).toBe(G1);
  });

  it("reads an absent or unreadable value as never written", () => {
    expect(readStored(storedPendingSchema, undefined)).toBeUndefined();
    expect(readStored(storedPendingSchema, [{ playerId: G1 }])).toBeUndefined();
    expect(readStored(storedPendingSchema, [{ playerId: G1, deadline: "soon" }])).toBeUndefined();
    expect(readStored(storedSeatUsersSchema, { g1: 7 })).toBeUndefined();
    expect(readStored(storedSeatUsersSchema, G1)).toBeUndefined();
    expect(readStored(storedCodeSchema, 1234)).toBeUndefined();
    expect(readStored(storedCleanupAtSchema, "later")).toBeUndefined();
    expect(readStored(storedCleanupAtSchema, Number.NaN)).toBeUndefined();
    expect(readStored(storedChooserSchema, null)).toBeUndefined();
  });
});

describe("spendFrame — a socket's frame budget (LB1)", () => {
  /** How many frames in a row `spendFrame` allows at `now` from `budget`. */
  function allowed(budget: FrameBudget | undefined, now: number): number {
    let count = 0;
    for (let next = spendFrame(budget, now); next !== null; next = spendFrame(next, now)) count++;
    return count;
  }

  it("starts a socket with the burst, which covers a reconnect's queued frames and hello", () => {
    expect(allowed(undefined, 0)).toBe(FRAME_BURST);
    // The client queues up to 32 frames while its link is down (channel.ts), plus one hello.
    expect(FRAME_BURST).toBeGreaterThan(32 + 1);
  });

  it("refills at the set rate up to the burst, and never from a clock that went back", () => {
    const empty: FrameBudget = { tokens: 0, at: 1_000 };
    expect(spendFrame(empty, 1_000)).toBeNull();
    expect(allowed(empty, 1_000 + 1_000)).toBe(FRAME_REFILL_PER_SECOND);
    expect(allowed(empty, 1_000 + 60_000)).toBe(FRAME_BURST);
    expect(spendFrame(empty, 0)).toBeNull();
  });

  it("lets a socket paced at the refill rate send without end", () => {
    let budget: FrameBudget | null | undefined;
    const step = 1000 / FRAME_REFILL_PER_SECOND;
    for (let i = 0; i < 1_000; i++) {
      budget = spendFrame(budget ?? undefined, i * step);
      expect(budget).not.toBeNull();
    }
  });
});
