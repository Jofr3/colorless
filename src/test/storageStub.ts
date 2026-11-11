/** Stand-ins for localStorage and sessionStorage, to install with `vi.stubGlobal`. */

type MemoryStorage = Storage & { readonly values: Map<string, string> };

/** A working storage over `values`, which a test may read or seed directly. */
export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as MemoryStorage;
}

/** A storage with no room: every write throws a QuotaExceededError, and reads find nothing. */
export function fullStorage(): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

/** A storage the browser blocks: every read and write throws a SecurityError. */
export function throwingStorage(): Storage {
  const blocked = () => {
    throw new DOMException("storage blocked", "SecurityError");
  };
  return {
    getItem: blocked,
    setItem: blocked,
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}
