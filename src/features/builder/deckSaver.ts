// The builder's debounced, serialized save scheduler (M9 — replaces the
// localStorage `builder.deck.<id>` write with PATCH /decks/:id). Pure
// plumbing, extracted from DeckBuilder so the timing/ordering rules are
// unit-testable without a DOM:
//
//   - DEBOUNCED: a burst of edits coalesces into one save `delay` ms after
//     the last (the old localStorage rhythm, network-shaped).
//   - SERIALIZED, LATEST WINS: at most one request in flight; edits made
//     meanwhile queue up and fire as ONE follow-up save of the latest
//     snapshot once the flight lands. Requests never interleave.
//   - NO-OP AWARE: a snapshot that serializes identically to what the server
//     already holds is skipped entirely (so mounting never fires an empty
//     "save", and an edit reverted inside the debounce window cancels it) —
//     which also guarantees an empty PATCH is never sent.
//   - NO AUTO-RETRY after a failure: the dirty snapshot is kept and the next
//     schedule()/flush() tries again, so a persistent 400 can't hot-loop.

export type SaveStatus = "saving" | "saved" | "failed";

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
}

export interface DeckSaver<T> {
  /** Note the latest state; a save fires `delay` ms after the last call. */
  schedule(snapshot: T): void;
  /** Fire any pending save NOW (unmount flush). No-op when clean. */
  flush(): void;
  /** Cancel the timer, stop accepting snapshots, and silence future callbacks
      (component gone). The in-flight request, if any, is left to finish
      server-side — and a snapshot still pending behind it (a flush() that
      couldn't fire past the flight) STILL gets its follow-up save; only the
      status callbacks go quiet. */
  dispose(): void;
}

export function createDeckSaver<T>(options: DeckSaverOptions<T>): DeckSaver<T> {
  const delay = options.delay ?? 600;
  const serialize = options.serialize ?? ((snapshot: T) => JSON.stringify(snapshot));

  /** Serialization of the last state the server acknowledged. */
  let savedKey = options.initial === undefined ? undefined : serialize(options.initial);
  let pending: { snapshot: T; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const fire = () => {
    clearTimer();
    if (inFlight || pending === null) return;
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
        // Keep (or restore) the unsaved snapshot as pending WITHOUT a timer:
        // the next schedule()/flush() retries, nothing hot-loops on its own.
        if (pending === null) pending = { snapshot, key };
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
