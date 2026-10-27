// The builder's debounced, serialized save scheduler for PATCH /decks/:id. Kept separate from the
// builder adapter so the timing and ordering rules can be unit-tested without a DOM.

import { ApiError } from "../lib/api";

export type SaveStatus = "saving" | "saved" | "failed";

/** Rate-limited saves retried before the save is reported failed. */
export const MAX_RATE_LIMIT_RETRIES = 5;
/** Bounds on one wait, in seconds: a Retry-After is honoured within them. */
const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 60;

/**
 * How long to wait before retrying a save the API refused with 429 (the deck-write rate limit):
 * its Retry-After, else 2, 4, 8, 16 then 32 seconds, each within 1 to 60 seconds. Undefined for
 * any other failure, and once MAX_RATE_LIMIT_RETRIES retries in a row were refused too.
 */
export function rateLimitRetryDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof ApiError) || error.status !== 429 || attempt > MAX_RATE_LIMIT_RETRIES) {
    return undefined;
  }
  const seconds = error.retryAfterSeconds ?? 2 ** attempt;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, seconds)) * 1000;
}

export interface DeckSaverOptions<T> {
  /** Perform the save (the PATCH). Rejections surface as status "failed". */
  save: (snapshot: T) => Promise<unknown>;
  /** Debounce window in ms after the last schedule(). Default 600. */
  delay?: number;
  /** What the server currently holds — seeds the no-op check so the first
      schedule() of the just-loaded state doesn't fire a save. */
  initial?: T;
  /** Change detector; snapshots serializing equal are "the same". Defaults
      to JSON.stringify. */
  serialize?: (snapshot: T) => string;
  /** Observe the save lifecycle ("failed" carries the rejection reason). */
  onStatus?: (status: SaveStatus, error?: unknown) => void;
  /** For a rejected save, how many ms to wait before retrying it on its own, or undefined to
      report it "failed". `attempt` counts the rejections in a row, from 1. Default
      rateLimitRetryDelay: a 429 is retried, with backoff. */
  retryDelay?: (error: unknown, attempt: number) => number | undefined;
}

export interface DeckSaver<T> {
  /** Note the latest state; a save fires `delay` ms after the last call. */
  schedule(snapshot: T): void;
  /** Fire any pending save NOW (leave/close flush). No-op when clean. */
  flush(): void;
  /** Cancel the timer, stop accepting snapshots, and silence future callbacks
      (the builder reset or reloaded). The in-flight request, if any, is left to finish
      server-side — and a snapshot still pending behind it (a flush() that
      couldn't fire past the flight) STILL gets its follow-up save; only the
      status callbacks go quiet. */
  dispose(): void;
}

export function createDeckSaver<T>(options: DeckSaverOptions<T>): DeckSaver<T> {
  const delay = options.delay ?? 600;
  const serialize = options.serialize ?? ((snapshot: T) => JSON.stringify(snapshot));
  const retryDelay = options.retryDelay ?? rateLimitRetryDelay;

  /** Serialization of the last state the server acknowledged. */
  let savedKey = options.initial === undefined ? undefined : serialize(options.initial);
  let pending: { snapshot: T; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;
  /** Rejections in a row, and the time before which a backed-off save may not fire. */
  let rejections = 0;
  let notBefore = 0;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const fire = () => {
    clearTimer();
    if (inFlight || pending === null) return;
    // Backing off: a flush or a newer edit waits out the wait rather than being refused again.
    const wait = notBefore - Date.now();
    if (wait > 0) {
      timer = setTimeout(fire, wait);
      return;
    }
    const { snapshot, key } = pending;
    pending = null;
    // The queued snapshot may have converged back onto what a just-landed
    // flight saved — nothing left to send.
    if (key === savedKey) return;
    inFlight = true;
    if (!disposed) options.onStatus?.("saving");
    options.save(snapshot).then(
      () => {
        inFlight = false;
        rejections = 0;
        savedKey = key;
        if (pending === null) {
          if (!disposed) options.onStatus?.("saved");
        }
        // Dirty again, debounce already expired → follow up straight away
        // (latest wins, one flight at a time). With the timer still armed,
        // the follow-up waits for it instead — edits keep coalescing. This
        // holds even after dispose() (which guarantees a clear timer): a
        // snapshot flushed during the flight must still reach the server,
        // just without the status callbacks.
        else if (timer === null) fire();
      },
      (error: unknown) => {
        inFlight = false;
        if (disposed) {
          // No callbacks and no restore-and-retry of the failed snapshot —
          // but a NEWER snapshot queued behind the flight still fires once
          // (schedule() is closed after dispose, so this can't loop).
          if (pending !== null) fire();
          return;
        }
        // Keep (or restore) the unsaved snapshot as pending.
        if (pending === null) pending = { snapshot, key };
        const wait = retryDelay(error, ++rejections);
        if (wait !== undefined) {
          // Rate limited: the edits stay pending and are sent again after the wait, still
          // "saving", with newer edits coalescing into that one retry.
          notBefore = Date.now() + wait;
          clearTimer();
          timer = setTimeout(fire, wait);
          return;
        }
        // Any other failure retries on the next schedule()/flush(); nothing hot-loops on its own.
        rejections = 0;
        options.onStatus?.("failed", error);
      },
    );
  };

  return {
    schedule(snapshot: T) {
      if (disposed) return;
      const key = serialize(snapshot);
      if (key === savedKey && !inFlight) {
        // Back to (or still at) the saved state — drop any queued save.
        pending = null;
        clearTimer();
        return;
      }
      pending = { snapshot, key };
      clearTimer();
      timer = setTimeout(fire, delay);
    },
    flush() {
      if (disposed) return;
      if (pending !== null) fire();
      else clearTimer();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
