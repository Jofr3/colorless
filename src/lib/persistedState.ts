// Best-effort localStorage helpers. Reading validates/parses and falls back;
// writing swallows failures (private mode, quota). Centralizes the try/catch
// boilerplate that the settings and decks features previously hand-rolled.

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

/** Persist a string value, swallowing storage failures (private mode, quota). */
export function writePersisted(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort — the value still applies for this session, it just won't
    // survive a refresh.
  }
}
