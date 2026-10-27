// Errors as log fields that never carry a bound value. drizzle wraps every failed non-batch query
// in a DrizzleQueryError whose message is `Failed query: <sql>\nparams: <values>`, and those values
// are emails, password and session hashes, user ids and deck names. Only names, the SQL text (its
// values are `?` placeholders) and whether the failure reads as a spent quota are logged.

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

/** An unhandled error's fields: names, the SQL without params, and the quota flag. */
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

/** One line for an error, at most 200 characters: `name: message`, except that a failed query is
    described by its own and its cause's names alone. */
export function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const cause = errorChain(error)[1];
    return cause === undefined ? "DrizzleQueryError" : `DrizzleQueryError < ${cause.name}`;
  }
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
}
