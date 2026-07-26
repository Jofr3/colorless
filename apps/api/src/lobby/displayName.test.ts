import { describe, expect, it } from "vitest";
import { lobbyDisplayName } from "./displayName";

// The lobby's name resolution (P5). The query half needs D1, so what is pinned
// here is the rule that decides what a player's OPPONENT sees.

describe("lobbyDisplayName", () => {
  it("uses the account's name, trimmed", () => {
    expect(lobbyDisplayName("Ash")).toBe("Ash");
    expect(lobbyDisplayName("  Misty  ")).toBe("Misty");
  });

  it("reports NOTHING for a blank name rather than substituting one", () => {
    // The caller falls back to the client-announced handle. The one substitution
    // that suggests itself — the email, which AccountButton uses — must never be
    // made here: that control shows a user their OWN address, while a lobby name
    // is broadcast to the opponent and to spectators.
    expect(lobbyDisplayName("")).toBeNull();
    expect(lobbyDisplayName("   ")).toBeNull();
  });

  it("reads a missing account the same as no session", () => {
    // A session pointing at a deleted user must not throw or invent a name; the
    // lobby simply keeps the announced handle.
    expect(lobbyDisplayName(null)).toBeNull();
    expect(lobbyDisplayName(undefined)).toBeNull();
  });
});
