// A lobby seat's two names (LB6). The client mints a SECRET per tab and lobby and presents it only
// in its hello; everything the lobby broadcasts names the seat by its PUBLIC id, a hash of the
// secret. Knowing a public id from a snapshot therefore does not let anyone claim the seat, and the
// lobby stores no secret: it hashes the hello's and looks the seat up by the result.
// Zod-free and synchronous, because both the web client (to recognize its own seat) and the
// Durable Object (between storage reads, without an await that would let other events in) derive
// the public id.

/** A seat secret: 32 CSPRNG bytes as unpadded base64url, minted by the client per tab and lobby. */
export const SEAT_SECRET_LENGTH = 43;
/** A public seat id: the first 22 base64url characters (132 bits) of SHA-256(secret). */
export const PUBLIC_SEAT_ID_LENGTH = 22;

const SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SEAT_SECRET_LENGTH}}$`);
const PUBLIC_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${PUBLIC_SEAT_ID_LENGTH}}$`);

/** Whether `value` has a seat secret's shape. A client from before the split sent a UUID, which
    does not. */
export function isSeatSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** Whether `value` has a public seat id's shape. A lobby stored before the split seats UUIDs. */
export function isPublicSeatId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

/** A seat secret from 32 CSPRNG bytes (the caller's: the schema package names no platform). */
export function seatSecretFrom(bytes: Uint8Array): string {
  return base64url(bytes);
}

/** The public id of the seat `secret` claims. A secret is ASCII, so its characters are its bytes. */
export function publicSeatId(secret: string): string {
  const bytes = Uint8Array.from(secret, (char) => char.charCodeAt(0) & 0xff);
  return base64url(sha256(bytes)).slice(0, PUBLIC_SEAT_ID_LENGTH);
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url. */
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += BASE64URL[(triple >> (18 - 6 * j)) & 63];
  }
  return out;
}

// SHA-256 (FIPS 180-4). WebCrypto's digest is asynchronous, hence this; apps/api's
// `seatId.test.ts` pins it to WebCrypto's.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** The SHA-256 digest of `message`. */
export function sha256(message: Uint8Array): Uint8Array {
  // Pad: a 1 bit, zeros to 56 mod 64 bytes, then the bit length as a 64-bit big-endian integer.
  const length = message.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + 4 * t);
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1;
    }
    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] ?? 0) + a;
    hash[1] = (hash[1] ?? 0) + b;
    hash[2] = (hash[2] ?? 0) + c;
    hash[3] = (hash[3] ?? 0) + d;
    hash[4] = (hash[4] ?? 0) + e;
    hash[5] = (hash[5] ?? 0) + f;
    hash[6] = (hash[6] ?? 0) + g;
    hash[7] = (hash[7] ?? 0) + h;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(4 * i, hash[i] ?? 0);
  return out;
}
