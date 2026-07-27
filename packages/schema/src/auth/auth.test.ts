import { describe, expect, it } from "vitest";
import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  userSchema,
} from "./index";

describe("registerRequestSchema", () => {
  it("accepts a minimal valid body and lowercases the email", () => {
    const parsed = registerRequestSchema.parse({
      email: "Ash.Ketchum@Example.COM",
      password: "pikachu-123",
    });
    expect(parsed.email).toBe("ash.ketchum@example.com");
    expect(parsed.displayName).toBeUndefined();
  });

  it("trims the display name", () => {
    const parsed = registerRequestSchema.parse({
      email: "misty@example.com",
      password: "starmie-456",
      displayName: "  Misty  ",
    });
    expect(parsed.displayName).toBe("Misty");
  });

  it.each([
    ["bad email", { email: "not-an-email", password: "long-enough" }],
    ["short password", { email: "a@b.co", password: "seven77" }],
    ["blank display name", { email: "a@b.co", password: "long-enough", displayName: "   " }],
  ])("rejects %s", (_label, body) => {
    expect(registerRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("loginRequestSchema", () => {
  it("accepts short passwords (policy applies to register only)", () => {
    const parsed = loginRequestSchema.parse({ email: "A@B.CO", password: "x" });
    expect(parsed.email).toBe("a@b.co");
  });

  it("rejects an empty password", () => {
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("updateProfileRequestSchema", () => {
  it("trims the new display name", () => {
    expect(updateProfileRequestSchema.parse({ displayName: "  Brock  " }).displayName).toBe(
      "Brock",
    );
  });

  it("carries a favourite-deck id when given one", () => {
    expect(
      updateProfileRequestSchema.parse({ displayName: "Brock", favouriteDeckId: "deck-1" })
        .favouriteDeckId,
    ).toBe("deck-1");
  });

  it("accepts null to clear the favourite, and absent to leave it unchanged", () => {
    expect(
      updateProfileRequestSchema.parse({ displayName: "Brock", favouriteDeckId: null })
        .favouriteDeckId,
    ).toBeNull();
    // Omitted → undefined: the handler reads that as "don't touch it".
    expect(updateProfileRequestSchema.parse({ displayName: "Brock" }).favouriteDeckId).toBeUndefined();
  });

  it.each([
    ["a blank name", { displayName: "   " }],
    ["a missing name — unlike register, it is required here", {}],
    ["a name past 64 chars", { displayName: "x".repeat(65) }],
    ["a non-string favourite id", { displayName: "Brock", favouriteDeckId: 7 }],
  ])("rejects %s", (_label, body) => {
    expect(updateProfileRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("userSchema", () => {
  it("has no password-shaped fields, even via passthrough attempts", () => {
    const parsed = userSchema.parse({
      id: "u1",
      email: "a@b.co",
      displayName: "Ash",
      emailVerified: false,
      avatarSeed: "1a2b3c4d",
      favouriteDeckId: null,
      createdAt: "2026-07-09T00:00:00.000Z",
      passwordHash: "should-be-stripped",
    });
    expect(parsed).not.toHaveProperty("passwordHash");
  });
});
