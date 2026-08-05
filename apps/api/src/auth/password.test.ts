// PBKDF2 round-trip + encoding hygiene. WebCrypto (crypto.subtle) is a
// global in vitest's node environment, same API surface as Workers. Tests
// pass a low iteration count so the suite stays fast; the default only
// matters for needsRehash decisions, asserted separately.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITERATIONS,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  parsePasswordHash,
  passwordNeedsRehash,
  verifyPassword,
} from "./password";

const FAST = 1_000;

describe("hashPassword / verifyPassword", () => {
  it("round-trips the right password and rejects the wrong one", async () => {
    const encoded = await hashPassword("correct horse battery", FAST);
    expect(await verifyPassword("correct horse battery", encoded)).toBe(true);
    expect(await verifyPassword("correct horse batterz", encoded)).toBe(false);
    expect(await verifyPassword("", encoded)).toBe(false);
  });

  it("emits the self-describing pbkdf2$iters$salt$hash encoding", async () => {
    const encoded = await hashPassword("secret-pass", FAST);
    expect(encoded).toMatch(/^pbkdf2\$1000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    const parsed = parsePasswordHash(encoded);
    expect(parsed?.iterations).toBe(FAST);
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.hash.length).toBe(32);
  });

  it("salts: hashing the same password twice differs", async () => {
    expect(await hashPassword("same-pass", FAST)).not.toBe(await hashPassword("same-pass", FAST));
  });

  it("rejects tampered encodings without throwing", async () => {
    const encoded = await hashPassword("secret-pass", FAST);
    const [scheme, iters, salt, hash] = encoded.split("$") as [string, string, string, string];
    const flip = (text: string) =>
      text.startsWith("A") ? `B${text.slice(1)}` : `A${text.slice(1)}`;
    const tampered = [
      `${scheme}$${iters}$${salt}$${flip(hash)}`, // hash bit-flipped
      `${scheme}$${iters}$${flip(salt)}$${hash}`, // salt bit-flipped
      `bcrypt$${iters}$${salt}$${hash}`, // unknown scheme
      `${scheme}$0$${salt}$${hash}`, // zero iterations
      `${scheme}$99999999999$${salt}$${hash}`, // absurd iterations (CPU pin)
      `${scheme}$${iters}$${salt}`, // missing field
      `${scheme}$${iters}$${salt}$${hash}$extra`, // extra field
      "", // empty
      "not-a-hash",
    ];
    for (const bad of tampered) {
      expect(await verifyPassword("secret-pass", bad)).toBe(false);
    }
  });
});

describe("iteration upgrade path", () => {
  it("verifies with the iteration count READ FROM the stored encoding", async () => {
    const old = await hashPassword("legacy-pass", FAST);
    // No hint passed to verify — it must recover 1000 from the string.
    expect(await verifyPassword("legacy-pass", old)).toBe(true);
  });

  it("flags below-default and malformed hashes for rehash, not current ones", async () => {
    expect(passwordNeedsRehash(await hashPassword("p@ssw0rd!", FAST))).toBe(true);
    expect(passwordNeedsRehash("garbage")).toBe(true);
    // A default-strength hash is fine as-is. Build it cheaply by string
    // surgery: needsRehash only reads the iterations field.
    const cheap = await hashPassword("p@ssw0rd!", FAST);
    const current = cheap.replace(`$${FAST}$`, `$${DEFAULT_ITERATIONS}$`);
    expect(passwordNeedsRehash(current)).toBe(false);
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a valid default-strength encoding that verifies nothing guessable", async () => {
    expect(parsePasswordHash(DUMMY_PASSWORD_HASH)?.iterations).toBe(DEFAULT_ITERATIONS);
    expect(passwordNeedsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
