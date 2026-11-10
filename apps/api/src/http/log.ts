// Structured log lines for Workers Logs: one JSON object per line with an `evt` field, so a log
// query (`evt = "auth"`, `evt = "kv"`, `evt = "lobby"`) finds every line of one kind. These lines
// must never carry an email, an IP, a password, a session token or a player-typed string; use
// counts, status codes, short fixed reasons, and for an account or a network the keyed tag from
// ./logTag.ts, never the raw id. The rule covers the app's lines only: Cloudflare's own invocation
// event for the same request holds its headers, the client IP and geolocation among them.

export type LogFields = Record<string, string | number | boolean | null | undefined>;

// Levels: logInfo for what went as intended (sign-ins, the sweep's counts, a forfeit); logEvent
// (warn) for an expected degradation (a spent quota, a limiter or binding failure, an origin or D1
// failure the code answers for) or a refusal; logError for a code defect or an unexpected
// exception, which Workers Issues records as a logged error. Each goes out through the
// console method of its level, since Workers Logs takes the level from it and gives a
// `console.log` line none. Log queries filter on `evt`, so the level only narrows a search.

/** One `{ evt, kind, ...fields }` line at info level, for success and audit lines. */
export function logInfo(evt: string, kind: string, fields: LogFields = {}): void {
  console.info(JSON.stringify({ evt, kind, ...fields }));
}

/** The same line at warn level, for a refusal or an expected degradation. */
export function logEvent(evt: string, kind: string, fields: LogFields = {}): void {
  console.warn(JSON.stringify({ evt, kind, ...fields }));
}

/** The same line at error level, for a code defect or an unexpected exception. */
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
  throttled(logEvent, `${evt}:${kind}`, evt, kind, fields, intervalMs, now);
}

/**
 * logEventThrottled with a throttle of its own for each `by` value, for a kind whose distinct
 * causes must not hide each other (one action type the engine throws on, then another). `by` must
 * come from a fixed vocabulary, since each value keeps an entry for the isolate's life.
 */
export function logEventThrottledBy(
  by: string,
  evt: string,
  kind: string,
  fields: LogFields = {},
  intervalMs = 10 * 60 * 1000,
  now = Date.now(),
): void {
  throttled(logEvent, `${evt}:${kind}#${by}`, evt, kind, fields, intervalMs, now);
}

/** logError, throttled like logEventThrottled: for a misconfiguration every request would hit. */
export function logErrorThrottled(
  evt: string,
  kind: string,
  fields: LogFields = {},
  intervalMs = 10 * 60 * 1000,
  now = Date.now(),
): void {
  throttled(logError, `${evt}:${kind}`, evt, kind, fields, intervalMs, now);
}

/** logError, throttled per `by` value like logEventThrottledBy. */
export function logErrorThrottledBy(
  by: string,
  evt: string,
  kind: string,
  fields: LogFields = {},
  intervalMs = 10 * 60 * 1000,
  now = Date.now(),
): void {
  throttled(logError, `${evt}:${kind}#${by}`, evt, kind, fields, intervalMs, now);
}

function throttled(
  log: (evt: string, kind: string, fields: LogFields) => void,
  key: string,
  evt: string,
  kind: string,
  fields: LogFields,
  intervalMs: number,
  now: number,
): void {
  const suppressedKey = `${key}:suppressed`;
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < intervalMs) {
    lastLogged.set(suppressedKey, (lastLogged.get(suppressedKey) ?? 0) + 1);
    return;
  }
  const suppressed = lastLogged.get(suppressedKey) ?? 0;
  lastLogged.set(key, now);
  lastLogged.set(suppressedKey, 0);
  log(evt, kind, suppressed > 0 ? { ...fields, suppressed } : fields);
}

/** Forgets the throttle state; tests only. */
export function resetLogThrottle(): void {
  lastLogged.clear();
}
