// Errors as log fields that never carry a bound value. drizzle wraps every failed non-batch query
// in a DrizzleQueryError whose message is `Failed query: <sql>\nparams: <values>`, and those values
// are emails, password and session hashes, user ids and deck names. Only names, the SQL text (its
// values are `?` placeholders), whether the failure reads as a spent quota and, for a failure
// nothing handled, the stack's `at` frames are logged.

import { DrizzleQueryError } from "drizzle-orm";
import type { LogFields } from "./log";

/** The error and each `.cause` below it, outermost first; stops at a non-Error or a loop. */
export function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/** Whether any error in the chain's message matches. drizzle keeps D1's own text, such as a
    UNIQUE failure or a spent quota, only on `cause`. */
export function chainMentions(error: unknown, pattern: RegExp): boolean {
  return errorChain(error).some((link) => pattern.test(link.message));
}

/** A failure's fields: names, the SQL without params, and the quota flag. */
export function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: typeof error };
  const cause = errorChain(error)[1];
  return {
    error: error instanceof DrizzleQueryError ? "DrizzleQueryError" : error.name,
    cause: cause?.name,
    query: error instanceof DrizzleQueryError ? error.query.slice(0, 500) : undefined,
    quota: chainMentions(error, /exceeded/i),
  };
}

/** How many of the innermost `at` frames an unhandled error's line keeps, and how long each. */
export const MAX_FRAMES = 5;
export const MAX_FRAME_LENGTH = 200;

/**
 * The innermost `at` frames of the error's stack, one per line, or undefined. They are read only
 * from below the message: a failed query's message spans lines and carries its bound values, and a
 * value can hold a line that reads like a frame. A stack that does not contain the message (one
 * rewritten after the throw) gives none.
 */
export function errorFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  const at = error.message === "" ? 0 : error.stack.indexOf(error.message);
  if (at < 0) return undefined;
  const frames = error.stack
    .slice(at + error.message.length)
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim().slice(0, MAX_FRAME_LENGTH));
  return frames.length === 0 ? undefined : frames.join("\n");
}

/** The fields of a failure nothing handled (an error-level line): errorFields plus the frames,
    which locate the defect. A handled degradation logs errorFields alone. */
export function unhandledErrorFields(error: unknown): LogFields {
  return { ...errorFields(error), frames: errorFrames(error) };
}

/** One line for an error, at most 200 characters: `name: message`, except that a failed query is
    described by its own and its cause's names alone. */
export function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const cause = errorChain(error)[1];
    return cause === undefined ? "DrizzleQueryError" : `DrizzleQueryError < ${cause.name}`;
  }
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
}
