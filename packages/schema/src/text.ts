// The rule for names one player's screen shows another's: account display names and lobby seat
// names. They carry no Unicode control or format characters (Cc, Cf) and no lone surrogate (Cs; a
// surrogate pair is one code point and never matches). A line break in a name would forge a line
// on the web client's line-based Lua-to-host bridge, format characters (bidi overrides, invisible
// marks) let a name pass for another, and a lone surrogate cannot be percent-encoded for that
// bridge. Writes refuse them; names stored or sent before the rule existed are stripped where the
// lobby takes them in.

import type * as z from "zod";

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const ALL_CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

export const CONTROL_CHARS_MESSAGE = "Must not contain control or formatting characters";

export function hasControlChars(value: string): boolean {
  return CONTROL_OR_FORMAT.test(value);
}

export function stripControlChars(value: string): string {
  return value.replace(ALL_CONTROL_OR_FORMAT, "");
}

/** `value` stripped, then cut to at most `max` UTF-16 units without leaving half a pair. */
export function clipText(value: string, max: number): string {
  const clipped = stripControlChars(value).slice(0, max);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

/** `schema`, refusing any value with a control or format character. */
export function withoutControlChars<T extends z.ZodType<string>>(schema: T): T {
  return schema.refine((value) => !hasControlChars(value), { message: CONTROL_CHARS_MESSAGE });
}
