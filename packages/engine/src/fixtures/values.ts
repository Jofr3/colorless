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

/** `value`, failing loudly when it is null or undefined: a test's `(x?.[0] as T).field` without the
 * optional chain that Biome's noUnsafeOptionalChaining rejects. */
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error(`expected a value, got ${value}`);
  return value;
}
