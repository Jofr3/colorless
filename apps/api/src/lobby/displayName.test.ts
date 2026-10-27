import { describe, expect, it } from "vitest";
import { lobbyDisplayName } from "./displayName";

// The lobby's name resolution (P5). The query half needs D1, so what is pinned
// here is the rule that decides what a player's OPPONENT sees.

describe("lobbyDisplayName", () => {
  it("uses the account's name, trimmed", () => {
    expect(lobbyDisplayName("Ash")).toBe("Ash");
    expect(lobbyDisplayName("  Misty  ")).toBe("Misty");
  });

  it("strips control and format characters a name saved before the rule may hold", () => {
    expect(lobbyDisplayName("Ash\nCOLORLESS:account:logout\u202e")).toBe(
      "AshCOLORLESS:account:logout",
    );
    expect(lobbyDisplayName("\u200b\n\t")).toBeNull();
  });

  it("reports NOTHING for a blank name rather than substituting one", () => {
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
