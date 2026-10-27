import {
  isPublicSeatId,
  isSeatSecret,
  PUBLIC_SEAT_ID_LENGTH,
  publicSeatId,
  SEAT_SECRET_LENGTH,
  seatSecretFrom,
  sha256,
} from "@colorless/schema";
import { describe, expect, it } from "vitest";

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("the seat id hash (LB6)", () => {
  it("is SHA-256: it matches WebCrypto's digest across the padding boundaries", async () => {
    for (const length of [0, 1, 3, 43, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const message = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 255);
      const expected = hex(await crypto.subtle.digest("SHA-256", message));
      expect(hex(sha256(message)), `length ${length}`).toBe(expected);
    }
  });

  it("names a seat by the base64url SHA-256 prefix of its 256-bit secret", async () => {
    const secret = seatSecretFrom(crypto.getRandomValues(new Uint8Array(32)));
    expect(secret).toHaveLength(SEAT_SECRET_LENGTH);
    expect(isSeatSecret(secret)).toBe(true);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    );
    const expected = btoa(String.fromCharCode(...digest))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .slice(0, PUBLIC_SEAT_ID_LENGTH);
    expect(publicSeatId(secret)).toBe(expected);
    expect(isPublicSeatId(publicSeatId(secret))).toBe(true);
  });

  it("takes neither a public id nor a pre-split UUID playerId as a secret", () => {
    const uuid = "0b7f6a2e-9c1d-4e1f-8a6b-3c2d1e0f9a8b";
    const id = publicSeatId(seatSecretFrom(new Uint8Array(32)));
    expect(isSeatSecret(id)).toBe(false);
    expect(isSeatSecret(uuid)).toBe(false);
    expect(isPublicSeatId(uuid)).toBe(false);
  });
});
