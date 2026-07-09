import { describe, expect, it } from "vitest";
import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url } from "./encoding";

describe("base64url round-trip", () => {
  it("round-trips arbitrary bytes, unpadded and URL-safe", () => {
    for (const length of [0, 1, 2, 3, 16, 32, 33]) {
      const bytes = randomBytes(length);
      const encoded = toBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(encoded).not.toContain("=");
      expect(fromBase64Url(encoded)).toEqual(bytes);
    }
  });

  it("encodes the RFC 4648 URL-safe alphabet (0xfb 0xff → -_ chars)", () => {
    // Standard base64 of [0xfb, 0xef, 0xff] is "++//" territory: expect - and _.
    expect(toBase64Url(new Uint8Array([0xfb, 0xef, 0xff]))).toBe("--__");
  });

  it("rejects malformed input with null, never throwing", () => {
    for (const bad of ["a+b", "a/b", "a=b", "€", "ab cd"]) {
      expect(fromBase64Url(bad)).toBeNull();
    }
  });
});

describe("constantTimeEqual", () => {
  it("matches equal bytes and rejects any difference", () => {
    const a = new Uint8Array([1, 2, 3, 255]);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 255]))).toBe(true);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 254]))).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
