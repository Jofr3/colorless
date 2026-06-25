import { afterEach, describe, expect, it, vi } from "vitest";
import { readPersisted, writePersisted } from "./persistedState";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const throwingStorage = () =>
  ({
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  }) as Storage;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPersisted", () => {
  it("returns the parsed value when the key is present and valid", () => {
    vi.stubGlobal("localStorage", fakeStorage({ k: "1" }));
    expect(readPersisted("k", (raw) => raw === "1", false)).toBe(true);
  });

  it("falls back when the key is absent", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(readPersisted("missing", (raw) => raw, "default")).toBe("default");
  });

  it("falls back when parse rejects the stored value (undefined)", () => {
    vi.stubGlobal("localStorage", fakeStorage({ k: "bogus" }));
    const parse = (raw: string) => (raw === "ok" ? raw : undefined);
    expect(readPersisted("k", parse, "default")).toBe("default");
  });

  it("falls back when storage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(readPersisted("k", (raw) => raw, "default")).toBe("default");
  });
});

describe("writePersisted", () => {
  it("stores the value", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    writePersisted("k", "v");
    expect(storage.getItem("k")).toBe("v");
  });

  it("swallows a throwing setItem", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(() => writePersisted("k", "v")).not.toThrow();
  });
});
