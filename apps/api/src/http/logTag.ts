// Pseudonymous tags for log lines (security audit AU10). An auth event names the account it
// concerns, and a refusal the network it came from, by a keyed HMAC-SHA256 of the id, truncated:
// the same account always gets the same tag, so one account's events line up across requests and
// addresses, while a log reader without the `LOG_TAG_KEY` Worker secret can neither reverse a tag
// nor compute one from an id, email or IP they already know. That holds for the app's lines alone:
// Cloudflare's invocation event for the same request, which shares its request id, records the
// client IP and geolocation. Never use `avatarSeed` for this: it is public in lobbies and an
// unkeyed 32-bit hash.
//
// Without the secret (dev, tests, a Worker deployed before `wrangler secret put LOG_TAG_KEY`)
// every tag is the literal UNTAGGED, so nothing identifying is logged in its place.

import { toBase64Url } from "../auth/encoding";

/** What a tag reads when LOG_TAG_KEY is not set. */
export const UNTAGGED = "untagged";
/** Base64url characters kept from the MAC: 72 bits, enough that two accounts in a day's logs
    never share one. */
const TAG_LENGTH = 12;

export type TagKind = "account" | "net";

/** The imported key per secret value, per isolate. */
const keys = new Map<string, Promise<CryptoKey>>();

function macKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (key === undefined) {
    key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keys.set(secret, key);
  }
  return key;
}

/** The tag of `value` (an account id, or a clientIpKey for "net"), or UNTAGGED without a key.
    The kind is part of the MAC input, so an account and a network never share a tag. */
export async function logTag(
  env: { LOG_TAG_KEY?: string } | undefined,
  kind: TagKind,
  value: string,
): Promise<string> {
  const secret = env?.LOG_TAG_KEY;
  if (!secret) return UNTAGGED;
  const mac = await crypto.subtle.sign(
    "HMAC",
    await macKey(secret),
    new TextEncoder().encode(`${kind}\n${value}`),
  );
  return toBase64Url(new Uint8Array(mac)).slice(0, TAG_LENGTH);
}

/** The account tag of a user id. */
export function accountTag(env: { LOG_TAG_KEY?: string } | undefined, userId: string) {
  return logTag(env, "account", userId);
}
