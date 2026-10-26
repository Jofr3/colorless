// Best-effort localStorage helpers. Reading validates/parses and falls back;
// writing and removing swallow failures (private mode, quota).

/**
 * Read and parse a persisted value. Returns `fallback` when the key is absent,
 * when storage is unavailable/throws, or when `parse` rejects the stored string
 * by returning `undefined`.
 */
export function readPersisted<T>(
  key: string,
  parse: (raw: string) => T | undefined,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = parse(raw);
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Persist a string value, swallowing storage failures (private mode, quota).
    False when the value was not stored. */
export function writePersisted(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Best-effort — the value still applies for this session, it just won't
    // survive a refresh.
    return false;
  }
}

/** Remove a persisted value, swallowing storage failures. */
export function removePersisted(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; nothing persisted to clear.
  }
}
