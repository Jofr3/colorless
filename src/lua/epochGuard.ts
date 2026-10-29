import type { AccountStatus } from "./account";

/** Generations of an adapter's async work: a reply checks its generation before it touches
 * state, so work started under an older session, deck or query lands nowhere. */
export interface EpochGuard {
  /** Starts a generation, making every earlier one stale, and returns its check. */
  next(): () => boolean;
  /** A check for the generation already running, without starting one. */
  current(): () => boolean;
  /** Makes every earlier generation stale. */
  invalidate(): void;
}

export function epochGuard(): EpochGuard {
  let epoch = 0;
  const check = (mine: number) => () => mine === epoch;
  return {
    next: () => check(++epoch),
    current: () => check(epoch),
    invalidate: () => {
      epoch++;
    },
  };
}

/** What a deck page says under "Could not load your decks": the session check or the deck list
 * failed to reach the server. */
export const DECKS_UNREACHABLE = "Check your connection, then try again.";

/** The user an account update moves a screen to, or undefined when it leaves the screen's user
 * as it is: while the session is still loading, or when the same user is still signed in. */
export function sessionUser(status: AccountStatus, id: string, user: string): string | undefined {
  if (status === "loading" || (status === "authenticated" && id === user)) return undefined;
  return status === "authenticated" ? id : "";
}
