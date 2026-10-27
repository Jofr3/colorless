import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITERATIONS,
  DUMMY_PASSWORD_HASH,
  dummyPasswordHash,
  hashPassword,
  NO_PEPPERS,
  type Peppers,
  parsePasswordHash,
  passwordNeedsRehash,
  pepperOf,
  peppersOf,
  pepperUnavailable,
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

describe("pepper (AU9)", () => {
  const peppers = async (...secrets: string[]): Promise<Peppers> => {
    const all = await Promise.all(secrets.map(pepperOf));
    return { current: all[0] ?? null, all };
  };

  it("emits pbkdf2p$<pepper id>$iters$salt$hash and verifies only with that pepper", async () => {
    const pepper = await pepperOf("pepper-one");
    const encoded = await hashPassword("secret-pass", FAST, pepper);
    expect(encoded).toMatch(/^pbkdf2p\$[A-Za-z0-9_-]{8}\$1000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(parsePasswordHash(encoded)).toMatchObject({ pepperId: pepper.id, iterations: FAST });
    expect(await verifyPassword("secret-pass", encoded, await peppers("pepper-one"))).toBe(true);
    expect(await verifyPassword("secret-pasz", encoded, await peppers("pepper-one"))).toBe(false);
    // Without its pepper a peppered hash verifies nothing, and says why.
    expect(await verifyPassword("secret-pass", encoded)).toBe(false);
    expect(await verifyPassword("secret-pass", encoded, await peppers("pepper-two"))).toBe(false);
    expect(pepperUnavailable(encoded, await peppers("pepper-two"))).toBe(true);
    expect(pepperUnavailable(encoded, await peppers("pepper-two", "pepper-one"))).toBe(false);
    expect(
      await verifyPassword("secret-pass", encoded, await peppers("pepper-two", "pepper-one")),
    ).toBe(true);
  });

  it("stretches the peppered MAC, not the password: the same salt without it fails", async () => {
    const peppered = await hashPassword("secret-pass", FAST, await pepperOf("pepper-one"));
    const [, , iterations, salt, hash] = peppered.split("$");
    expect(await verifyPassword("secret-pass", `pbkdf2$${iterations}$${salt}$${hash}`)).toBe(false);
  });

  it("keeps verifying unpeppered hashes once there is a pepper", async () => {
    const plain = await hashPassword("legacy-pass", FAST);
    const withPepper = await peppers("pepper-one");
    expect(await verifyPassword("legacy-pass", plain, withPepper)).toBe(true);
    expect(pepperUnavailable(plain, withPepper)).toBe(false);
  });

  it("flags unpeppered and other-pepper hashes for rehash once there is a pepper", async () => {
    const one = await pepperOf("pepper-one");
    const two = await pepperOf("pepper-two");
    const strong = (encoded: string) => encoded.replace(`$${FAST}$`, `$${DEFAULT_ITERATIONS}$`);
    const plain = strong(await hashPassword("p@ssw0rd!", FAST));
    const underOne = strong(await hashPassword("p@ssw0rd!", FAST, one));
    expect(passwordNeedsRehash(plain)).toBe(false);
    expect(passwordNeedsRehash(plain, one)).toBe(true);
    expect(passwordNeedsRehash(underOne, one)).toBe(false);
    expect(passwordNeedsRehash(underOne, two)).toBe(true);
  });

  it("names each pepper by a stable id that is not the secret", async () => {
    const one = await pepperOf("pepper-one");
    expect((await pepperOf("pepper-one")).id).toBe(one.id);
    expect((await pepperOf("pepper-two")).id).not.toBe(one.id);
    expect(one.id).not.toContain("pepper");
  });

  it("reads the peppers from the env, the previous one included", async () => {
    expect(await peppersOf({})).toBe(NO_PEPPERS);
    expect(await peppersOf({ PASSWORD_PEPPER_PREVIOUS: "old" })).toBe(NO_PEPPERS);
    const rotating = await peppersOf({ PASSWORD_PEPPER: "new", PASSWORD_PEPPER_PREVIOUS: "old" });
    expect(rotating.current?.id).toBe((await pepperOf("new")).id);
    expect(rotating.all.map((pepper) => pepper.id)).toEqual([
      (await pepperOf("new")).id,
      (await pepperOf("old")).id,
    ]);
  });

  it("rejects a malformed pepper id", async () => {
    const encoded = await hashPassword("secret-pass", FAST, await pepperOf("pepper-one"));
    const [, id, ...rest] = encoded.split("$");
    for (const bad of ["", "short", `${id}x`]) {
      expect(parsePasswordHash(["pbkdf2p", bad, ...rest].join("$"))).toBeNull();
    }
    expect(parsePasswordHash(["pbkdf2p", ...rest].join("$"))).toBeNull();
  });

  it("re-mints the dummy hash under the current pepper, so unknown emails cost the same", async () => {
    const pepper = await pepperOf("pepper-one");
    const dummy = dummyPasswordHash(pepper);
    expect(parsePasswordHash(dummy)).toMatchObject({
      pepperId: pepper.id,
      iterations: DEFAULT_ITERATIONS,
    });
    expect(pepperUnavailable(dummy, await peppers("pepper-one"))).toBe(false);
    expect(await verifyPassword("password", dummy, await peppers("pepper-one"))).toBe(false);
    expect(dummyPasswordHash(null)).toBe(DUMMY_PASSWORD_HASH);
  });
});
