// The rule for names one player's screen shows another's: account display names and lobby seat
// names. They carry no Unicode control or format characters (Cc, Cf). A line break in a name would
// forge a line on the web client's line-based Lua-to-host bridge, and format characters (bidi
// overrides, invisible marks) let a name pass for another. Writes refuse them; names stored or sent
// before the rule existed are stripped where the lobby takes them in.

import type * as z from "zod";

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const ALL_CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

export const CONTROL_CHARS_MESSAGE = "Must not contain control or formatting characters";

export function hasControlChars(value: string): boolean {
  return CONTROL_OR_FORMAT.test(value);
}

export function stripControlChars(value: string): string {
  return value.replace(ALL_CONTROL_OR_FORMAT, "");
}

/** `schema`, refusing any value with a control or format character. */
export function withoutControlChars<T extends z.ZodType<string>>(schema: T): T {
  return schema.refine((value) => !hasControlChars(value), { message: CONTROL_CHARS_MESSAGE });
}
