import { describe, expect, it } from "vitest";
import {
  applyIntent,
  bothReady,
  createSnapshot,
  makePlayer,
  removeGuest,
  seatGuest,
  setGuestConnected,
} from "./lobbyReducer";
import type { LobbySnapshot } from "./types";

const hostReady = (s: LobbySnapshot) =>
  applyIntent(
    applyIntent(s, "host", { type: "select-deck", deckId: "d-host", deckName: "Host Deck" }),
    "host",
    { type: "set-ready", ready: true },
  );

const guestReady = (s: LobbySnapshot) =>
  applyIntent(
    applyIntent(s, "guest", { type: "select-deck", deckId: "d-guest", deckName: "Guest Deck" }),
    "guest",
    { type: "set-ready", ready: true },
  );

const freshLobby = () => createSnapshot("ABCD", makePlayer("host-1", "Host"));

describe("createSnapshot", () => {
  it("starts waiting with no guest", () => {
    const s = freshLobby();
    expect(s.phase).toBe("waiting");
    expect(s.guest).toBeNull();
    expect(bothReady(s)).toBe(false);
  });
});

describe("seatGuest", () => {
  it("seats a fresh guest and moves to selecting", () => {
    const s = seatGuest(freshLobby(), "guest-1", "Guest");
    expect(s.guest?.id).toBe("guest-1");
    expect(s.guest?.ready).toBe(false);
    expect(s.phase).toBe("selecting");
  });

  it("treats a same-id hello as a reconnect, keeping deck and ready", () => {
    let s = seatGuest(freshLobby(), "guest-1", "Guest");
    s = applyIntent(s, "guest", { type: "select-deck", deckId: "d1", deckName: "Deck 1" });
    s = applyIntent(s, "guest", { type: "set-ready", ready: true });
    const reconnected = seatGuest(s, "guest-1", "Guest Renamed");
    expect(reconnected.guest?.deckId).toBe("d1");
    expect(reconnected.guest?.ready).toBe(true);
    expect(reconnected.guest?.name).toBe("Guest Renamed");
  });

  it("lets a different id take a disconnected seat as a fresh player", () => {
    let s = seatGuest(freshLobby(), "guest-1", "Guest");
    s = applyIntent(s, "guest", { type: "select-deck", deckId: "d1", deckName: "Deck 1" });
    const takenOver = seatGuest(s, "guest-2", "New Guest");
    expect(takenOver.guest?.id).toBe("guest-2");
    expect(takenOver.guest?.deckId).toBeNull();
  });
});

describe("applyIntent", () => {
  it("gates ready on having a deck", () => {
    const s = applyIntent(seatGuest(freshLobby(), "guest-1", "Guest"), "guest", {
      type: "set-ready",
      ready: true,
    });
    expect(s.guest?.ready).toBe(false);
  });

  it("renames without touching the phase", () => {
    const s = seatGuest(freshLobby(), "guest-1", "Guest");
    const renamed = applyIntent(s, "host", { type: "set-name", name: "Champ" });
    expect(renamed.host.name).toBe("Champ");
    expect(renamed.phase).toBe(s.phase);
  });

  it("is a no-op for an empty seat", () => {
    const s = freshLobby();
    expect(applyIntent(s, "guest", { type: "set-name", name: "x" })).toBe(s);
  });
});

describe("readiness transitions", () => {
  it("enters countdown only when both are ready", () => {
    let s = seatGuest(freshLobby(), "guest-1", "Guest");
    s = hostReady(s);
    expect(s.phase).toBe("selecting");
    s = guestReady(s);
    expect(bothReady(s)).toBe(true);
    expect(s.phase).toBe("countdown");
  });

  it("falls back to selecting and clears the countdown stamp when someone unreadies", () => {
    let s = guestReady(hostReady(seatGuest(freshLobby(), "guest-1", "Guest")));
    // Simulate the host having stamped the countdown start.
    s = { ...s, countdownStartedAt: 123 };
    s = applyIntent(s, "guest", { type: "set-ready", ready: false });
    expect(s.phase).toBe("selecting");
    expect(s.countdownStartedAt).toBeNull();
  });
});

describe("removeGuest", () => {
  it("returns to waiting and drops the host's ready", () => {
    let s = guestReady(hostReady(seatGuest(freshLobby(), "guest-1", "Guest")));
    expect(s.host.ready).toBe(true);
    s = removeGuest(s);
    expect(s.guest).toBeNull();
    expect(s.host.ready).toBe(false);
    expect(s.phase).toBe("waiting");
    expect(s.countdownStartedAt).toBeNull();
  });
});

describe("setGuestConnected", () => {
  it("drops the guest's ready on disconnect so a match can't start without them", () => {
    let s = guestReady(hostReady(seatGuest(freshLobby(), "guest-1", "Guest")));
    expect(s.phase).toBe("countdown");
    s = setGuestConnected(s, false);
    expect(s.guest?.connected).toBe(false);
    expect(s.guest?.ready).toBe(false);
    expect(s.phase).toBe("selecting");
  });
});
