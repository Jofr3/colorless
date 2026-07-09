import { describe, expect, it } from "vitest";
import { loginRequestSchema, registerRequestSchema, userSchema } from "./index";

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

describe("userSchema", () => {
  it("has no password-shaped fields, even via passthrough attempts", () => {
    const parsed = userSchema.parse({
      id: "u1",
      email: "a@b.co",
      displayName: "Ash",
      emailVerified: false,
      createdAt: "2026-07-09T00:00:00.000Z",
      passwordHash: "should-be-stripped",
    });
    expect(parsed).not.toHaveProperty("passwordHash");
  });
});
