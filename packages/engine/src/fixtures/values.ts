/** Recursively freeze a value (strict mode makes any later mutation throw). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** A JSON round trip: what survives persistence and the wire. */
export function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
