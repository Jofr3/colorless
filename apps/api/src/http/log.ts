// Structured log lines for Workers Logs: one JSON object per line with an `evt` field, so a saved
// query (`evt = "auth"`, `evt = "kv"`, `evt = "lobby"`) finds every line of one kind. Fields must
// never carry an email, an IP, a password, a session token or a player-typed string; use ids,
// counts, status codes and short fixed reasons.

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** One `{ evt, kind, ...fields }` line at warn level. */
export function logEvent(evt: string, kind: string, fields: LogFields = {}): void {
  console.warn(JSON.stringify({ evt, kind, ...fields }));
}

/** The same line at error level, for failures nothing handled. */
export function logError(evt: string, kind: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ evt, kind, ...fields }));
}

/** When each throttled key last logged, per isolate. */
const lastLogged = new Map<string, number>();

/**
 * logEvent at most once per `intervalMs` per `evt:kind` in this isolate, for failures that repeat
 * on every request while they last (a spent KV quota) and would otherwise flood the logs. The line
 * carries how many were suppressed since the last one.
 */
export function logEventThrottled(
  evt: string,
  kind: string,
  fields: LogFields = {},
  intervalMs = 10 * 60 * 1000,
  now = Date.now(),
): void {
  const key = `${evt}:${kind}`;
  const suppressedKey = `${key}:suppressed`;
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < intervalMs) {
    lastLogged.set(suppressedKey, (lastLogged.get(suppressedKey) ?? 0) + 1);
    return;
  }
  const suppressed = lastLogged.get(suppressedKey) ?? 0;
  lastLogged.set(key, now);
  lastLogged.set(suppressedKey, 0);
  logEvent(evt, kind, suppressed > 0 ? { ...fields, suppressed } : fields);
}

/** Forgets the throttle state; tests only. */
export function resetLogThrottle(): void {
  lastLogged.clear();
}
