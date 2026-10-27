// The one rule for a public display name: the account name other players see and the name a lobby
// hello announces. Zod-free, so the lobby protocol constants can share the bound without pulling
// zod into the web client; the account schemas build their refusing field on it
// (auth/requests.ts `displayNameField`).
//
// A name is NFKC-normalized (full-width and other compatibility forms fold to their plain
// letters), trimmed, every run of whitespace becomes one space, and it is at most
// DISPLAY_NAME_MAX characters. Control and format characters (text.ts) are refused on an account
// write and stripped where a name is only read or announced.

import { stripControlChars } from "./text";

export const DISPLAY_NAME_MAX = 64;

/** NFKC, then trimmed. The step before the control-character check on an account write. */
export function foldDisplayName(value: string): string {
  return value.normalize("NFKC").trim();
}

/** Every run of whitespace as one space. */
export function collapseSpaces(value: string): string {
  return value.replace(/\s+/gu, " ");
}

/** A name from a source that is not refused when it breaks the rule: a lobby hello, or an account
    name stored before the rule. Control and format characters are stripped rather than refused,
    then the name is normalized and clipped to the bound. May return "". */
export function cleanDisplayName(value: string): string {
  const folded = collapseSpaces(stripControlChars(value.normalize("NFKC"))).trim();
  // The bound counts UTF-16 units, as the account schemas' max does; a cut never splits a pair.
  const clipped = folded.slice(0, DISPLAY_NAME_MAX);
  return (/[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped).trimEnd();
}
