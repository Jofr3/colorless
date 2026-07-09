import { describe, expect, it } from "vitest";
import {
  clearedSessionCookie,
  generateSessionToken,
  hashSessionToken,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookie,
} from "./session";

describe("generateSessionToken", () => {
  it("mints 43-char base64url tokens (256 bits), unique per call", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateSessionToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe("hashSessionToken", () => {
  it("matches a known SHA-256 vector, base64url-encoded", async () => {
    // sha256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad
    expect(await hashSessionToken("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  it("is deterministic and never the token itself", async () => {
    const token = generateSessionToken();
    const hash = await hashSessionToken(token);
    expect(await hashSessionToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
  });
});

describe("session cookie serialization", () => {
  it("installs the token with the §3.5 attributes", () => {
    const cookie = sessionCookie("tok123");
    expect(cookie).toBe(
      `session=tok123; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=None`,
    );
    expect(SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("clears with Max-Age=0 and the same attributes", () => {
    expect(clearedSessionCookie()).toBe(
      "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None",
    );
  });
});

describe("readCookie", () => {
  it("finds the named cookie among others, whitespace-tolerant", () => {
    const header = "theme=dark; session=abc123 ;other=1";
    expect(readCookie(header, SESSION_COOKIE)).toBe("abc123");
    expect(readCookie(header, "theme")).toBe("dark");
    expect(readCookie(header, "other")).toBe("1");
  });

  it("returns null for missing header, missing cookie, or empty value", () => {
    expect(readCookie(undefined, "session")).toBeNull();
    expect(readCookie(null, "session")).toBeNull();
    expect(readCookie("", "session")).toBeNull();
    expect(readCookie("theme=dark", "session")).toBeNull();
    expect(readCookie("session=", "session")).toBeNull();
    expect(readCookie("session", "session")).toBeNull();
  });

  it("does not confuse prefixed names or values containing '='", () => {
    expect(readCookie("xsession=nope; session=yes", "session")).toBe("yes");
    expect(readCookie("session=a=b", "session")).toBe("a=b");
  });
});
