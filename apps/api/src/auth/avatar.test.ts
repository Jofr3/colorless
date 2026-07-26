import { describe, expect, it } from "vitest";
import { avatarSeedFrom, avatarSeedOf } from "./avatar";

// The generated avatar's token (P5-2). What matters is that the SAME account
// always draws the same face, that different accounts usually don't, and that
// the account id itself never crosses the wire.

describe("avatarSeedFrom", () => {
  it("is stable for an account — the whole point of a generated face", () => {
    const id = "7a0f2f38-6b2f-4d5b-9d4e-2f9b0e8c1a11";
    expect(avatarSeedFrom(id)).toBe(avatarSeedFrom(id));
  });

  it("separates accounts that differ by a single character", () => {
    // A weak hash that clustered near-identical uuids would give half a lobby
    // the same face.
    const a = avatarSeedFrom("7a0f2f38-6b2f-4d5b-9d4e-2f9b0e8c1a11");
    const b = avatarSeedFrom("7a0f2f38-6b2f-4d5b-9d4e-2f9b0e8c1a12");
    expect(a).not.toBe(b);
  });

  it("never returns the account id itself", () => {
    // The snapshot is broadcast to the opponent and to spectators; an internal
    // primary key is the wrong thing to publish there.
    const id = "7a0f2f38-6b2f-4d5b-9d4e-2f9b0e8c1a11";
    const seed = avatarSeedFrom(id);
    expect(seed).not.toContain(id);
    expect(seed).toMatch(/^[0-9a-f]{8}$/);
  });

  it("gives an anonymous socket no face rather than a throwaway one", () => {
    // A per-visit id would draw a face that changes every visit, promising an
    // identity that isn't there; the client renders the generic figure instead.
    expect(avatarSeedFrom(null)).toBeNull();
  });

  it("agrees with avatarSeedOf — the profile's face IS the lobby's face", () => {
    // /auth/me goes through avatarSeedOf and the lobby seat through
    // avatarSeedFrom; two derivations that could drift would show a player one
    // face on their profile and their opponents another.
    const id = "7a0f2f38-6b2f-4d5b-9d4e-2f9b0e8c1a11";
    expect(avatarSeedOf(id)).toBe(avatarSeedFrom(id));
  });
});
