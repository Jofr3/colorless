// React binding for createDeckSaver. The saver must live and die with an
// EFFECT, not the component instance: StrictMode's dev-only mount → unmount →
// mount cycle runs the unmount cleanup once at startup, so a saver cached in
// a render-time ref gets disposed there and stays dead for the whole session
// (no PATCH would ever fire in dev). Creating it inside the effect gives the
// remount a live replacement. `save`/`onStatus` read through a ref so the
// effect never re-runs; `initial`/`delay`/`serialize` are captured at mount
// (the StrictMode remount happens before any edit can).

import { useCallback, useEffect, useRef } from "react";
import { createDeckSaver, type DeckSaver, type DeckSaverOptions } from "./deckSaver";

/** Returns a stable `schedule(snapshot)`; calls before the mount effect or
    after unmount are dropped. Flushes the pending save on unmount. */
export function useDeckSaver<T>(options: DeckSaverOptions<T>): (snapshot: T) => void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const saverRef = useRef<DeckSaver<T> | null>(null);

  useEffect(() => {
    const saver = createDeckSaver<T>({
      ...optionsRef.current,
      save: (snapshot) => optionsRef.current.save(snapshot),
      onStatus: (status, error) => optionsRef.current.onStatus?.(status, error),
    });
    saverRef.current = saver;
    // Flush on unmount so navigating away inside the debounce window doesn't
    // drop the last edit; dispose so the settling flight can't call back
    // into unmounted state.
    return () => {
      saverRef.current = null;
      saver.flush();
      saver.dispose();
    };
  }, []);

  return useCallback((snapshot: T) => saverRef.current?.schedule(snapshot), []);
}
