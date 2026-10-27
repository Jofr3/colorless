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

  it("keys the email's failure cap alone, the same from every address (AU6)", async () => {
    const here = await rateLimitKeys("login", "203.0.113.9", "Ash@Example.com");
    const there = await rateLimitKeys("login", "2001:db8::/64", "ash@example.com");
    expect(here.email).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(there.email).toBe(here.email);
    expect(new Set([here.email, here.account, here.ip]).size).toBe(3);
    expect((await rateLimitKeys("login", "203.0.113.9", "misty@example.com")).email).not.toBe(
      here.email,
    );
  });
});
