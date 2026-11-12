// The builder's debounced, serialized save scheduler for PATCH /decks/:id. Kept separate from the
// builder adapter so the timing and ordering rules can be unit-tested without a DOM.

import { ApiError } from "../lib/api";

/** "retrying" from a failed attempt that will be sent again on its own until it lands ("saved") or
    is reported ("failed"). */
export type SaveStatus = "saving" | "retrying" | "saved" | "failed";

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

/** Saves that failed in passing (no response, or a gateway error) retried before the save is
    reported failed. */
export const MAX_TRANSIENT_RETRIES = 3;
/** The gateway statuses a retry may get past. A 500 is the Worker's own failure and stays reported. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * How long to wait before retrying a save that failed in passing: the network failed or timed
 * out, or a gateway answered 502, 503 or 504. 2, 4 then 8 seconds; undefined for any other
 * failure, and once MAX_TRANSIENT_RETRIES retries in a row failed too. Safe only because a
 * retried save that had already landed is recognised by the 409 it gets (src/lua/builder.ts).
 */
export function transientRetryDelay(error: unknown, attempt: number): number | undefined {
  const transient = !(error instanceof ApiError) || TRANSIENT_STATUSES.has(error.status);
  if (!transient || attempt > MAX_TRANSIENT_RETRIES) return undefined;
  return 2 ** attempt * 1000;
}

/** The saver's default: a 429 is retried by its rate-limit backoff, a passing failure by
    transientRetryDelay, and anything else is reported. */
export function saveRetryDelay(error: unknown, attempt: number): number | undefined {
  return rateLimitRetryDelay(error, attempt) ?? transientRetryDelay(error, attempt);
}

/**
 * Whether a rejected save may still have been written: no response arrived (the network failed or
 * the request timed out), or a 5xx, which a gateway can send after the Worker committed. A 4xx is
 * the API refusing the save before any write.
 */
export function outcomeUnknown(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** The saver's default spacing between save starts: at most 60 a minute. */
export const MIN_SAVE_SPACING_MS = 1000;

/** Waits are measured on a monotonic clock, which a step of the wall clock cannot stretch. */
const now = () => performance.now();

export interface DeckSaverOptions<T> {
  /** Perform the save (the PATCH). Rejections surface as status "failed". */
  save: (snapshot: T) => Promise<unknown>;
  /** Debounce window in ms after the last schedule(). Default 600. */
  delay?: number;
  /** The least time in ms from one save's start to the next one's, so steady editing stays
      under the API's 60 deck writes a minute. A flush does not wait for it. Default
      MIN_SAVE_SPACING_MS. */
  spacing?: number;
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
      saveRetryDelay: a 429 or a passing failure is retried, with backoff. */
  retryDelay?: (error: unknown, attempt: number) => number | undefined;
}

export interface DeckSaver<T> {
  /** Note the latest state; a save fires `delay` ms after the last call. */
  schedule(snapshot: T): void;
  /** Fire any pending save NOW (leave/close flush). No-op when clean. */
  flush(): void;
  /** Whether nothing is left to send: no save queued, waiting out a backoff or in flight. */
  idle(): boolean;
  /** Resolves once no save is in flight and none will fire on its own: after dispose(), once the
      flight and the follow-up queued behind it have answered. */
  settled(): Promise<void>;
  /** Cancel the timer, stop accepting snapshots, and silence future callbacks
      (the builder reset or reloaded). The in-flight request, if any, is left to finish
      server-side — and a snapshot still pending behind it (a flush() that
      couldn't fire past the flight) STILL gets its follow-up save; only the
      status callbacks go quiet. */
  dispose(): void;
}

export function createDeckSaver<T>(options: DeckSaverOptions<T>): DeckSaver<T> {
  const delay = options.delay ?? 600;
  const spacing = options.spacing ?? MIN_SAVE_SPACING_MS;
  const serialize = options.serialize ?? ((snapshot: T) => JSON.stringify(snapshot));
  const retryDelay = options.retryDelay ?? saveRetryDelay;

  /** Serialization of the last state the server acknowledged, or undefined when unknown. */
  let savedKey = options.initial === undefined ? undefined : serialize(options.initial);
  let pending: { snapshot: T; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;
  /** Rejections in a row, and the time before which a backed-off save may not fire. */
  let rejections = 0;
  let notBefore = 0;
  /** When the last save started. */
  let lastStart = Number.NEGATIVE_INFINITY;
  const waiters: (() => void)[] = [];

  const isSettled = () => !inFlight && (pending === null || timer === null);
  const settle = () => {
    if (isSettled()) for (const resolve of waiters.splice(0)) resolve();
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** `flushed` skips the spacing, for a save the page is leaving or hiding behind. */
  const fire = (flushed = false) => {
    clearTimer();
    if (inFlight || pending === null) return;
    // Backing off: a flush or a newer edit waits out the wait rather than being refused again.
    const wait = Math.max(notBefore, flushed ? 0 : lastStart + spacing) - now();
    if (wait > 0) {
      timer = setTimeout(() => fire(), wait);
      return;
    }
    const { snapshot, key } = pending;
    pending = null;
    // The queued snapshot may have converged back onto what a just-landed
    // flight saved — nothing left to send, and the "saving" that flight
    // reported is over.
    if (key === savedKey) {
      if (!disposed) options.onStatus?.("saved");
      settle();
      return;
    }
    inFlight = true;
    lastStart = now();
    // A retry goes on saying "retrying", which its failed attempt reported.
    if (!disposed && rejections === 0) options.onStatus?.("saving");
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
        settle();
      },
      (error: unknown) => {
        inFlight = false;
        // The server may hold this snapshot now, so no later one counts as already saved: an undo
        // back to the acknowledged state must still be sent.
        if (outcomeUnknown(error)) savedKey = undefined;
        if (disposed) {
          // No callbacks and no restore-and-retry of the failed snapshot —
          // but a NEWER snapshot queued behind the flight still fires once
          // (schedule() is closed after dispose, so this can't loop).
          if (pending !== null) fire();
          settle();
          return;
        }
        // Keep (or restore) the unsaved snapshot as pending.
        if (pending === null) pending = { snapshot, key };
        const wait = retryDelay(error, ++rejections);
        if (wait !== undefined) {
          // Retried: the edits stay pending and are sent again after the wait, "retrying", with
          // newer edits coalescing into that one retry.
          notBefore = now() + wait;
          clearTimer();
          timer = setTimeout(() => fire(), wait);
          options.onStatus?.("retrying", error);
          return;
        }
        // Any other failure retries on the next schedule()/flush(); nothing hot-loops on its own.
        rejections = 0;
        options.onStatus?.("failed", error);
        settle();
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
        settle();
        return;
      }
      pending = { snapshot, key };
      clearTimer();
      timer = setTimeout(() => fire(), delay);
    },
    flush() {
      if (disposed) return;
      if (pending !== null) fire(true);
      else clearTimer();
    },
    idle() {
      return !inFlight && pending === null;
    },
    settled() {
      if (isSettled()) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    dispose() {
      disposed = true;
      clearTimer();
      settle();
    },
  };
}
