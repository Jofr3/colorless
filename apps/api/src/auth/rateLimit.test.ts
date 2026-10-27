import { describe, expect, it } from "vitest";
import { rateLimitKeys } from "./rateLimit";

describe("rateLimitKeys", () => {
  it("stores hashes, never the address or the email", async () => {
    const keys = await rateLimitKeys("login", "203.0.113.9", "ash@example.com");
    for (const key of [keys.account, keys.ip]) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(keys.account).not.toBe(keys.ip);
  });

  it("normalizes the email, so casing cannot mint a fresh window", async () => {
    expect(await rateLimitKeys("login", "203.0.113.9", " Ash@Example.COM ")).toEqual(
      await rateLimitKeys("login", "203.0.113.9", "ash@example.com"),
    );
  });

  it("keys the address alone across emails, but apart per scope", async () => {
    const ash = await rateLimitKeys("login", "203.0.113.9", "ash@example.com");
    const misty = await rateLimitKeys("login", "203.0.113.9", "misty@example.com");
    const register = await rateLimitKeys("register", "203.0.113.9", "ash@example.com");
    expect(misty.ip).toBe(ash.ip);
    expect(misty.account).not.toBe(ash.account);
    expect(register.ip).not.toBe(ash.ip);
    expect(register.account).not.toBe(ash.account);
  });
});
