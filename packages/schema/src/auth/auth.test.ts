import { describe, expect, it } from "vitest";
import {
  deleteAccountRequestSchema,
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
    [
      "a display name with a control character",
      { email: "a@b.co", password: "long-enough", displayName: "x\nCOLORLESS:auth:submit" },
    ],
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
    expect(updateProfileRequestSchema.parse({ displayName: "Brock\n" }).displayName).toBe("Brock");
  });

  it("strips the retired favourite-deck id an older client may still send", () => {
    expect(
      updateProfileRequestSchema.parse({ displayName: "Brock", favouriteDeckId: "deck-1" }),
    ).toEqual({ displayName: "Brock" });
  });

  it.each([
    ["a blank name", { displayName: "   " }],
    ["a missing name — unlike register, it is required here", {}],
    ["a name past 64 chars", { displayName: "x".repeat(65) }],
    ["a name with a control character", { displayName: "Brock\tCOLORLESS:account:logout" }],
    ["a name with a bidi override", { displayName: "Brock\u202e" }],
  ])("rejects %s", (_label, body) => {
    expect(updateProfileRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("deleteAccountRequestSchema", () => {
  it("accepts a password, or none for an OAuth-only account", () => {
    expect(deleteAccountRequestSchema.parse({ password: "x" })).toEqual({ password: "x" });
    expect(deleteAccountRequestSchema.parse({})).toEqual({});
  });

  it.each([
    ["an empty password", { password: "" }],
    ["a password past 256 chars", { password: "x".repeat(257) }],
  ])("rejects %s", (_label, body) => {
    expect(deleteAccountRequestSchema.safeParse(body).success).toBe(false);
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
      hasPassword: true,
      createdAt: "2026-07-09T00:00:00.000Z",
      passwordHash: "should-be-stripped",
    });
    expect(parsed).not.toHaveProperty("passwordHash");
  });
});
