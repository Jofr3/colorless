// A new account's default public name (security audit AU3). Opponents and spectators see it, so
// it is generated rather than taken from the email's local part or the Google account's real
// name: "Trainer-" and four characters from the lobby code's alphabet, which has no 0/O or 1/I
// to misread. Names need not be unique, so collisions are harmless; the user can rename any time.

import { LOBBY_CODE_ALPHABET } from "@colorless/schema";

export const HANDLE_PREFIX = "Trainer-";
const HANDLE_LENGTH = 4;
/** The largest multiple of the alphabet's size below 256: a byte at or past it is drawn again,
    so every character is equally likely. */
const UNBIASED_LIMIT = 256 - (256 % LOBBY_CODE_ALPHABET.length);

export function generateHandle(): string {
  let suffix = "";
  while (suffix.length < HANDLE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(HANDLE_LENGTH * 2))) {
      if (byte < UNBIASED_LIMIT && suffix.length < HANDLE_LENGTH) {
        suffix += LOBBY_CODE_ALPHABET[byte % LOBBY_CODE_ALPHABET.length];
      }
    }
  }
  return HANDLE_PREFIX + suffix;
}
